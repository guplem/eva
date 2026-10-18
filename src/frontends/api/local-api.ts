/**
 * The local API of one Eva instance: HTTP for commands, a WebSocket for events.
 * It listens on the loopback address only; remote access goes through
 * `tailscale serve`. Every request passes the guards below first.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import type { CheckName } from "../../core/checks.ts";
import type { Eva } from "../../core/eva.ts";
import { parseProjectQuery } from "../../core/projects/project-catalog.ts";
import webPage from "../web/index.html";
import icon192 from "../web/icons/icon-192.png" with { type: "file" };
import icon512 from "../web/icons/icon-512.png" with { type: "file" };
import iconSvg from "../web/icons/icon.svg" with { type: "file" };
import type { SessionEvent } from "../../shared/events.ts";
import { isEvaError } from "../../shared/errors.ts";

export interface LocalApiOptions {
  readonly eva: Eva;
  /** 0 picks a free port; the default instance uses 7420. */
  readonly port: number;
  readonly token: string;
  /** Host names other than the loopback ones, such as the instance's Tailscale name. */
  readonly extraHosts: readonly string[];
  /** When not empty, a request that `tailscale serve` marks with an identity must carry one of these. */
  readonly allowedTailscaleIdentities: readonly string[];
}

export interface LocalApi {
  readonly url: string;
  stop(): void;
}

interface SocketData {
  unsubscribe: (() => void) | null;
}

const modelSchema = z.enum(["default", "opus", "sonnet", "haiku"]).default("default");
const newSessionSchema = z.object({
  mode: z.enum(["assistant", "project"]),
  model: modelSchema,
  engine: z.enum(["claude-code", "pi"]).optional(),
  projectId: z.string().min(1).optional(),
  clone: z.string().min(1).optional(),
});
const messageSchema = z.object({ text: z.string().min(1) });
const forkSchema = z.object({ atMessageId: z.string().min(1) });
const retrySchema = z.object({ turnIndex: z.number().int().min(0) });
const approvalSchema = z.object({ answer: z.enum(["allow", "deny"]) });
const statusSchema = z.enum(["idea", "active", "paused", "closed"]).optional();
const loginSchema = z.object({ token: z.string().min(1) });
const newCloneSchema = z.object({ repositoryUrl: z.string().min(1).optional() });
const projectWorkSchema = z.object({ request: z.string().min(1), reportToSessionId: z.string().min(1).optional() });
const settingsPatchSchema = z.record(z.string(), z.unknown());
/** The schedule rules live in the core; the API only needs an object. */
const scheduleEntrySchema = z.record(z.string(), z.unknown());
const logsQuerySchema = z.object({
  level: z.enum(["warn", "error"]).default("warn"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const checkNames: readonly CheckName[] = ["vault", "engine", "github", "telegram"];
/** The login cookies live a year; the person logs out to end them. */
const cookieMaxAgeSeconds = 365 * 24 * 60 * 60;
const tokenCookie = "eva_token";
const deviceCookie = "eva_device";
/** The part of the browser's user agent that the device label keeps. */
const deviceLabelBrowserLength = 120;

export function startLocalApi(options: LocalApiOptions): LocalApi {
  const allowedHostNames = new Set(["127.0.0.1", "localhost", ...options.extraHosts.map((host) => host.toLowerCase())]);

  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: options.port,
    // The page, its bundled files and the icons hold no data, so they load before the login. The
    // bundle gives the manifest a hashed path but leaves its icon paths as written, so those get fixed routes.
    routes: {
      "/": webPage,
      "/icon.svg": staticFile(iconSvg, "image/svg+xml"),
      "/icon-192.png": staticFile(icon192, "image/png"),
      "/icon-512.png": staticFile(icon512, "image/png"),
    },
    development: false,
    // Bun closes a request after 10 idle seconds by default. Some routes run git or gh for longer,
    // such as a new clone or a setup report, so allow Bun's maximum.
    idleTimeout: 255,
    fetch: async (request, bunServer) => {
      const siteRefusal = guardSite(request, options, allowedHostNames);
      if (siteRefusal !== null) return siteRefusal;
      const url = new URL(request.url);
      if (url.pathname === "/api/login" || url.pathname === "/api/logout") return session(request, url, options);
      if (url.pathname === "/api/login/device" || url.pathname.startsWith("/api/login/device/"))
        return deviceLogin(request, url, options);
      // A Tailscale identity alone never authenticates: any program on this machine can forge the header.
      if (!hasValidToken(request, options.token) && !hasValidDeviceCookie(request, options.eva))
        return json({ error: "A valid token is required." }, 401);
      if (url.pathname === "/api/events") {
        return bunServer.upgrade(request, { data: { unsubscribe: null } })
          ? undefined
          : json({ error: "A WebSocket upgrade was expected." }, 400);
      }
      try {
        return await route(request, url, options.eva);
      } catch (error) {
        return errorResponse(error, options.eva);
      }
    },
    websocket: {
      open(socket: ServerWebSocket<SocketData>) {
        socket.data.unsubscribe = options.eva.sessions.subscribe((event: SessionEvent) => {
          socket.send(JSON.stringify(event));
        });
      },
      message() {
        // Commands go over HTTP; the socket only carries events to the client.
      },
      close(socket: ServerWebSocket<SocketData>) {
        socket.data.unsubscribe?.();
      },
    },
  });

  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    stop: () => {
      void server.stop(true);
    },
  };
}

/** Host, Origin and Tailscale identity checks. Returns a refusal, or null to go on. */
function guardSite(request: Request, options: LocalApiOptions, allowedHostNames: ReadonlySet<string>): Response | null {
  const host = hostNameOf(request.headers.get("host"));
  if (host === null || !allowedHostNames.has(host)) return json({ error: "Unknown host." }, 403);

  // The whole origin must match, port included: a page on another local port shares the
  // host name and the SameSite cookie, but it is another site.
  const origin = request.headers.get("origin");
  if (origin !== null && safeHost(origin)?.toLowerCase() !== request.headers.get("host")?.toLowerCase()) {
    return json({ error: "Requests from other sites are refused." }, 403);
  }

  const identity = request.headers.get("tailscale-user-login");
  const allowed = options.allowedTailscaleIdentities;
  // `tailscale serve` adds the identity header. A remote host without one is a tagged device or no Tailscale at all.
  const remote = host !== "127.0.0.1" && host !== "localhost";
  if (allowed.length > 0 && (identity === null ? remote : !allowed.includes(identity))) {
    return json({ error: "This Tailscale identity is not allowed." }, 403);
  }
  return null;
}

/** Login and logout for the web UI: a strict, HTTP-only cookie, never a token in a URL. */
async function session(request: Request, url: URL, options: LocalApiOptions): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (url.pathname === "/api/logout") {
    const deviceToken = cookieValue(request, deviceCookie);
    if (deviceToken !== null) options.eva.deviceLogins.forget(deviceToken);
    const headers = new Headers();
    headers.append("set-cookie", cookieHeader(request, tokenCookie, "", 0));
    headers.append("set-cookie", cookieHeader(request, deviceCookie, "", 0));
    return new Response(null, { status: 204, headers });
  }
  let candidate: string;
  try {
    candidate = loginSchema.parse(await request.json()).token;
  } catch {
    return json({ error: "The request body is invalid." }, 400);
  }
  if (!sameText(candidate, options.token)) return json({ error: "This token is not valid." }, 401);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": cookieHeader(request, tokenCookie, options.token, cookieMaxAgeSeconds) },
  });
}

/**
 * Device login: a browser that comes through an allowed Tailscale account asks, the
 * owner allows it in Telegram, and the page polls until it gets the device cookie. Only such a
 * browser may ask, and only for itself: a request of another account looks expired.
 */
function deviceLogin(request: Request, url: URL, options: LocalApiOptions): Response {
  const account = allowedTailscaleAccount(request, options);
  if (account === null)
    return json({ error: "A device login works only through Tailscale, from an allowed account." }, 403);
  const deviceLogins = options.eva.deviceLogins;
  const id = decodeURIComponent(url.pathname.slice("/api/login/device/".length));
  try {
    if (request.method === "POST" && url.pathname === "/api/login/device") {
      const browser = (request.headers.get("user-agent") ?? "an unknown browser").slice(0, deviceLabelBrowserLength);
      return json(deviceLogins.request(account, `${account}, ${browser}`), 201);
    }
    if (request.method === "GET" && id.length > 0) {
      const found = deviceLogins.check(id, account);
      if (found.state !== "allowed") return json({ state: found.state });
      return Response.json(
        { state: "allowed" },
        { headers: { "set-cookie": cookieHeader(request, deviceCookie, found.token, cookieMaxAgeSeconds) } },
      );
    }
  } catch (error) {
    return errorResponse(error, options.eva);
  }
  return json({ error: "Not found." }, 404);
}

async function route(request: Request, url: URL, eva: Eva): Promise<Response> {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/status") return json(eva.status());
  if (method === "GET" && url.pathname === "/api/sessions") return json(eva.sessions.list());
  if (method === "GET" && url.pathname === "/api/approvals") return json(eva.sessions.pendingApprovals());
  if (method === "GET" && url.pathname === "/api/projects") {
    const status = statusSchema.parse(url.searchParams.get("status") ?? undefined);
    const tag = url.searchParams.get("tag");
    // Read the filter words here: the CLI sends its words as they are.
    const query = parseProjectQuery(url.searchParams.get("text") ?? "");
    return json(
      eva.projects({
        ...query,
        ...(status === undefined ? {} : { status }),
        ...(tag === null ? {} : { tag }),
      }),
    );
  }
  if (method === "POST" && url.pathname === "/api/sessions") {
    const input = newSessionSchema.parse(await request.json());
    const engine = input.engine === undefined ? {} : { engine: input.engine };
    if (input.mode === "assistant") {
      return json(eva.createAssistantSession({ source: "web", model: input.model, ...engine }), 201);
    }
    if (input.projectId === undefined) return json({ error: "A Project chat needs a projectId." }, 400);
    const session = await eva.createProjectSession({
      projectId: input.projectId,
      source: "web",
      model: input.model,
      ...engine,
      ...(input.clone === undefined ? {} : { cloneName: input.clone }),
    });
    return json(session, 201);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "sessions" && parts[2] !== undefined) {
    const sessionId = decodeURIComponent(parts[2]);
    const action = parts[3];
    if (action === "messages") {
      const { text } = messageSchema.parse(await request.json());
      eva.sessions.get(sessionId);
      void eva.sessions.send(sessionId, text);
      return json({ accepted: true }, 202);
    }
    if (action === "fork") {
      const { atMessageId } = forkSchema.parse(await request.json());
      return json(eva.sessions.fork(sessionId, atMessageId), 201);
    }
    if (action === "stop") {
      eva.sessions.get(sessionId);
      return json({ stopped: eva.sessions.stop(sessionId) });
    }
    if (action === "retry") {
      const { turnIndex } = retrySchema.parse(await request.json());
      return json(await eva.sessions.retry(sessionId, turnIndex));
    }
  }
  if (
    method === "POST" &&
    parts[0] === "api" &&
    parts[1] === "projects" &&
    parts[2] !== undefined &&
    parts[3] === "work"
  ) {
    const { request: work, reportToSessionId } = projectWorkSchema.parse(await request.json());
    const session = await eva.startProjectWork({
      projectId: decodeURIComponent(parts[2]),
      request: work,
      reportToSessionId: reportToSessionId ?? null,
    });
    return json({ sessionId: session.id, clone: session.clone }, 202);
  }
  if (
    method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "projects" &&
    parts[2] !== undefined &&
    parts[3] === "setup"
  ) {
    return json(await eva.repositorySetup(decodeURIComponent(parts[2])));
  }
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] !== undefined && parts[3] === "clones") {
    const projectId = decodeURIComponent(parts[2]);
    if (method === "GET") return json(await eva.clones(projectId));
    if (method === "POST") {
      const { repositoryUrl } = newCloneSchema.parse(await request.json());
      return json(await eva.newClone(projectId, repositoryUrl), 201);
    }
  }
  if (method === "GET" && url.pathname === "/api/settings") return json(eva.publicSettings());
  if (method === "PUT" && url.pathname === "/api/settings") {
    return json(eva.updateSettings(settingsPatchSchema.parse(await request.json())));
  }
  if (method === "DELETE" && url.pathname === "/api/devices") return json({ removed: eva.deviceLogins.forgetAll() });
  if (method === "POST" && url.pathname === "/api/vault/sync") return json(await eva.syncVault());
  if (method === "POST" && url.pathname === "/api/hub") return json(await eva.becomeHub());
  if (url.pathname === "/api/update/engine") {
    if (method === "GET") return json(eva.engineUpdateStatus());
    if (method === "POST") {
      const status = eva.updateEngine();
      return status === null ? json({ error: "No claude program was found." }, 409) : json(status);
    }
  }
  if (url.pathname === "/api/update" || url.pathname === "/api/update/check") {
    if (method === "GET" && url.pathname === "/api/update") return json(eva.updateStatus());
    if (method === "POST") {
      const status = url.pathname === "/api/update" ? await eva.updateNow() : await eva.checkForUpdate();
      return status === null ? json({ error: "This Eva has no update channel." }, 409) : json(status);
    }
  }
  if (method === "GET" && url.pathname === "/api/logs") {
    const query = logsQuerySchema.parse({
      level: url.searchParams.get("level") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return json(eva.recentLogs({ minimumLevel: query.level, limit: query.limit }));
  }
  if (method === "POST" && url.pathname === "/api/restart") {
    eva.restart();
    return json({ restarting: true }, 202);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "checks" && parts[2] !== undefined) {
    const name = checkNames.find((candidate) => candidate === parts[2]);
    if (name === undefined) return json({ error: "No such check." }, 404);
    return json(await eva.runCheck(name));
  }
  if (parts[0] === "api" && parts[1] === "schedules") return schedulesRoute(request, method, parts[2], eva);
  if (method === "POST" && parts[0] === "api" && parts[1] === "approvals" && parts[2] !== undefined) {
    const { answer } = approvalSchema.parse(await request.json());
    eva.sessions.answerApproval(decodeURIComponent(parts[2]), answer);
    return new Response(null, { status: 204 });
  }
  return json({ error: "Not found." }, 404);
}

/** The schedules of `.eva/schedules.json`: list, add or replace, remove. */
async function schedulesRoute(
  request: Request,
  method: string,
  scheduleId: string | undefined,
  eva: Eva,
): Promise<Response> {
  const schedules = eva.schedules;
  if (schedules === null) return json({ error: "No vault is configured." }, 409);
  if (method === "GET" && scheduleId === undefined) return json(schedules.list());
  if (method === "POST" && scheduleId === undefined) {
    return json(schedules.save(scheduleEntrySchema.parse(await request.json())), 201);
  }
  if (method === "DELETE" && scheduleId !== undefined) {
    return schedules.remove(decodeURIComponent(scheduleId))
      ? new Response(null, { status: 204 })
      : json({ error: "No such schedule." }, 404);
  }
  return json({ error: "Not found." }, 404);
}

/** An EvaError message can hold a value from the request or from git, so it is redacted first (lesson 95). */
function errorResponse(error: unknown, eva: Eva): Response {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return json({ error: "The request body is invalid." }, 400);
  if (!isEvaError(error)) return json({ error: "Eva failed to handle the request." }, 500);
  const body = { error: eva.redact(error.message) };
  if (isEvaError(error, "session_not_found") || isEvaError(error, "project_not_found")) return json(body, 404);
  if (isEvaError(error, "config_invalid") || isEvaError(error, "schedule_invalid")) return json(body, 400);
  if (isEvaError(error, "rate_limited")) return json(body, 429);
  return json(body, 409);
}

/**
 * The Tailscale account that `tailscale serve` names for a request to a remote host name, when
 * the allowlist holds it, or null. It decides only who may ask for a device login: a local program
 * can forge the header, so it never authenticates a request alone.
 */
function allowedTailscaleAccount(request: Request, options: LocalApiOptions): string | null {
  const host = hostNameOf(request.headers.get("host"));
  const identity = request.headers.get("tailscale-user-login");
  const remote = host !== null && host !== "127.0.0.1" && host !== "localhost";
  return remote && identity !== null && options.allowedTailscaleIdentities.includes(identity) ? identity : null;
}

function hasValidToken(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : null;
  const cookie = cookieValue(request, tokenCookie);
  return [bearer, cookie].some((candidate) => candidate !== null && sameText(candidate, token));
}

function hasValidDeviceCookie(request: Request, eva: Eva): boolean {
  const deviceToken = cookieValue(request, deviceCookie);
  return deviceToken !== null && eva.deviceLogins.isValidToken(deviceToken);
}

function cookieValue(request: Request, name: string): string | null {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
}

/** A strict, HTTP-only cookie; Secure when `tailscale serve` forwards HTTPS. Max-Age 0 clears it. */
function cookieHeader(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = request.headers.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(maxAgeSeconds)}${secure}`;
}

function sameText(first: string, second: string): boolean {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostNameOf(hostHeader: string | null): string | null {
  if (hostHeader === null || hostHeader.length === 0) return null;
  return hostHeader
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** A route value must be a Response: the single executable refuses a `Bun.file` there. */
function staticFile(path: string, contentType: string): Response {
  return new Response(readFileSync(path), { headers: { "content-type": contentType } });
}

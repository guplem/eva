/**
 * The local API of one Eva instance: HTTP for commands, a WebSocket for events
 * (docs/plan.md §4.3). It listens on the loopback address only; remote access goes through
 * `tailscale serve`. Every request passes the guards of §12 first.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import type { CheckName } from "../../core/checks.ts";
import type { Eva } from "../../core/eva.ts";
import webPage from "../web/index.html";
import icon192 from "../web/icons/icon-192.png" with { type: "file" };
import icon512 from "../web/icons/icon-512.png" with { type: "file" };
import iconSvg from "../web/icons/icon.svg" with { type: "file" };
import type { SessionEvent } from "../../shared/events.ts";
import { isEvaError } from "../../shared/errors.ts";

export interface LocalApiOptions {
  readonly eva: Eva;
  /** 0 picks a free port; the default instance uses 7420 (plan §4.4). */
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
/** The login cookie lives a year; the person logs out to end it. */
const cookieMaxAgeSeconds = 365 * 24 * 60 * 60;

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
    fetch: async (request, bunServer) => {
      const siteRefusal = guardSite(request, options, allowedHostNames);
      if (siteRefusal !== null) return siteRefusal;
      const url = new URL(request.url);
      if (url.pathname === "/api/login" || url.pathname === "/api/logout") return session(request, url, options.token);
      if (!hasValidToken(request, options.token) && !isAllowedTailscaleUser(request, options))
        return json({ error: "A valid token is required." }, 401);
      if (url.pathname === "/api/events") {
        return bunServer.upgrade(request, { data: { unsubscribe: null } })
          ? undefined
          : json({ error: "A WebSocket upgrade was expected." }, 400);
      }
      try {
        return await route(request, url, options.eva);
      } catch (error) {
        return errorResponse(error);
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

/** Login and logout for the web UI: a strict, HTTP-only cookie, never a token in a URL (plan §12). */
async function session(request: Request, url: URL, token: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  const secure = request.headers.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  if (url.pathname === "/api/logout") {
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": `eva_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` },
    });
  }
  let candidate: string;
  try {
    candidate = loginSchema.parse(await request.json()).token;
  } catch {
    return json({ error: "The request body is invalid." }, 400);
  }
  if (!sameText(candidate, token)) return json({ error: "This token is not valid." }, 401);
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": `eva_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(cookieMaxAgeSeconds)}${secure}`,
    },
  });
}

async function route(request: Request, url: URL, eva: Eva): Promise<Response> {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/status") return json(eva.status());
  if (method === "GET" && url.pathname === "/api/sessions") return json(eva.sessions.list());
  if (method === "GET" && url.pathname === "/api/approvals") return json(eva.sessions.pendingApprovals());
  if (method === "GET" && url.pathname === "/api/projects") {
    const status = statusSchema.parse(url.searchParams.get("status") ?? undefined);
    const text = url.searchParams.get("text");
    const tag = url.searchParams.get("tag");
    return json(
      eva.projects({
        ...(text === null ? {} : { text }),
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
  if (method === "POST" && url.pathname === "/api/vault/sync") return json(await eva.syncVault());
  if (method === "POST" && url.pathname === "/api/hub") return json(await eva.becomeHub());
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

/** The schedules of `.eva/schedules.json`: list, add or replace, remove (plan §9). */
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

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return json({ error: "The request body is invalid." }, 400);
  if (isEvaError(error, "session_not_found") || isEvaError(error, "project_not_found"))
    return json({ error: error.message }, 404);
  if (isEvaError(error, "config_invalid") || isEvaError(error, "schedule_invalid"))
    return json({ error: error.message }, 400);
  if (isEvaError(error)) return json({ error: error.message }, 409);
  return json({ error: "Eva failed to handle the request." }, 500);
}

/**
 * A request through `tailscale serve` carries the Tailscale account that Tailscale proved, so an
 * allowed account needs no token: the phone opens Eva with no login (plan §12). Only a remote host
 * name counts, and only with a non-empty allowlist; a local client still needs the token.
 */
function isAllowedTailscaleUser(request: Request, options: LocalApiOptions): boolean {
  const host = hostNameOf(request.headers.get("host"));
  const identity = request.headers.get("tailscale-user-login");
  return (
    host !== null &&
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    identity !== null &&
    options.allowedTailscaleIdentities.includes(identity)
  );
}

function hasValidToken(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : null;
  const cookie = /(?:^|;\s*)eva_token=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
  return [bearer, cookie].some((candidate) => candidate !== null && sameText(candidate, token));
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

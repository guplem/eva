/**
 * The local API of one Eva instance: HTTP for commands, a WebSocket for events.
 * It listens on the loopback address only; remote access goes through
 * `tailscale serve`. Every request passes the guards below first.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import { checkNames } from "../../core/checks.ts";
import type { Eva } from "../../core/eva.ts";
import { pageSecretNames } from "../../core/settings/live-settings.ts";
import { parseProjectQuery } from "../../core/projects/project-catalog.ts";
import type {
  DeviceLoginApprover,
  DeviceLoginEvent,
  DeviceLoginRequest,
} from "../../core/remote-access/device-logins.ts";
import type { TailnetSnapshot } from "../../core/remote-access/remote-access.ts";
import { changedFields } from "../../core/schedules/schedule-definitions.ts";
import webPage from "../web/index.html";
import icon192 from "../web/icons/icon-192.png" with { type: "file" };
import icon512 from "../web/icons/icon-512.png" with { type: "file" };
import iconSvg from "../web/icons/icon.svg" with { type: "file" };
import type { SessionEvent } from "../../shared/events.ts";
import { isEvaError } from "../../shared/errors.ts";
import { recentTurnsWithSteps, withRecentSteps, withRunState } from "./session-list.ts";

export interface LocalApiOptions {
  readonly eva: Eva;
  /** 0 picks a free port; the default instance uses 7420. */
  readonly port: number;
  readonly token: string;
  /** Host names other than the loopback ones, such as the instance's Tailscale name. */
  readonly extraHosts: readonly string[];
  /** When not empty, a request that `tailscale serve` marks with an identity must carry one of these. */
  readonly allowedTailscaleIdentities: readonly string[];
  /**
   * This machine's tailnet name and owner, read on each request: Tailscale can become ready
   * after the start. With no configured identities, only the owner gets in (plug and play).
   */
  readonly tailnet?: () => TailnetSnapshot | null;
  /** Seconds before Bun closes an idle request. Default: 255, the maximum. A test sets a short one. */
  readonly idleTimeoutSeconds?: number;
}

export interface LocalApi {
  readonly url: string;
  stop(): void;
}

interface SocketData {
  unsubscribe: (() => void)[];
  /** A web page, which shows device requests. `eva chat` opens a socket too, but shows none. */
  isPage: boolean;
  /** The device token of a device login, or null for a login with the token. A removal closes the socket. */
  deviceToken: string | null;
}

const modelSchema = z.enum(["default", "opus", "sonnet", "haiku"]).default("default");
const engineSchema = z.enum(["claude-code", "pi"]);
const newSessionSchema = z.object({
  mode: z.enum(["assistant", "project"]),
  model: modelSchema,
  engine: engineSchema.optional(),
  projectId: z.string().min(1).optional(),
  clone: z.string().min(1).optional(),
});
const messageSchema = z.object({ text: z.string().min(1) });
const forkSchema = z.object({ atMessageId: z.string().min(1) });
const retrySchema = z.object({ turnIndex: z.number().int().min(0) });
const renameSchema = z.object({ title: z.string() });
const approvalSchema = z.object({ answer: z.enum(["allow", "deny"]) });
const statusSchema = z.enum(["idea", "active", "paused", "closed"]).optional();
const loginSchema = z.object({ token: z.string().min(1) });
const newCloneSchema = z.object({ repositoryUrl: z.string().min(1).optional() });
const updateSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
});
const projectWorkSchema = z.object({ request: z.string().min(1), reportToSessionId: z.string().min(1).optional() });
/** A project file is a note: 1 MB is far more than one needs. */
const projectFileSchema = z.object({ version: z.string().min(1), text: z.string().max(1_000_000) });
const projectDetailsSchema = z.object({
  version: z.string().min(1),
  title: z.string().max(500),
  status: z.enum(["idea", "active", "paused", "closed"]).nullable(),
  tags: z.array(z.string().max(200)).max(100),
  repos: z.array(z.string().max(2_000)).max(100),
});
const settingsPatchSchema = z.record(z.string(), z.unknown());
const secretSchema = z.object({ value: z.string() });
const deviceCodeSchema = z.object({ code: z.string().min(1).max(20) });
/** The account of a browser on Eva's own computer, which has no Tailscale account. */
const localAccount = "this computer";
/** The address that Google sent the browser to, or its code alone. */
const googleLoginSchema = z.object({ address: z.string().min(1).max(10_000) });
const vaultCloneSchema = z.object({ repository: z.string().min(1).max(2_000) });
const vaultPushSchema = vaultCloneSchema;
const newVaultSchema = z.object({
  name: z.string().max(200),
  language: z.string().max(200),
  topics: z.array(z.string().max(200)).max(50),
  repository: z.string().max(2_000),
});
const claudeLoginSchema = z.object({ code: z.string().min(1).max(10_000) });
const conflictPickSchema = z.object({ path: z.string().min(1), choice: z.enum(["mine", "theirs", "both"]) });
/** The schedule rules live in the core; the API only needs an object. */
const scheduleEntrySchema = z.record(z.string(), z.unknown());
/** The rules go to a model with each first turn, so they stay short. */
const chatNameRulesSchema = z.object({ rules: z.string().max(4_000) });
const cardSeenSchema = z.object({ fields: z.record(z.string(), z.string()) });
const logsQuerySchema = z.object({
  level: z.enum(["warn", "error"]).default("warn"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
/** The login cookies live a year; the person logs out to end them. */
const cookieMaxAgeSeconds = 365 * 24 * 60 * 60;
const tokenCookie = "eva_token";
const deviceCookie = "eva_device";
/** The part of the browser's user agent that the device label keeps. */
const deviceLabelBrowserLength = 120;

export function startLocalApi(options: LocalApiOptions): LocalApi {
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const pages = new Set<ServerWebSocket<SocketData>>();
  const toPages = (event: DeviceLoginEvent): void => {
    for (const page of pages) page.send(JSON.stringify(event));
  };
  // A logged-in page is an approver too. A sleeping phone may keep a dead socket open, but
  // Telegram and the terminal still get each request.
  const pageApprover: DeviceLoginApprover = {
    name: "Eva page",
    canApprove: () => pages.size > 0,
    ask: (request) => toPages({ kind: "device_login_request", request: redactedRequest(request, options.eva) }),
    settled: (id, answer) => toPages({ kind: "device_login_settled", id, answer }),
  };
  const detachPageApprover = options.eva.deviceLogins.attachApprover(pageApprover);
  // The login is checked once, at the upgrade. So a removed device, such as a lost phone, would
  // keep its stream of events and stay an approver until its socket dropped.
  const stopForgetWatch = options.eva.deviceLogins.onForget(() => {
    for (const socket of sockets) {
      const deviceToken = socket.data.deviceToken;
      if (deviceToken !== null && !options.eva.deviceLogins.isValidToken(deviceToken)) socket.close();
    }
  });
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
    idleTimeout: options.idleTimeoutSeconds ?? 255,
    fetch: async (request, bunServer) => {
      const siteRefusal = guardSite(request, options);
      if (siteRefusal !== null) return siteRefusal;
      const url = new URL(request.url);
      if (url.pathname === "/api/login" || url.pathname === "/api/logout") return session(request, url, options);
      if (url.pathname === "/api/login/device" || url.pathname.startsWith("/api/login/device/"))
        return deviceLogin(request, url, options);
      // A Tailscale identity alone never authenticates: any program on this machine can forge the header.
      if (!hasValidToken(request, options.token) && !hasValidDeviceCookie(request, options.eva))
        return json({ error: "A valid token is required." }, 401);
      // The owner's rule: only a person with a shell as Eva's user, who can read the token, allows a device.
      if (url.pathname === "/api/devices/allow" && !hasValidToken(request, options.token))
        return json({ error: "Only the token, from a terminal on Eva's computer, can allow a device." }, 403);
      if (url.pathname === "/api/events") {
        return bunServer.upgrade(request, {
          data: {
            unsubscribe: [],
            isPage: url.searchParams.has("devices"),
            deviceToken: hasValidToken(request, options.token) ? null : cookieValue(request, deviceCookie),
          },
        })
          ? undefined
          : json({ error: "A WebSocket upgrade was expected." }, 400);
      }
      // Bun closes a request after 10 idle seconds. An engine check waits for a whole real turn,
      // a vault sync or pick waits for git's network steps, and the Google login waits for Google.
      // Each ends at its own timeout.
      if (
        url.pathname.startsWith("/api/checks/") ||
        url.pathname.startsWith("/api/vault/") ||
        url.pathname.startsWith("/api/google/")
      )
        bunServer.timeout(request, 0);
      try {
        return (await devices(request, url, options.eva, pageApprover)) ?? (await route(request, url, options.eva));
      } catch (error) {
        return errorResponse(error, options.eva);
      }
    },
    websocket: {
      open(socket: ServerWebSocket<SocketData>) {
        sockets.add(socket);
        if (socket.data.isPage) pages.add(socket);
        socket.data.unsubscribe.push(
          options.eva.sessions.subscribe((event: SessionEvent) => {
            socket.send(JSON.stringify(event));
          }),
        );
        const schedules = options.eva.schedules;
        if (schedules !== null) {
          socket.data.unsubscribe.push(
            schedules.subscribe((event) => {
              if (event.kind !== "schedule_card") return false;
              // Only a card that already waits, with these fields: a card that Telegram shows at once
              // never opens the dialog, and a tap never meets an older card. The page drops repeats.
              const waits = schedules
                .waitingCards()
                .some(
                  (card) =>
                    card.scheduleId === event.scheduleId && changedFields(card.fields, event.fields).length === 0,
                );
              if (waits) socket.send(JSON.stringify(event));
              // A socket is no proof that anyone saw the card: a sleeping phone keeps a dead
              // socket open. The card counts when the person confirms it over HTTP.
              return false;
            }),
          );
        }
      },
      message() {
        // Commands go over HTTP; the socket only carries events to the client.
      },
      close(socket: ServerWebSocket<SocketData>) {
        sockets.delete(socket);
        pages.delete(socket);
        for (const unsubscribe of socket.data.unsubscribe) unsubscribe();
      },
    },
  });

  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    stop: () => {
      detachPageApprover();
      stopForgetWatch();
      void server.stop(true);
    },
  };
}

/** Host, Origin and Tailscale identity checks. Returns a refusal, or null to go on. */
function guardSite(request: Request, options: LocalApiOptions): Response | null {
  const host = hostNameOf(request.headers.get("host"));
  if (host === null || !allowedHostNames(options).has(host)) return json({ error: "Unknown host." }, 403);

  // The whole origin must match, port included: a page on another local port shares the
  // host name and the SameSite cookie, but it is another site.
  const origin = request.headers.get("origin");
  if (origin !== null && safeHost(origin)?.toLowerCase() !== request.headers.get("host")?.toLowerCase()) {
    return json({ error: "Requests from other sites are refused." }, 403);
  }

  const identity = request.headers.get("tailscale-user-login");
  const allowed = allowedIdentities(options);
  // `tailscale serve` adds the identity header. A remote request without one is a tagged device or no Tailscale at all.
  const remote = !isLocalRequest(request);
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
 * Device login: a browser of an allowed Tailscale account, or on this computer, asks. The owner
 * allows it in Telegram or in the terminal, and the page polls until it gets the device cookie.
 * A browser asks only for itself: a request of another account looks expired.
 */
function deviceLogin(request: Request, url: URL, options: LocalApiOptions): Response {
  const account = deviceLoginAccount(request, options);
  if (account === null)
    return json({ error: "A device login works through Tailscale from an allowed account, or on this computer." }, 403);
  const deviceLogins = options.eva.deviceLogins;
  const id = decodeURIComponent(url.pathname.slice("/api/login/device/".length));
  try {
    if (request.method === "POST" && url.pathname === "/api/login/device") {
      const browser = (request.headers.get("user-agent") ?? "an unknown browser").slice(0, deviceLabelBrowserLength);
      return json(
        deviceLogins.request(account, `${account}, ${browser}`, { thisComputer: account === localAccount }),
        201,
      );
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

/**
 * The devices and the device requests, for Settings and for the page as an approver. A device login
 * may use them too: the person removes a lost phone, or allows a new one, from any allowed device.
 * Returns null for any other path.
 */
async function devices(
  request: Request,
  url: URL,
  eva: Eva,
  pageApprover: DeviceLoginApprover,
): Promise<Response | null> {
  const logins = eva.deviceLogins;
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (parts[0] !== "api" || parts[1] !== "devices") return null;
  const method = request.method;
  if (parts.length === 2 && method === "GET")
    return json(
      logins.list(cookieValue(request, deviceCookie)).map((device) => ({ ...device, label: eva.redact(device.label) })),
    );
  if (parts[2] === "requests") {
    if (parts.length === 3 && method === "GET")
      return json(logins.waitingFor(pageApprover).map((waiting) => redactedRequest(waiting, eva)));
    if (parts.length === 4 && method === "POST" && parts[3] !== undefined) {
      const { answer } = approvalSchema.parse(await request.json());
      if (!logins.answerAs(pageApprover, decodeURIComponent(parts[3]), answer))
        return json({ error: "This request no longer waits. It expired, or someone answered it." }, 404);
      return new Response(null, { status: 204 });
    }
    return null;
  }
  if (parts.length === 3 && method === "DELETE" && parts[2] !== undefined) {
    if (!logins.forgetById(decodeURIComponent(parts[2]))) return json({ error: "No device has this id." }, 404);
    return new Response(null, { status: 204 });
  }
  return null;
}

// A device login has the same control as the token: the owner chose this in #137.
async function route(request: Request, url: URL, eva: Eva): Promise<Response> {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/status") return json(eva.status());
  if (method === "GET" && url.pathname === "/api/versions") return json(await eva.versions());
  if (method === "GET" && url.pathname === "/api/sessions")
    return json(
      withRunState(withRecentSteps(eva.sessions.list(), recentTurnsWithSteps), (id) => eva.sessions.isTurnRunning(id)),
    );
  if (method === "GET" && url.pathname === "/api/approvals") return json(eva.sessions.pendingApprovals());
  if (method === "GET" && url.pathname === "/api/tasks") return json(eva.sessions.backgroundTasks());
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
  if (
    method === "DELETE" &&
    parts[0] === "api" &&
    parts[1] === "sessions" &&
    parts[2] !== undefined &&
    parts[3] === undefined
  ) {
    return json({ deleted: eva.sessions.delete(decodeURIComponent(parts[2])) });
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "sessions" && parts[2] !== undefined) {
    const sessionId = decodeURIComponent(parts[2]);
    const action = parts[3];
    if (action === "messages") {
      const { text } = messageSchema.parse(await request.json());
      eva.sessions.get(sessionId);
      void eva.sessions.send(sessionId, text, "api");
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
    if (action === "rename") {
      const { title } = renameSchema.parse(await request.json());
      return json(eva.sessions.rename(sessionId, title));
    }
    if (action === "model") {
      const { model } = z.object({ model: modelSchema.unwrap() }).parse(await request.json());
      return json(eva.sessions.setModel(sessionId, model));
    }
    if (action === "engine") {
      const { engine } = z.object({ engine: engineSchema }).parse(await request.json());
      return json(eva.sessions.setEngine(sessionId, engine));
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
  if (parts[0] === "api" && parts[1] === "projects" && parts[2] !== undefined && parts[3] === "file") {
    const projectId = decodeURIComponent(parts[2]);
    if (method === "GET") return json(eva.projectFile(projectId));
    if (method === "PUT") {
      const { version, text } = projectFileSchema.parse(await request.json());
      return json(eva.saveProjectFile(projectId, version, text));
    }
  }
  if (
    method === "PUT" &&
    parts[0] === "api" &&
    parts[1] === "projects" &&
    parts[2] !== undefined &&
    parts[3] === "details"
  ) {
    const { version, ...details } = projectDetailsSchema.parse(await request.json());
    return json(eva.saveProjectDetails(decodeURIComponent(parts[2]), version, details));
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
  if (method === "GET" && url.pathname === "/api/settings/setup") return json(await eva.setupState());
  if (method === "PUT" && url.pathname === "/api/settings") {
    return json(eva.updateSettings(settingsPatchSchema.parse(await request.json())));
  }
  if (parts[0] === "api" && parts[1] === "secrets" && parts.length === 3) {
    const name = pageSecretNames.find((candidate) => candidate === parts[2]);
    if (name === undefined) return json({ error: "The page cannot change this secret." }, 404);
    if (method === "PUT") return json(await eva.saveSecret(name, secretSchema.parse(await request.json()).value));
    if (method === "DELETE") return json(await eva.saveSecret(name, null));
  }
  if (method === "POST" && url.pathname.startsWith("/api/google/")) {
    if (url.pathname === "/api/google/login") return json(eva.startGoogleLogin());
    if (url.pathname === "/api/google/login/finish")
      return json(await eva.finishGoogleLogin(googleLoginSchema.parse(await request.json()).address));
  }
  if (method === "POST" && url.pathname === "/api/engines/claude-code/login") return json(await eva.startClaudeLogin());
  if (method === "POST" && url.pathname === "/api/engines/claude-code/login/finish")
    return json(await eva.finishClaudeLogin(claudeLoginSchema.parse(await request.json()).code));
  if (method === "DELETE" && url.pathname === "/api/devices") return json({ removed: eva.deviceLogins.forgetAll() });
  if (method === "POST" && url.pathname === "/api/devices/allow") {
    // Only the label comes back: the device token reaches only the browser that asked.
    const label = eva.deviceLogins.allowByCode(deviceCodeSchema.parse(await request.json()).code);
    if (label === null)
      return json({ error: "No device waits with this code. Check it, or ask again on the page." }, 404);
    return json({ label });
  }
  if (method === "POST" && url.pathname === "/api/vault/sync") return json(await eva.syncVault());
  if (method === "GET" && url.pathname === "/api/vault/repositories") return json(await eva.vaultRepositories());
  if (method === "POST" && url.pathname === "/api/vault/clone")
    return json(await eva.cloneVault(vaultCloneSchema.parse(await request.json()).repository));
  if (method === "POST" && url.pathname === "/api/vault/create")
    return json(await eva.createVault(newVaultSchema.parse(await request.json())));
  if (method === "POST" && url.pathname === "/api/vault/push")
    return json(await eva.pushVault(vaultPushSchema.parse(await request.json()).repository));
  if (url.pathname === "/api/vault/conflicts") {
    if (method === "GET") return json(await eva.vaultConflicts());
    if (method === "POST") {
      const { path, choice } = conflictPickSchema.parse(await request.json());
      return json(await eva.resolveVaultConflict(path, choice));
    }
  }
  if (method === "POST" && url.pathname === "/api/hub") return json(await eva.becomeHub());
  if (method === "POST" && url.pathname.startsWith("/api/remote-access/")) {
    const action = url.pathname.slice("/api/remote-access/".length);
    const access =
      action === "install" ? eva.installTailscale() : action === "sign-in" ? await eva.signInToTailscale() : undefined;
    if (access === null) return json({ error: "Phone access is off on this machine." }, 409);
    if (access !== undefined) return json(access);
  }
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
      const status =
        url.pathname === "/api/update"
          ? await eva.updateNow(updateSchema.parse(await optionalJson(request)).version)
          : await eva.checkForUpdate();
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
  if (url.pathname === "/api/chat-names") return chatNamesRoute(request, method, eva);
  if (parts[0] === "api" && parts[1] === "schedules") return schedulesRoute(request, method, parts[2], eva);
  if (parts[0] === "api" && parts[1] === "schedule-cards") return scheduleCardsRoute(request, method, parts[2], eva);
  if (method === "POST" && parts[0] === "api" && parts[1] === "approvals" && parts[2] !== undefined) {
    const { answer } = approvalSchema.parse(await request.json());
    eva.sessions.answerApproval(decodeURIComponent(parts[2]), answer);
    return new Response(null, { status: 204 });
  }
  return json({ error: "Not found." }, 404);
}

/** The person's rules for chat names, in `.eva/chat-names.md`: read or replace (issue 50). */
async function chatNamesRoute(request: Request, method: string, eva: Eva): Promise<Response> {
  const chatNames = eva.chatNames;
  if (chatNames === null) return json({ error: "No vault is configured." }, 409);
  if (method === "GET") return json({ rules: chatNames.rules() });
  if (method === "PUT") {
    const { rules } = chatNameRulesSchema.parse(await request.json());
    chatNames.saveRules(rules);
    return json({ rules: chatNames.rules() });
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

/** The setup cards that wait for the person (lesson 66): list them, or confirm one that the person saw. */
async function scheduleCardsRoute(
  request: Request,
  method: string,
  scheduleId: string | undefined,
  eva: Eva,
): Promise<Response> {
  const schedules = eva.schedules;
  if (method === "GET" && scheduleId === undefined) return json(schedules?.waitingCards() ?? []);
  if (method === "POST" && scheduleId !== undefined) {
    const { fields } = cardSeenSchema.parse(await request.json());
    return schedules?.confirmCard(decodeURIComponent(scheduleId), fields) === true
      ? new Response(null, { status: 204 })
      : json({ error: "This card changed or no longer waits. Look at the current card." }, 409);
  }
  return json({ error: "Not found." }, 404);
}

/** An EvaError message can hold a value from the request or from git, so it is redacted first (lesson 95). */
function errorResponse(error: unknown, eva: Eva): Response {
  // `decodeURIComponent` throws on a bad `%` escape in a path. That is the client's fault, not Eva's.
  if (error instanceof URIError) return json({ error: "The address is invalid." }, 400);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return json({ error: "The request body is invalid." }, 400);
  if (!isEvaError(error)) return json({ error: "Eva failed to handle the request." }, 500);
  // The code lets a page tell one failure from another that shares its status.
  const body = { error: eva.redact(error.message), code: error.code };
  if (isEvaError(error, "session_not_found") || isEvaError(error, "project_not_found")) return json(body, 404);
  if (
    isEvaError(error, "config_invalid") ||
    isEvaError(error, "schedule_invalid") ||
    isEvaError(error, "project_invalid") ||
    isEvaError(error, "title_invalid")
  )
    return json(body, 400);
  if (isEvaError(error, "rate_limited")) return json(body, 429);
  if (isEvaError(error, "setting_forbidden")) return json(body, 403);
  return json(body, 409);
}

/**
 * The Tailscale account that `tailscale serve` names for a request to a remote host name, when
 * the allowlist holds it, or null. It decides only who may ask for a device login: a local program
 * can forge the header, so it never authenticates a request alone.
 */
/** The account that may ask for a device login: an allowed Tailscale account, or this computer itself. */
function deviceLoginAccount(request: Request, options: LocalApiOptions): string | null {
  // Any program here can reach this address, but only a person at Eva's terminal can allow its code.
  if (isLocalRequest(request)) return localAccount;
  const identity = request.headers.get("tailscale-user-login");
  return identity !== null && allowedIdentities(options).includes(identity) ? identity : null;
}

/**
 * A request of a program on this computer. `tailscale serve` passes the Host header through and
 * adds X-Forwarded-For, so a forwarded request is remote whatever its host. A local program can
 * forge these headers too, but they only make it look remote, which grants nothing.
 */
function isLocalRequest(request: Request): boolean {
  const host = hostNameOf(request.headers.get("host"));
  return (
    (host === "127.0.0.1" || host === "localhost") &&
    request.headers.get("tailscale-user-login") === null &&
    request.headers.get("x-forwarded-for") === null &&
    request.headers.get("x-forwarded-proto") === null
  );
}

function allowedHostNames(options: LocalApiOptions): Set<string> {
  const tailnetHost = options.tailnet?.()?.hostName ?? null;
  return new Set(
    ["127.0.0.1", "localhost", ...options.extraHosts, ...(tailnetHost === null ? [] : [tailnetHost])].map((host) =>
      host.toLowerCase(),
    ),
  );
}

function allowedIdentities(options: LocalApiOptions): readonly string[] {
  if (options.allowedTailscaleIdentities.length > 0) return options.allowedTailscaleIdentities;
  const owner = options.tailnet?.()?.ownerLogin ?? null;
  return owner === null ? [] : [owner];
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

/** The JSON body, or `{}` for none: older scripts post to /api/update with no body. */
async function optionalJson(request: Request): Promise<unknown> {
  const text = await request.text();
  return text.trim() === "" ? {} : (JSON.parse(text) as unknown);
}

/** The account comes from a header, so it is redacted like any outside text. */
function redactedRequest(request: DeviceLoginRequest, eva: Eva): DeviceLoginRequest {
  return { ...request, account: eva.redact(request.account) };
}

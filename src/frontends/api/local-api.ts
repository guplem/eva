/**
 * The local API of one Eva instance: HTTP for commands, a WebSocket for events
 * (docs/plan.md §4.3). It listens on the loopback address only; remote access goes through
 * `tailscale serve`. Every request passes the guards of §12 first.
 */
import { timingSafeEqual } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import type { Eva } from "../../core/eva.ts";
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
  projectId: z.string().min(1).optional(),
  clone: z.string().min(1).optional(),
});
const messageSchema = z.object({ text: z.string().min(1) });
const forkSchema = z.object({ atMessageId: z.string().min(1) });
const retrySchema = z.object({ turnIndex: z.number().int().min(0) });
const approvalSchema = z.object({ answer: z.enum(["allow", "deny"]) });
const statusSchema = z.enum(["idea", "active", "paused", "closed"]).optional();

export function startLocalApi(options: LocalApiOptions): LocalApi {
  const allowedHostNames = new Set(["127.0.0.1", "localhost", ...options.extraHosts.map((host) => host.toLowerCase())]);

  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: options.port,
    fetch: async (request, bunServer) => {
      const refusal = guard(request, options, allowedHostNames);
      if (refusal !== null) return refusal;
      const url = new URL(request.url);
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

/** Host, Origin, token and Tailscale identity checks. Returns a refusal, or null to go on. */
function guard(request: Request, options: LocalApiOptions, allowedHostNames: ReadonlySet<string>): Response | null {
  const host = hostNameOf(request.headers.get("host"));
  if (host === null || !allowedHostNames.has(host)) return json({ error: "Unknown host." }, 403);

  const origin = request.headers.get("origin");
  if (origin !== null && !allowedHostNames.has(hostNameOf(safeHost(origin)) ?? "")) {
    return json({ error: "Requests from other sites are refused." }, 403);
  }

  const identity = request.headers.get("tailscale-user-login");
  if (
    identity !== null &&
    options.allowedTailscaleIdentities.length > 0 &&
    !options.allowedTailscaleIdentities.includes(identity)
  ) {
    return json({ error: "This Tailscale identity is not allowed." }, 403);
  }

  if (!hasValidToken(request, options.token)) return json({ error: "A valid token is required." }, 401);
  return null;
}

async function route(request: Request, url: URL, eva: Eva): Promise<Response> {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/status") return json(eva.status());
  if (method === "GET" && url.pathname === "/api/sessions") return json(eva.sessions.list());
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
    if (input.mode === "assistant") return json(eva.createAssistantSession({ source: "web", model: input.model }), 201);
    if (input.projectId === undefined) return json({ error: "A Project chat needs a projectId." }, 400);
    const session = await eva.createProjectSession({
      projectId: input.projectId,
      source: "web",
      model: input.model,
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
    if (action === "retry") {
      const { turnIndex } = retrySchema.parse(await request.json());
      return json(await eva.sessions.retry(sessionId, turnIndex));
    }
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "approvals" && parts[2] !== undefined) {
    const { answer } = approvalSchema.parse(await request.json());
    eva.sessions.answerApproval(decodeURIComponent(parts[2]), answer);
    return new Response(null, { status: 204 });
  }
  return json({ error: "Not found." }, 404);
}

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return json({ error: "The request body is invalid." }, 400);
  if (isEvaError(error, "session_not_found") || isEvaError(error, "project_not_found"))
    return json({ error: error.message }, 404);
  if (isEvaError(error)) return json({ error: error.message }, 409);
  return json({ error: "Eva failed to handle the request." }, 500);
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

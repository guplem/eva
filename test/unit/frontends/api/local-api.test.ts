import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import type { DeviceLoginRequest } from "../../../../src/core/instance/device-logins.ts";
import { defaultConfig, homePaths } from "../../../../src/core/instance/home.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import type { SessionEvent } from "../../../../src/shared/events.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const token = "local-api-token-for-tests";
let sandbox: GitSandbox;
let home: string;
let eva: Eva;
let api: LocalApi;
let engine: FakeEngine;
/** The fixture engine runs this script; a test may replace it before its first turn. */
let turnScript: FakeTurnScript | null;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(`${api.url}${path}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? headers(),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(() => {
  sandbox = createGitSandbox();
  const vault = sandbox.clone("vault");
  sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
  sandbox.write(
    vault,
    "Projects/2025-03-02-1015-example-app/AGENTS.md",
    "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n",
  );
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "files");
  sandbox.git(vault, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-api-"));
  turnScript = null;
  engine = new FakeEngine((request, turnNumber) =>
    turnScript === null ? FakeEngine.answer(request, `answer ${String(turnNumber)}`) : turnScript(request, turnNumber),
  );
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
    secrets: {},
    engines: [engine],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
    gatherMs: 5,
  });
  api = startLocalApi({
    eva,
    port: 0,
    token,
    extraHosts: ["eva.example-tailnet.ts.net"],
    allowedTailscaleIdentities: ["owner@example.com"],
  });
}, gitHookTimeoutMs);
afterEach(async () => {
  await eva.idle();
  api.stop();
  eva.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("guards (plan §12)", () => {
  test("listens on the loopback address only", () => {
    expect(api.url).toStartWith("http://127.0.0.1:");
  });

  test("refuses a request with no token or a wrong token", async () => {
    expect((await call("/api/status", { headers: {} })).status).toBe(401);
    expect((await call("/api/status", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  test("accepts the token as a cookie, for the web UI", async () => {
    expect((await call("/api/status", { headers: { cookie: `eva_token=${token}` } })).status).toBe(200);
  });

  test("refuses an unknown Host, against DNS rebinding", async () => {
    expect((await call("/api/status", { headers: headers({ host: "attacker.example" }) })).status).toBe(403);
    const remote = headers({ host: "eva.example-tailnet.ts.net", "tailscale-user-login": "owner@example.com" });
    expect((await call("/api/status", { headers: remote })).status).toBe(200);
  });

  test("refuses a remote request without a Tailscale identity when an allowlist exists", async () => {
    expect((await call("/api/status", { headers: headers({ host: "eva.example-tailnet.ts.net" }) })).status).toBe(403);
  });

  test("refuses a foreign Origin, against cross-site requests", async () => {
    const response = await call("/api/sessions", {
      method: "POST",
      body: { mode: "assistant" },
      headers: headers({ origin: "https://attacker.example" }),
    });
    expect(response.status).toBe(403);
  });

  test("refuses a page on another local port, which shares the host name and the cookie", async () => {
    const port = new URL(api.url).port;
    const otherPort = await call("/api/sessions", {
      method: "POST",
      body: { mode: "assistant" },
      headers: headers({ origin: "http://127.0.0.1:3000", cookie: `eva_token=${token}` }),
    });
    expect(otherPort.status).toBe(403);
    const sameOrigin = await call("/api/status", { headers: headers({ origin: `http://127.0.0.1:${port}` }) });
    expect(sameOrigin.status).toBe(200);
  });

  test("a Tailscale identity alone never authenticates: a forged header on 127.0.0.1 gets a 401", async () => {
    // Any program on the machine can send these headers, also an agent that Eva runs.
    const forged = { host: "eva.example-tailnet.ts.net", "tailscale-user-login": "owner@example.com" };
    expect((await call("/api/status", { headers: forged })).status).toBe(401);
    expect(
      (await call("/api/approvals/any", { method: "POST", body: { answer: "allow" }, headers: forged })).status,
    ).toBe(401);
    expect(
      (await call("/api/status", { headers: { ...forged, "tailscale-user-login": "stranger@example.com" } })).status,
    ).toBe(403);
    expect((await call("/api/status", { headers: { "tailscale-user-login": "owner@example.com" } })).status).toBe(401);
    expect((await call("/api/status", { headers: { host: "eva.example-tailnet.ts.net" } })).status).toBe(403);
  });

  test("refuses a Tailscale identity that is not on the allowlist", async () => {
    expect(
      (await call("/api/status", { headers: headers({ "tailscale-user-login": "stranger@example.com" }) })).status,
    ).toBe(403);
    expect(
      (await call("/api/status", { headers: headers({ "tailscale-user-login": "owner@example.com" }) })).status,
    ).toBe(200);
  });
});

describe("device login (plan §12)", () => {
  const tailnet = { host: "eva.example-tailnet.ts.net", "tailscale-user-login": "owner@example.com" };
  let asked: DeviceLoginRequest[];

  function attachApprover(canApprove = true): void {
    eva.deviceLogins.attachApprover({ canApprove: () => canApprove, ask: (request) => asked.push(request) });
  }

  async function requestLogin(extra: Record<string, string> = {}): Promise<Response> {
    return call("/api/login/device", { method: "POST", headers: { ...tailnet, ...extra } });
  }

  /** Runs the whole flow, and returns the `set-cookie` header of the answer that allowed the device. */
  async function allowedCookie(extra: Record<string, string> = {}): Promise<string> {
    const request = await json<DeviceLoginRequest>(await requestLogin(extra));
    eva.deviceLogins.answer(request.id, "allow");
    const answer = await call(`/api/login/device/${request.id}`, { headers: { ...tailnet, ...extra } });
    return answer.headers.get("set-cookie") ?? "";
  }

  function deviceCookieOf(setCookie: string): string {
    return /eva_device=[^;]+/.exec(setCookie)?.[0] ?? "";
  }

  beforeEach(() => {
    asked = [];
  });

  test("an allowed account asks, the owner allows, and the page gets a strict, HTTP-only device cookie for a year", async () => {
    attachApprover();
    const created = await requestLogin();
    expect(created.status).toBe(201);
    const request = await json<DeviceLoginRequest>(created);
    expect(request.account).toBe("owner@example.com");
    expect(asked.map((entry) => entry.code)).toEqual([request.code]);
    expect(await json<unknown>(await call(`/api/login/device/${request.id}`, { headers: tailnet }))).toEqual({
      state: "pending",
    });
    eva.deviceLogins.answer(request.id, "allow");
    const allowed = await call(`/api/login/device/${request.id}`, { headers: tailnet });
    expect(await json<unknown>(allowed)).toEqual({ state: "allowed" });
    const setCookie = allowed.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("eva_device=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain(`Max-Age=${String(365 * 24 * 60 * 60)}`);
    expect(setCookie).not.toContain("Secure");
    const cookie = deviceCookieOf(setCookie);
    expect((await call("/api/status", { headers: { ...tailnet, cookie } })).status).toBe(200);
    expect((await call("/api/status", { headers: { cookie } })).status).toBe(200);
    expect((await call("/api/status", { headers: { ...tailnet, cookie: "eva_device=forged" } })).status).toBe(401);
  });

  test("behind HTTPS the device cookie is Secure", async () => {
    attachApprover();
    expect(await allowedCookie({ "x-forwarded-proto": "https" })).toContain("Secure");
  });

  test("a denied request gives no cookie", async () => {
    attachApprover();
    const request = await json<DeviceLoginRequest>(await requestLogin());
    eva.deviceLogins.answer(request.id, "deny");
    const denied = await call(`/api/login/device/${request.id}`, { headers: tailnet });
    expect(await json<unknown>(denied)).toEqual({ state: "denied" });
    expect(denied.headers.get("set-cookie")).toBeNull();
  });

  test("only an allowed Tailscale account on the tailnet name may ask", async () => {
    attachApprover();
    expect((await call("/api/login/device", { method: "POST", headers: {} })).status).toBe(403);
    expect((await call("/api/login/device", { method: "POST", headers: headers() })).status).toBe(403);
    expect((await requestLogin({ "tailscale-user-login": "stranger@example.com" })).status).toBe(403);
    expect((await call("/api/login/device/unknown", { headers: {} })).status).toBe(403);
    expect((await call("/api/login/device", { method: "PUT", headers: tailnet })).status).toBe(404);
    expect(asked).toEqual([]);
  });

  test("another account cannot collect the cookie of a request", async () => {
    const shared = startLocalApi({
      eva,
      port: 0,
      token,
      extraHosts: ["eva.example-tailnet.ts.net"],
      allowedTailscaleIdentities: ["owner@example.com", "partner@example.com"],
    });
    try {
      attachApprover();
      const created = await fetch(`${shared.url}/api/login/device`, { method: "POST", headers: tailnet });
      const request = await json<DeviceLoginRequest>(created);
      eva.deviceLogins.answer(request.id, "allow");
      const stolen = await fetch(`${shared.url}/api/login/device/${request.id}`, {
        headers: { ...tailnet, "tailscale-user-login": "partner@example.com" },
      });
      expect(await json<unknown>(stolen)).toEqual({ state: "expired" });
      expect(stolen.headers.get("set-cookie")).toBeNull();
    } finally {
      shared.stop();
    }
  });

  test("without a Telegram bot that can ask, the page learns why and falls back to the token", async () => {
    const refused = await requestLogin();
    expect(refused.status).toBe(409);
    expect((await json<{ error: string }>(refused)).error).toContain("Telegram");
    attachApprover(false);
    expect((await requestLogin()).status).toBe(409);
  });

  test("too many requests in 10 minutes are refused with a 429", async () => {
    attachApprover();
    for (let count = 0; count < 5; count += 1) expect((await requestLogin()).status).toBe(201);
    expect((await requestLogin()).status).toBe(429);
    expect(asked).toHaveLength(5);
  });

  test("logout clears both cookies and logs the device out", async () => {
    attachApprover();
    const cookie = deviceCookieOf(await allowedCookie());
    const logout = await call("/api/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(204);
    const cleared = logout.headers.getSetCookie();
    expect(cleared.some((line) => line.startsWith("eva_token=;") && line.includes("Max-Age=0"))).toBe(true);
    expect(cleared.some((line) => line.startsWith("eva_device=;") && line.includes("Max-Age=0"))).toBe(true);
    expect((await call("/api/status", { headers: { cookie } })).status).toBe(401);
  });

  test("Log out every device ends every device login, and needs a login itself", async () => {
    attachApprover();
    const first = deviceCookieOf(await allowedCookie());
    const second = deviceCookieOf(await allowedCookie());
    expect((await call("/api/devices", { method: "DELETE", headers: {} })).status).toBe(401);
    const removed = await call("/api/devices", { method: "DELETE", headers: { cookie: first } });
    expect(await json<unknown>(removed)).toEqual({ removed: 2 });
    expect((await call("/api/status", { headers: { cookie: first } })).status).toBe(401);
    expect((await call("/api/status", { headers: { cookie: second } })).status).toBe(401);
  });
});

describe("routes", () => {
  test("status reports the vault and its sync state", async () => {
    const status = await json<{ vaultPath: string; vaultSync: { status: string } }>(await call("/api/status"));
    expect(status.vaultSync.status).toBe("ok");
    expect(status.vaultPath).toContain("vault");
  });

  test("a chat: create it, send a message, and read the events on the WebSocket", async () => {
    const events: SessionEvent[] = [];
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/api/events`, {
      headers: headers(),
    } as unknown as string[]);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data)) as SessionEvent));

    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant", model: "default" } }),
    );
    expect(
      (await call(`/api/sessions/${session.id}/messages`, { method: "POST", body: { text: "Hello" } })).status,
    ).toBe(202);
    while (!events.some((event) => event.kind === "turn_finished")) await Bun.sleep(10);
    socket.close();

    expect(events.map((event) => event.kind)).toEqual(["text", "turn_finished"]);
    const listed = await json<{ id: string; turns: unknown[] }[]>(await call("/api/sessions"));
    expect(listed.find((entry) => entry.id === session.id)?.turns).toHaveLength(1);
  });

  test("a WebSocket with no token is refused", async () => {
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/api/events`);
    const outcome = await new Promise<string>((resolve) => {
      socket.addEventListener("open", () => resolve("open"));
      socket.addEventListener("error", () => resolve("refused"));
      socket.addEventListener("close", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  test("fork and retry make new branches", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    await eva.sessions.send(session.id, "one");
    const atMessageId = eva.sessions.get(session.id).turns[0]?.lastMessageId;
    const fork = await json<{ parentId: string }>(
      await call(`/api/sessions/${session.id}/fork`, { method: "POST", body: { atMessageId } }),
    );
    expect(fork.parentId).toBe(session.id);
    const retry = await call(`/api/sessions/${session.id}/retry`, { method: "POST", body: { turnIndex: 0 } });
    expect(retry.status).toBe(200);
  });

  test("searches projects", async () => {
    const projects = await json<{ id: string }[]>(await call("/api/projects?text=example&status=active"));
    expect(projects.map((project) => project.id)).toEqual(["2025-03-02-1015-example-app"]);
  });

  test("an unknown session is a 404, and a bad body is a 400", async () => {
    expect((await call("/api/sessions/missing/messages", { method: "POST", body: { text: "x" } })).status).toBe(404);
    expect((await call("/api/sessions", { method: "POST", body: { mode: "dreaming" } })).status).toBe(400);
    expect((await call("/api/nothing-here")).status).toBe(404);
  });

  test("an error message leaves the API redacted (lesson 95)", async () => {
    const secretShaped = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const response = await call(`/api/sessions/${secretShaped}/messages`, { method: "POST", body: { text: "x" } });
    expect(response.status).toBe(404);
    const message = (await json<{ error: string }>(response)).error;
    expect(message).toContain("[redacted]");
    expect(message).not.toContain(secretShaped);
  });

  test("an approval answer reaches the waiting turn", async () => {
    engine = new FakeEngine();
    const response = await call("/api/approvals/unknown-request", { method: "POST", body: { answer: "allow" } });
    expect(response.status).toBe(204);
  });

  test("lists the approvals that wait, so a client that reconnects can still answer them", async () => {
    expect(await json<unknown[]>(await call("/api/approvals"))).toEqual([]);
    turnScript = async function* (request) {
      await request.requestApproval({ requestId: "x", toolName: "Bash", summary: "gh issue create" });
      yield* FakeEngine.answer(request, "done");
    };
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const turn = eva.sessions.send(session.id, "go");
    let listed = await json<{ requestId: string }[]>(await call("/api/approvals"));
    while (listed.length === 0) {
      await Bun.sleep(10);
      listed = await json<{ requestId: string }[]>(await call("/api/approvals"));
    }
    expect(listed[0]).toMatchObject({ sessionId: session.id, toolName: "Bash", summary: "gh issue create" });
    eva.sessions.answerApproval(listed[0]?.requestId ?? "", "deny");
    await turn;
    expect(await json<unknown[]>(await call("/api/approvals"))).toEqual([]);
  });
});

describe("web routes (plan §8.3)", () => {
  test("the page itself loads with no token, so the person can log in", async () => {
    const response = await fetch(`${api.url}/`, { headers: { host: new URL(api.url).host } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<title>Eva</title>");
  });

  test("the web manifest and the icons load with no token, so the phone can add Eva to its home screen", async () => {
    const host = { host: new URL(api.url).host };
    const page = await (await fetch(`${api.url}/`, { headers: host })).text();
    const linkOf = (rel: string): string => new RegExp(`rel="${rel}"[^>]*href="([^"]+)"`).exec(page)?.[1] ?? "";
    const manifest = await fetch(new URL(linkOf("manifest"), api.url), { headers: host });
    expect(manifest.status).toBe(200);
    const body = JSON.parse(await manifest.text()) as { name: string; display: string; icons: { src: string }[] };
    expect(body).toMatchObject({ name: "Eva", display: "standalone", start_url: "/" });
    const iconPaths = [...body.icons.map((icon) => icon.src), linkOf("apple-touch-icon"), linkOf("icon")];
    for (const path of iconPaths) {
      const response = await fetch(new URL(path, api.url), { headers: host });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith("image/");
    }
  });

  test("login sets a strict, HTTP-only cookie for a valid token, and logout clears it", async () => {
    const refused = await call("/api/login", {
      method: "POST",
      body: { token: "wrong" },
      headers: { "content-type": "application/json" },
    });
    expect(refused.status).toBe(401);
    const accepted = await call("/api/login", {
      method: "POST",
      body: { token },
      headers: { "content-type": "application/json" },
    });
    expect(accepted.status).toBe(204);
    const cookie = accepted.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`eva_token=${token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const logout = await call("/api/logout", { method: "POST" });
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("a new chat can name its engine (plan §7.2)", async () => {
    const created = await json<{ engine: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant", engine: "pi" } }),
    );
    expect(created.engine).toBe("pi");
    expect((await call("/api/sessions", { method: "POST", body: { mode: "assistant", engine: "x" } })).status).toBe(
      400,
    );
  });

  test("project work: an unknown project is a 404, and a bad body a 400", async () => {
    expect((await call("/api/projects/missing/work", { method: "POST", body: { request: "x" } })).status).toBe(404);
    expect((await call("/api/projects/missing/work", { method: "POST", body: {} })).status).toBe(400);
  });

  test("a project's clones, and a new clone", async () => {
    expect(await json<unknown[]>(await call("/api/projects/2025-03-02-1015-example-app/clones"))).toEqual([]);
    const missing = await call("/api/projects/2025-03-02-1015-example-app/clones", { method: "POST", body: {} });
    expect(missing.status).toBe(404);
  });

  test("settings: read without secret values, write with a restart notice", async () => {
    const settings = await json<{ config: { timeZone: string }; secretsSet: Record<string, boolean> }>(
      await call("/api/settings"),
    );
    expect(settings.config.timeZone).toBe("UTC");
    expect(JSON.stringify(settings)).not.toContain(token);
    const saved = await call("/api/settings", { method: "PUT", body: { timeZone: "Europe/Madrid" } });
    expect(await json<{ saved: boolean; restartNeeded: boolean }>(saved)).toEqual({ saved: true, restartNeeded: true });
    expect((await call("/api/settings", { method: "PUT", body: { port: 5 } })).status).toBe(400);
  });

  test("a check runs by name, and an unknown check is a 404", async () => {
    const result = await json<{ ok: boolean }>(await call("/api/checks/vault", { method: "POST", body: {} }));
    expect(result.ok).toBe(true);
    expect((await call("/api/checks/everything", { method: "POST", body: {} })).status).toBe(404);
  });

  test("schedules: add, list, refuse an invalid one, and remove (plan §9)", async () => {
    const entry = { id: "morning", name: "Morning", at: "07:30", text: "Drink water." };
    expect((await call("/api/schedules", { method: "POST", body: entry })).status).toBe(201);
    const listed = await json<{ schedules: { schedule: { id: string }; nextRun: string }[] }>(
      await call("/api/schedules"),
    );
    expect(listed.schedules.map((view) => [view.schedule.id, view.nextRun])).toEqual([["morning", "2026-10-15T07:30"]]);
    const invalid = await call("/api/schedules", { method: "POST", body: { id: "x" } });
    expect(invalid.status).toBe(400);
    expect((await call("/api/schedules/morning", { method: "DELETE" })).status).toBe(204);
    expect((await call("/api/schedules/morning", { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/schedules/morning", { method: "PUT", body: {} })).status).toBe(404);
  });
});

describe("without a vault", () => {
  test("the schedules answer that no vault is configured", async () => {
    const bare = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [engine],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
    });
    const bareApi = startLocalApi({ eva: bare, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [] });
    try {
      const response = await fetch(`${bareApi.url}/api/schedules`, { headers: headers() });
      expect(response.status).toBe(409);
    } finally {
      bareApi.stop();
    }
  });
});

describe("updates and the vault sync", () => {
  test("without an update channel, the status is null and an update is refused", async () => {
    expect(await json<unknown>(await call("/api/update"))).toBeNull();
    expect((await call("/api/update", { method: "POST", body: {} })).status).toBe(409);
    expect((await call("/api/update/check", { method: "POST", body: {} })).status).toBe(409);
  });

  test("Make this machine the hub answers with the new status", async () => {
    const response = await call("/api/hub", { method: "POST", body: {} });
    expect(await json<{ role: string }>(response)).toMatchObject({ role: "hub" });
  });

  test("Sync now answers with the sync state", async () => {
    const response = await call("/api/vault/sync", { method: "POST", body: {} });
    expect(response.status).toBe(200);
    expect(await json<{ status: string }>(response)).toMatchObject({ status: "ok" });
  });
});

describe("an Eva with an update channel", () => {
  test("the API checks, then installs", async () => {
    const restarts: string[] = [];
    const updating = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true }),
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false }),
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    const updatingApi = startLocalApi({
      eva: updating,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
    });
    try {
      const post = (path: string): Promise<Response> =>
        fetch(`${updatingApi.url}${path}`, { method: "POST", headers: headers(), body: "{}" });
      expect(await json<unknown>(await post("/api/update/check"))).toMatchObject({ available: true, latest: "0.2.0" });
      expect(await json<unknown>(await post("/api/update"))).toMatchObject({ phase: "restarting" });
      expect(restarts).toEqual(["restart"]);
    } finally {
      updatingApi.stop();
      updating.stop();
    }
  });
});

describe("problems, logs and restart", () => {
  test("the status carries the open problems", async () => {
    eva.reportProblem("vault_sync", { level: "error", message: "The vault sync failed.", resolvedMessage: "Fixed." });
    expect(await json<{ problems: string[] }>(await call("/api/status"))).toMatchObject({
      problems: ["The vault sync failed."],
    });
  });

  test("GET /api/logs gives the last warnings and errors, and the error level only errors", async () => {
    const folder = homePaths(home).logsFolder;
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "eva-2026-10-14.jsonl"),
      [
        { at: "2026-10-14T09:00:00.000Z", level: "warn", message: "A warning.", details: { reason: "slow" } },
        { at: "2026-10-14T10:00:00.000Z", level: "error", message: "An error." },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    expect(await json<unknown>(await call("/api/logs?limit=5"))).toEqual([
      { at: "2026-10-14T09:00:00.000Z", level: "warn", message: "A warning.", summary: "reason: slow" },
      { at: "2026-10-14T10:00:00.000Z", level: "error", message: "An error.", summary: "" },
    ]);
    expect(await json<{ message: string }[]>(await call("/api/logs?level=error"))).toMatchObject([
      { message: "An error." },
    ]);
    expect((await call("/api/logs?level=info")).status).toBe(400);
    expect((await call("/api/logs?limit=many")).status).toBe(400);
  });

  test("POST /api/restart answers first, then restarts Eva through the update path", async () => {
    const restarts: string[] = [];
    const restarting = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      restartForUpdate: () => restarts.push("restart"),
    });
    const restartingApi = startLocalApi({
      eva: restarting,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
    });
    try {
      const response = await fetch(`${restartingApi.url}/api/restart`, {
        method: "POST",
        headers: headers(),
        body: "{}",
      });
      expect(response.status).toBe(202);
      expect(restarts).toEqual([]);
      for (let round = 0; round < 200 && restarts.length === 0; round += 1) await Bun.sleep(10);
      expect(restarts).toEqual(["restart"]);
    } finally {
      restartingApi.stop();
      restarting.stop();
    }
  });
});

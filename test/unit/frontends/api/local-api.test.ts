import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/instance/home.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import type { SessionEvent } from "../../../../src/shared/events.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const token = "local-api-token-for-tests";
let sandbox: GitSandbox;
let home: string;
let eva: Eva;
let api: LocalApi;
let engine: FakeEngine;

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
  engine = new FakeEngine();
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

  test("refuses a Tailscale identity that is not on the allowlist", async () => {
    expect(
      (await call("/api/status", { headers: headers({ "tailscale-user-login": "stranger@example.com" }) })).status,
    ).toBe(403);
    expect(
      (await call("/api/status", { headers: headers({ "tailscale-user-login": "owner@example.com" }) })).status,
    ).toBe(200);
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

  test("an approval answer reaches the waiting turn", async () => {
    engine = new FakeEngine();
    const response = await call("/api/approvals/unknown-request", { method: "POST", body: { answer: "allow" } });
    expect(response.status).toBe(204);
  });
});

describe("web routes (plan §8.3)", () => {
  test("the page itself loads with no token, so the person can log in", async () => {
    const response = await fetch(`${api.url}/`, { headers: { host: new URL(api.url).host } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<title>Eva</title>");
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

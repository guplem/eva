import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeTailscale, needsLoginStatus, runningStatus } from "../../../support/fake-tailscale.ts";
import type { RemoteAccess, RemoteAccessWatcher } from "../../../../src/core/remote-access/remote-access.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import type { DeviceLoginEvent, DeviceLoginRequest } from "../../../../src/core/remote-access/device-logins.ts";
import { defaultConfig, homePaths, loadSecrets } from "../../../../src/core/settings/home.ts";
import { loggedPath, startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { recentTurnsWithSteps } from "../../../../src/frontends/api/session-list.ts";
import type { SessionEvent } from "../../../../src/shared/events.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { fakeGh } from "../../../support/fake-gh.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const token = "local-api-token-for-tests";
let sandbox: GitSandbox;
let home: string;
let eva: Eva;
/** The push addresses that Eva sent to. */
let pushed: string[] = [];
let api: LocalApi;
let engine: FakeEngine;
/** The fixture engine runs this script; a test may replace it before its first turn. */
let turnScript: FakeTurnScript | null;
/**
 * A GitHub API that refuses every token, so a saved GitHub token never reaches github.com. It
 * lists two releases for the changelog, and counts how often Eva reads them.
 */
let githubApi: ReturnType<typeof Bun.serve>;
let releaseReads = 0;
beforeAll(() => {
  githubApi = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/repos/guplem/eva/releases"
        ? (releaseReads++,
          Response.json([
            {
              tag_name: "v9.1.0",
              body: "## New features\n\n- feat: voice notes (#7)\n",
              published_at: null,
              assets: [],
            },
            { tag_name: "v9.0.1", body: "", draft: true, assets: [] },
          ]))
        : Response.json({ message: "Bad credentials" }, { status: 401 }),
  });
});
afterAll(async () => {
  await githubApi.stop(true);
});

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
  pushed = [];
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
    // The turn sync runs git many times, and git is slow on Windows (#203).
    // The sync tests of the API use its sync route, which runs with the setting off too.
    config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC", sync: { ...defaultConfig.sync, enabled: false } },
    secrets: {},
    engines: [engine],
    runner: fakeGh(systemProcessRunner),
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
    gatherMs: 5,
    pushSender: (request) => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    },
    githubApiBaseUrl: `http://127.0.0.1:${String(githubApi.port)}`,
    // No test reaches the real releases.
    toolInstall: {
      ghReleaseUrl: "http://127.0.0.1:1/latest",
      ffmpegReleaseUrl: "http://127.0.0.1:1/ffmpeg",
      whisperReleaseUrl: "http://127.0.0.1:1/whisper",
      voiceModelUrl: "http://127.0.0.1:1/model",
    },
    toolLatestSources: { npmBaseUrl: "http://127.0.0.1:1", githubApiBaseUrl: "http://127.0.0.1:1" },
    // GitHub gives the token at once: no test waits for a person.
    githubBrowserLogin: (show) => {
      show("ABCD-1234", "https://github.com/login/device");
      return Promise.resolve("gho_example-page-login");
    },
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

describe("guards", () => {
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

  test("a refused Tailscale account learns which account it is, and how to let it in (#322)", async () => {
    // The page itself loads before any login; its first read gets the reason, and shows it.
    const stranger = { host: "eva.example-tailnet.ts.net", "tailscale-user-login": "stranger@example.com" };
    const refused = await call("/api/sessions", { headers: stranger });
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { error: string; code: string };
    expect(body.code).toBe("tailscale_account_refused");
    expect(body.error).toContain("stranger@example.com");
    expect(body.error).toContain("eva setup");
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

describe("device login", () => {
  const tailnet = { host: "eva.example-tailnet.ts.net", "tailscale-user-login": "owner@example.com" };
  let asked: DeviceLoginRequest[];

  function attachApprover(canApprove = true): void {
    eva.deviceLogins.attachApprover({
      name: "Telegram",
      canApprove: () => canApprove,
      ask: (request) => asked.push(request),
    });
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
    const noAccount = { host: "eva.example-tailnet.ts.net" };
    expect((await call("/api/login/device", { method: "POST", headers: noAccount })).status).toBe(403);
    expect((await requestLogin({ "tailscale-user-login": "stranger@example.com" })).status).toBe(403);
    expect((await call("/api/login/device/unknown", { headers: noAccount })).status).toBe(403);
    expect((await call("/api/login/device", { method: "PUT", headers: tailnet })).status).toBe(404);
    expect(asked).toEqual([]);
  });

  test("a bad escape in the login id is the client's fault: 400, not a crash", async () => {
    const answer = await call("/api/login/device/%E0", { headers: {} });
    expect(answer.status).toBe(400);
    expect(await json<unknown>(answer)).toEqual({ error: "The address is invalid." });
  });

  test("the page on Eva's own computer asks too, only the terminal answers, and only that browser collects the cookie", async () => {
    attachApprover();
    // Telegram alone cannot answer: any local program can make this request.
    expect((await call("/api/login/device", { method: "POST", headers: {} })).status).toBe(409);
    eva.deviceLogins.attachApprover({
      name: "terminal",
      servesThisComputer: true,
      canApprove: () => true,
      ask: () => undefined,
    });
    const created = await call("/api/login/device", { method: "POST", headers: {} });
    expect(created.status).toBe(201);
    const request = await json<DeviceLoginRequest>(created);
    expect(request.account).toBe("this computer");
    expect(request.approvers).toEqual(["terminal"]);
    expect(asked).toEqual([]);
    eva.deviceLogins.answer(request.id, "allow");
    const stolen = await call(`/api/login/device/${request.id}`, { headers: tailnet });
    expect(await json<unknown>(stolen)).toEqual({ state: "expired" });
  });

  test("a forwarded request is never this computer, even with a local host name", async () => {
    eva.deviceLogins.attachApprover({
      name: "terminal",
      servesThisComputer: true,
      canApprove: () => true,
      ask: () => undefined,
    });
    const forwarded = await call("/api/login/device", { method: "POST", headers: { "x-forwarded-for": "100.64.0.9" } });
    expect(forwarded.status).toBe(403);
  });

  test("only the token allows a device, never a device login: a lost phone cannot let more in", async () => {
    attachApprover();
    const cookie = deviceCookieOf(await allowedCookie());
    const request = await json<DeviceLoginRequest>(await requestLogin());
    const refused = await call("/api/devices/allow", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: { code: request.code },
    });
    expect(refused.status).toBe(403);
    expect(await json<unknown>(await call(`/api/login/device/${request.id}`, { headers: tailnet }))).toEqual({
      state: "pending",
    });
  });

  test("the terminal allows a device with its code, through the token", async () => {
    attachApprover();
    const request = await json<DeviceLoginRequest>(await requestLogin());
    const unknown = await call("/api/devices/allow", { method: "POST", body: { code: "ZZZZ" } });
    expect(unknown.status).toBe(404);
    const allowed = await call("/api/devices/allow", { method: "POST", body: { code: request.code } });
    expect(allowed.status).toBe(200);
    const body = await allowed.text();
    expect(JSON.parse(body)).toEqual({ label: expect.stringContaining("owner@example.com") as string });
    const collected = await call(`/api/login/device/${request.id}`, { headers: tailnet });
    expect(await json<unknown>(collected)).toEqual({ state: "allowed" });
    expect(body).not.toContain(deviceCookieOf(collected.headers.get("set-cookie") ?? "").slice("eva_device=".length));
    expect((await call("/api/devices/allow", { method: "POST", headers: {}, body: { code: "ZZZZ" } })).status).toBe(
      401,
    );
  });

  test("a login link from the terminal logs in a browser on this computer once, with no code (#407)", async () => {
    const created = await call("/api/devices/link", { method: "POST", body: {} });
    expect(created.status).toBe(201);
    const { secret } = await json<{ secret: string; expiresAt: string }>(created);
    const redeem = (extra: Record<string, string>, body: unknown = { secret }): Promise<Response> =>
      call("/api/login/link", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Example Browser", ...extra },
        body,
      });
    // A request through Tailscale is not on this computer, whatever the link.
    expect((await redeem(tailnet)).status).toBe(403);
    expect((await redeem({ "x-forwarded-for": "100.64.0.9" })).status).toBe(403);
    expect((await redeem({}, { secret: "wrong" })).status).toBe(401);
    expect((await redeem({}, { nothing: true })).status).toBe(400);
    const loggedIn = await redeem({});
    expect(loggedIn.status).toBe(204);
    const cookie = deviceCookieOf(loggedIn.headers.get("set-cookie") ?? "");
    expect((await call("/api/status", { headers: { cookie } })).status).toBe(200);
    expect(eva.deviceLogins.list(null).map((device) => device.label)).toEqual(["this computer, Example Browser"]);
    // Single use: a reload of the page, or another program, gets nothing.
    expect((await redeem({})).status).toBe(401);
  });

  test("only the token makes a login link: a device login or no login cannot", async () => {
    attachApprover();
    const cookie = deviceCookieOf(await allowedCookie());
    const asDevice = await call("/api/devices/link", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: {},
    });
    expect(asDevice.status).toBe(403);
    expect((await call("/api/devices/link", { method: "POST", headers: {}, body: {} })).status).toBe(401);
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

  test("with no approver that can ask, the page learns why and falls back to the token", async () => {
    const refused = await requestLogin();
    expect(refused.status).toBe(409);
    expect((await json<{ error: string }>(refused)).error).toContain("Log in with the token");
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

  test("a device login may save a project's details: they are vault content, not a machine setting", async () => {
    attachApprover();
    const device = { cookie: deviceCookieOf(await allowedCookie()), "content-type": "application/json" };
    const path = "/api/projects/2025-03-02-1015-example-app";
    const { version } = await json<{ version: string }>(await call(`${path}/file`, { headers: device }));
    const saved = await call(`${path}/details`, {
      method: "PUT",
      headers: device,
      body: { version, title: "From the phone", status: "active", tags: [], repos: [] },
    });
    expect(saved.status).toBe(200);
  });

  // The owner's choice in #137: an allowed device has the same control as the console.
  test("a device login changes every setting, machine and trust settings included", async () => {
    attachApprover();
    const cookie = deviceCookieOf(await allowedCookie());
    const device = { cookie, "content-type": "application/json" };
    for (const change of [
      { timeZone: "Europe/Madrid", projectRoots: ["/work"], sync: { sweepSeconds: 30 } },
      { remoteAccess: { allowedTailscaleIdentities: ["owner@example.com"] } },
      { trust: { trustedRepositoryOwners: ["me"] } },
    ]) {
      const saved = await call("/api/settings", { method: "PUT", headers: device, body: change });
      expect(saved.status).toBe(200);
    }
    expect(eva.publicSettings().config.trust.trustedRepositoryOwners).toEqual(["me"]);
  });

  test("a device login replaces and removes a token", async () => {
    attachApprover();
    const device = { cookie: deviceCookieOf(await allowedCookie()), "content-type": "application/json" };
    const replaced = await call("/api/secrets/claudeOauthToken", {
      method: "PUT",
      headers: device,
      body: { value: "sk-ant-oat-new-token" },
    });
    expect(replaced.status).toBe(200);
    expect(eva.publicSettings().secretsSet.claudeOauthToken).toBe(true);
    expect((await call("/api/secrets/claudeOauthToken", { method: "DELETE", headers: device })).status).toBe(200);
    expect(eva.publicSettings().secretsSet.claudeOauthToken).toBe(false);
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

  /** A logged-in page with its event socket open, and the events it gets. */
  async function openPage(cookie: string): Promise<{ events: DeviceLoginEvent[]; socket: WebSocket }> {
    const events: DeviceLoginEvent[] = [];
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/api/events?devices`, {
      headers: { cookie },
    } as unknown as string[]);
    openSockets.push(socket);
    socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data)) as DeviceLoginEvent));
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    return { events, socket };
  }

  async function until(condition: () => boolean): Promise<void> {
    for (let tries = 0; tries < 200; tries += 1) {
      if (condition()) return;
      await Bun.sleep(10);
    }
    throw new Error("The condition did not come true in 2 seconds.");
  }

  // A socket left open by a failed test would keep the page approver ready for the next test.
  let openSockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of openSockets) socket.close();
    openSockets = [];
  });

  test("removing a device closes its open page, which then stops being an approver", async () => {
    attachApprover();
    const phone = deviceCookieOf(await allowedCookie({ "user-agent": "a phone" }));
    const laptop = deviceCookieOf(await allowedCookie({ "user-agent": "a laptop" }));
    const phonePage = await openPage(phone);
    const laptopPage = await openPage(laptop);
    let phoneClosed = false;
    phonePage.socket.addEventListener("close", () => {
      phoneClosed = true;
    });
    const listed = await json<{ id: string; current: boolean }[]>(
      await call("/api/devices", { headers: { cookie: laptop } }),
    );
    const phoneId = listed.find((device) => !device.current)?.id ?? "";
    expect((await call(`/api/devices/${phoneId}`, { method: "DELETE", headers: { cookie: laptop } })).status).toBe(204);
    await until(() => phoneClosed);
    expect(laptopPage.socket.readyState).toBe(WebSocket.OPEN);
    expect((await call("/api/devices", { method: "DELETE", headers: { cookie: laptop } })).status).toBe(200);
    await until(() => laptopPage.socket.readyState === WebSocket.CLOSED);
  });

  test("a token page stays open when every device logs out", async () => {
    const page = await openPage(`eva_token=${token}`);
    expect((await call("/api/devices", { method: "DELETE" })).status).toBe(200);
    await Bun.sleep(50);
    expect(page.socket.readyState).toBe(WebSocket.OPEN);
  });

  test("a request from Eva's own computer never reaches the page: only the terminal answers it", async () => {
    eva.deviceLogins.attachApprover({
      name: "terminal",
      servesThisComputer: true,
      canApprove: () => true,
      ask: () => undefined,
    });
    const page = await openPage(`eva_token=${token}`);
    const created = await call("/api/login/device", { method: "POST", headers: {} });
    expect(created.status).toBe(201);
    const request = await json<DeviceLoginRequest>(created);
    expect(request.approvers).toEqual(["terminal"]);
    expect(await json<unknown>(await call("/api/devices/requests"))).toEqual([]);
    expect(
      (await call(`/api/devices/requests/${request.id}`, { method: "POST", body: { answer: "allow" } })).status,
    ).toBe(404);
    expect(page.events).toEqual([]);
  });

  test("the page cannot answer a request that it was not asked", async () => {
    attachApprover();
    const request = await json<DeviceLoginRequest>(await requestLogin());
    const answered = await call(`/api/devices/requests/${request.id}`, { method: "POST", body: { answer: "allow" } });
    expect(answered.status).toBe(404);
    expect(await json<unknown>(await call(`/api/login/device/${request.id}`, { headers: tailnet }))).toEqual({
      state: "pending",
    });
  });

  test("the device list redacts a secret in a label", async () => {
    attachApprover();
    const secretShaped = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    await allowedCookie({ "user-agent": `a browser ${secretShaped}` });
    const listed = JSON.stringify(await json<unknown>(await call("/api/devices")));
    expect(listed).toContain("[redacted]");
    expect(listed).not.toContain(secretShaped);
  });

  test("an allowed device's open page gets the request with its code, and allows it", async () => {
    attachApprover();
    const cookie = deviceCookieOf(await allowedCookie());
    asked = [];
    const page = await openPage(cookie);
    const request = await json<DeviceLoginRequest>(await requestLogin({ "user-agent": "a new phone" }));
    await until(() => page.events.length > 0);
    expect(page.events).toEqual([{ kind: "device_login_request", request }]);
    const waiting = await call("/api/devices/requests", { headers: { cookie } });
    expect(await json<unknown>(waiting)).toEqual([request]);
    const answered = await call(`/api/devices/requests/${request.id}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: { answer: "allow" },
    });
    expect(answered.status).toBe(204);
    await until(() => page.events.length > 1);
    expect(page.events[1]).toEqual({ kind: "device_login_settled", id: request.id, answer: "allow" });
    expect(await json<unknown>(await call(`/api/login/device/${request.id}`, { headers: tailnet }))).toEqual({
      state: "allowed",
    });
    expect(await json<unknown>(await call("/api/devices/requests", { headers: { cookie } }))).toEqual([]);
    page.socket.close();
  });

  test("the page approves only while a logged-in page has its socket open", async () => {
    const refused = await requestLogin();
    expect(refused.status).toBe(409);
    expect((await json<{ code: string }>(refused)).code).toBe("device_login_unavailable");
    const page = await openPage(`eva_token=${token}`);
    expect((await requestLogin()).status).toBe(201);
    page.socket.close();
    await until(() => !eva.deviceLogins.canApprove());
    expect((await requestLogin()).status).toBe(409);
  });

  test("a socket that shows no device requests, such as eva chat, is no approver", async () => {
    const chat = new WebSocket(`${api.url.replace("http", "ws")}/api/events`, {
      headers: headers(),
    } as unknown as string[]);
    await new Promise<void>((resolve) => chat.addEventListener("open", () => resolve()));
    expect(eva.deviceLogins.canApprove()).toBe(false);
    chat.close();
  });

  test("an answer to a request that no longer waits, or with no login, changes nothing", async () => {
    const page = await openPage(`eva_token=${token}`);
    const request = await json<DeviceLoginRequest>(await requestLogin());
    const path = `/api/devices/requests/${request.id}`;
    expect((await call(path, { method: "POST", headers: {}, body: { answer: "allow" } })).status).toBe(401);
    expect((await call(path, { method: "POST", body: { answer: "maybe" } })).status).toBe(400);
    expect((await call(path, { method: "POST", body: { answer: "deny" } })).status).toBe(204);
    const again = await call(path, { method: "POST", body: { answer: "allow" } });
    expect(again.status).toBe(404);
    expect(await json<unknown>(await call(`/api/login/device/${request.id}`, { headers: tailnet }))).toEqual({
      state: "denied",
    });
    page.socket.close();
  });

  test("Settings lists the devices, marks the caller's, and removes only one", async () => {
    attachApprover();
    const phone = deviceCookieOf(await allowedCookie({ "user-agent": "a phone" }));
    const laptop = deviceCookieOf(await allowedCookie({ "user-agent": "a laptop" }));
    expect((await call("/api/devices", { headers: {} })).status).toBe(401);
    const listed = await json<{ id: string; label: string; createdAt: string; current: boolean }[]>(
      await call("/api/devices", { headers: { cookie: laptop } }),
    );
    expect(listed.map(({ label, current }) => ({ label, current }))).toEqual([
      { label: "owner@example.com, a phone", current: false },
      { label: "owner@example.com, a laptop", current: true },
    ]);
    const phoneId = listed[0]?.id ?? "";
    expect((await call("/api/devices/0000000000000000", { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/devices/${phoneId}`, { method: "DELETE", headers: { cookie: laptop } })).status).toBe(204);
    expect((await call("/api/status", { headers: { cookie: phone } })).status).toBe(401);
    expect((await call("/api/status", { headers: { cookie: laptop } })).status).toBe(200);
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

    expect(events.map((event) => event.kind)).toEqual(["message_received", "text", "turn_finished"]);
    const listed = await json<{ id: string; turns: unknown[] }[]>(await call("/api/sessions"));
    expect(listed.find((entry) => entry.id === session.id)?.turns).toHaveLength(1);
  });

  test("serves the background tasks of a running turn, for a page that missed their events", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    turnScript = async function* (request) {
      yield { kind: "task_changed", taskId: "k1", description: "look around", state: "running" };
      await released;
      yield* FakeEngine.answer(request, "done");
    };
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const turn = eva.sessions.send(session.id, "go");
    try {
      const deadline = Date.now() + 5_000;
      while (eva.sessions.backgroundTasks().tasks.length === 0 && Date.now() < deadline) await Bun.sleep(5);
      expect((await json<{ tasks: unknown[] }>(await call("/api/tasks"))).tasks).toEqual([
        { taskId: "k1", sessionId: session.id, description: "look around", state: "running" },
      ]);
    } finally {
      release();
      await turn;
    }
    expect((await json<{ tasks: unknown[] }>(await call("/api/tasks"))).tasks).toEqual([]);
  });

  test("serves the steps of a running turn, for a page that missed their events", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    turnScript = async function* (request) {
      yield { kind: "text", text: "First block.", messageId: "m1" };
      await released;
      yield* FakeEngine.answer(request, "done");
    };
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const turn = eva.sessions.send(session.id, "go");
    try {
      const deadline = Date.now() + 5_000;
      while (eva.sessions.runningTurns().turns.at(0)?.steps.length !== 1 && Date.now() < deadline) await Bun.sleep(5);
      expect((await json<{ turns: unknown[] }>(await call("/api/turns"))).turns).toEqual([
        {
          sessionId: session.id,
          steps: [{ kind: "message", text: "First block.", isError: false, id: "m1" }],
          draft: "",
        },
      ]);
    } finally {
      release();
      await turn;
    }
    expect((await json<{ turns: unknown[] }>(await call("/api/turns"))).turns).toEqual([]);
  });

  test("the session list says which chat runs a turn, for a page that reloads mid-turn", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    turnScript = async function* (request) {
      await released;
      yield* FakeEngine.answer(request, "done");
    };
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const runningOf = async (): Promise<boolean | undefined> =>
      (await json<{ id: string; running: boolean }[]>(await call("/api/sessions"))).find(
        (entry) => entry.id === session.id,
      )?.running;
    expect(await runningOf()).toBe(false);
    const turn = eva.sessions.send(session.id, "go");
    try {
      const deadline = Date.now() + 5_000;
      while (!eva.sessions.isTurnRunning(session.id) && Date.now() < deadline) await Bun.sleep(5);
      expect(await runningOf()).toBe(true);
    } finally {
      release();
      await turn;
    }
    expect(await runningOf()).toBe(false);
  });

  test("the session list sends the steps of the recent turns only, and the store keeps them all", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    for (let count = 0; count <= recentTurnsWithSteps; count += 1) await eva.sessions.send(session.id, "go");
    const listed = (await json<{ id: string; turns: { steps: unknown[] }[] }[]>(await call("/api/sessions"))).find(
      (entry) => entry.id === session.id,
    );
    expect(listed?.turns.map((turn) => turn.steps.length)).toEqual([0, ...Array<number>(recentTurnsWithSteps).fill(1)]);
    expect(eva.sessions.get(session.id).turns[0]?.steps).toHaveLength(1);
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
    const preview = await call(`/api/sessions/${session.id}/retry-undo?turnIndex=0`);
    expect(await json(preview)).toEqual({ restore: [], changed: [], notKept: [], answers: 0 });
    const undone = await call(`/api/sessions/${session.id}/retry`, {
      method: "POST",
      body: { turnIndex: 0, undo: true },
    });
    expect(undone.status).toBe(200);
    expect((await call(`/api/sessions/${session.id}/retry-undo?turnIndex=x`)).status).toBe(400);
    expect((await call(`/api/sessions/${session.id}/retry-undo`)).status).toBe(400);
  });

  test("opens a new chat from a summary of a chat, and a 404 for an unknown chat (#522)", async () => {
    turnScript = (request) => FakeEngine.answer(request, request.mode === "model-call" ? "Goal: a trip." : "Sure.");
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    await eva.sessions.send(session.id, "Plan a trip");
    const response = await call(`/api/sessions/${session.id}/summary-chat`, { method: "POST", body: {} });
    expect(response.status).toBe(201);
    const made = await json<{ session: { continuedFrom: string; firstMessageDraft: string }; summaryFailure: null }>(
      response,
    );
    expect(made.session.continuedFrom).toBe(session.id);
    expect(made.session.firstMessageDraft).toContain("Goal: a trip.");
    expect(made.summaryFailure).toBeNull();
    const missing = await call("/api/sessions/missing/summary-chat", { method: "POST", body: {} });
    expect(missing.status).toBe(404);
  });

  test("gives the whole input and output of a step, null for an unknown step, and a 404 for an unknown chat", async () => {
    turnScript = (request) => [
      { kind: "tool_started", toolUseId: "t1", name: "Read", category: "tool", summary: "Read x", input: "{}" },
      { kind: "tool_finished", toolUseId: "t1", isError: false, output: "the file" },
      ...FakeEngine.answer(request, "done"),
    ];
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    await eva.sessions.send(session.id, "read it");
    expect(await json(await call(`/api/sessions/${session.id}/steps/t1`))).toEqual({
      input: "{}",
      output: "the file",
    });
    expect(await json(await call(`/api/sessions/${session.id}/steps/t9`))).toEqual({ input: null, output: null });
    expect((await call("/api/sessions/unknown/steps/t1")).status).toBe(404);
  });

  test("a delete removes the chat and its forks, and an unknown chat is a 404", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    await eva.sessions.send(session.id, "one");
    const fork = eva.sessions.fork(session.id, eva.sessions.get(session.id).turns[0]?.lastMessageId ?? "");
    const deleted = await call(`/api/sessions/${session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await json<{ deleted: string[] }>(deleted)).deleted.sort()).toEqual([session.id, fork.id].sort());
    expect(eva.sessions.list()).toEqual([]);
    expect((await call(`/api/sessions/${session.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("renames a chat, and refuses an empty title or an unknown chat", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const renamed = await call(`/api/sessions/${session.id}/rename`, { method: "POST", body: { title: "Trip plans" } });
    expect(renamed.status).toBe(200);
    expect((await json<{ title: string }>(renamed)).title).toBe("Trip plans");
    expect(eva.sessions.get(session.id).title).toBe("Trip plans");
    const empty = await call(`/api/sessions/${session.id}/rename`, { method: "POST", body: { title: "  " } });
    expect(empty.status).toBe(400);
    const missing = await call("/api/sessions/missing/rename", { method: "POST", body: { title: "Trip plans" } });
    expect(missing.status).toBe(404);
  });

  test("marks the turns of a chat as seen, and refuses a bad count or an unknown chat (issue 381)", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    // The chat has no turn yet, so no count can mark one as seen.
    const seen = await call(`/api/sessions/${session.id}/seen`, { method: "POST", body: { turnCount: 3 } });
    expect(seen.status).toBe(200);
    expect((await json<{ seenTurns: number }>(seen)).seenTurns).toBe(0);
    const bad = await call(`/api/sessions/${session.id}/seen`, { method: "POST", body: { turnCount: -1 } });
    expect(bad.status).toBe(400);
    const missing = await call("/api/sessions/missing/seen", { method: "POST", body: { turnCount: 1 } });
    expect(missing.status).toBe(404);
  });

  test("archives and brings back a chat, and refuses a bad body or an unknown chat (issue 388)", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const archived = await call(`/api/sessions/${session.id}/archive`, { method: "POST", body: { archived: true } });
    expect(archived.status).toBe(200);
    expect((await json<{ archived: boolean }>(archived)).archived).toBe(true);
    const back = await call(`/api/sessions/${session.id}/archive`, { method: "POST", body: { archived: false } });
    expect((await json<{ archived: boolean }>(back)).archived).toBe(false);
    const bad = await call(`/api/sessions/${session.id}/archive`, { method: "POST", body: { archived: "yes" } });
    expect(bad.status).toBe(400);
    const missing = await call("/api/sessions/missing/archive", { method: "POST", body: { archived: true } });
    expect(missing.status).toBe(404);
  });

  test("the composer's chips set the engine and model of a chat before its first message only", async () => {
    const session = await json<{ id: string }>(
      await call("/api/sessions", { method: "POST", body: { mode: "assistant" } }),
    );
    const model = await call(`/api/sessions/${session.id}/model`, { method: "POST", body: { model: "haiku" } });
    expect(model.status).toBe(200);
    expect((await json<{ modelAlias: string }>(model)).modelAlias).toBe("haiku");
    const engine = await call(`/api/sessions/${session.id}/engine`, {
      method: "POST",
      body: { engine: "claude-code" },
    });
    expect(engine.status).toBe(200);
    expect((await json<{ engine: string }>(engine)).engine).toBe("claude-code");
    // The demo has no pi program.
    const missingEngine = await call(`/api/sessions/${session.id}/engine`, { method: "POST", body: { engine: "pi" } });
    expect(missingEngine.status).toBe(409);
    const badModel = await call(`/api/sessions/${session.id}/model`, { method: "POST", body: { model: "big" } });
    expect(badModel.status).toBe(400);

    await eva.sessions.send(session.id, "one");
    const late = await call(`/api/sessions/${session.id}/model`, { method: "POST", body: { model: "opus" } });
    expect(late.status).toBe(409);
    expect(eva.sessions.get(session.id).modelAlias).toBe("haiku");

    // The effort changes between turns too (#419).
    const effort = await call(`/api/sessions/${session.id}/effort`, { method: "POST", body: { effort: "high" } });
    expect(effort.status).toBe(200);
    expect((await json<{ effort: string }>(effort)).effort).toBe("high");
    const badEffort = await call(`/api/sessions/${session.id}/effort`, { method: "POST", body: { effort: "huge" } });
    expect(badEffort.status).toBe(400);
    // A new chat takes its effort in the same call, so a failed second call leaves no empty chat.
    const made = await call("/api/sessions", { method: "POST", body: { mode: "assistant", effort: "low" } });
    expect((await json<{ effort: string }>(made)).effort).toBe("low");
  });

  test("searches projects", async () => {
    const projects = await json<{ id: string }[]>(await call("/api/projects?text=example&status=active"));
    expect(projects.map((project) => project.id)).toEqual(["2025-03-02-1015-example-app"]);
  });

  test("reads the filter words in the search text, and a status parameter wins", async () => {
    const closed = await json<unknown[]>(
      await call(`/api/projects?text=${encodeURIComponent("example status:closed")}`),
    );
    expect(closed).toEqual([]);
    const active = await json<{ id: string }[]>(
      await call(`/api/projects?text=${encodeURIComponent("example status:closed")}&status=active`),
    );
    expect(active.map((project) => project.id)).toEqual(["2025-03-02-1015-example-app"]);
    const tagged = await json<unknown[]>(await call(`/api/projects?text=${encodeURIComponent("#web")}&tag=missing`));
    expect(tagged).toEqual([]);
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

describe("web routes", () => {
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

  test("a new chat can name its engine", async () => {
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

  test("a project's repository setup; an unknown project is a 404", async () => {
    expect(await json<unknown[]>(await call("/api/projects/2025-03-02-1015-example-app/setup"))).toEqual([]);
    expect((await call("/api/projects/missing/setup")).status).toBe(404);
  });

  test("a project's clones, and a new clone", async () => {
    expect(await json<unknown[]>(await call("/api/projects/2025-03-02-1015-example-app/clones"))).toEqual([]);
    const missing = await call("/api/projects/2025-03-02-1015-example-app/clones", { method: "POST", body: {} });
    expect(missing.status).toBe(404);
    const clonePath = join(eva.status().vaultPath ?? "", "Projects", "2025-03-02-1015-example-app", "repos", "clone-0");
    mkdirSync(clonePath, { recursive: true });
    const deleted = await call("/api/projects/2025-03-02-1015-example-app/clones/clone-0", { method: "DELETE" });
    expect(await json(deleted)).toEqual({ deletedChats: [] });
    expect(existsSync(clonePath)).toBe(false);
    const gone = await call("/api/projects/2025-03-02-1015-example-app/clones/clone-0", { method: "DELETE" });
    expect(gone.status).toBe(404);
  });

  test("a clone fetches, pulls and pushes, and a model writes the message of an empty note", async () => {
    const path = "/api/projects/2025-03-02-1015-example-app";
    const vault = join(sandbox.root, "vault");
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const { name, path: clonePath } = await json<{ name: string; path: string }>(
      await call(`${path}/clones`, { method: "POST", body: {} }),
    );
    const other = sandbox.clone("other");
    sandbox.write(other, "remote.txt", "remote\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "remote work");
    sandbox.git(other, "push", "-q", "origin", "main");

    const fetched = await json<{ clones: { repositories: { behind: number }[] }[]; problems: string[] }>(
      await call(`${path}/clones/fetch`, { method: "POST", body: {} }),
    );
    expect(fetched).toMatchObject({ clones: [{ repositories: [{ behind: 1 }] }], problems: [] });
    const pulled = await json<{ clones: { repositories: { behind: number }[] }[]; problems: string[] }>(
      await call(`${path}/clones/pull`, { method: "POST", body: {} }),
    );
    expect(pulled).toMatchObject({ clones: [{ repositories: [{ behind: 0 }] }], problems: [] });

    sandbox.write(join(clonePath, "remote"), "README.md", "# Example\n");
    turnScript = (request) => FakeEngine.answer(request, "```\nAdd the readme\n```");
    const pushed = await call(`${path}/clones/${name}/repos/remote/push`, { method: "POST", body: { note: "  " } });
    expect(await json<{ message: string }>(pushed)).toEqual({ message: "Add the readme" });
    expect(engine.requests.at(-1)?.prompt).toContain("README.md");
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("Add the readme");

    const nothing = await call(`${path}/clones/${name}/repos/remote/push`, { method: "POST", body: { note: "x" } });
    expect(nothing.status).toBe(409);
    expect((await call(`${path}/clones/${name}/repos/remote/pull`, { method: "POST", body: {} })).status).toBe(200);
    expect((await call(`${path}/clones/clone-9/repos/remote/pull`, { method: "POST", body: {} })).status).toBe(404);
    expect((await call(`${path}/clones/${name}/repos/missing/pull`, { method: "POST", body: {} })).status).toBe(404);
  });

  test("a second pull or push of a clone is refused while the first runs", async () => {
    const path = "/api/projects/2025-03-02-1015-example-app";
    sandbox.write(
      join(sandbox.root, "vault"),
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const { name, path: clonePath } = await json<{ name: string; path: string }>(
      await call(`${path}/clones`, { method: "POST", body: {} }),
    );
    sandbox.write(join(clonePath, "remote"), "README.md", "# Example\n");
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    turnScript = async function* (request) {
      await held;
      yield* FakeEngine.answer(request, "Add the readme");
    };
    const first = call(`${path}/clones/${name}/repos/remote/push`, { method: "POST", body: {} });
    while (engine.requests.length === 0) await Bun.sleep(10);
    const second = await call(`${path}/clones/${name}/repos/remote/pull`, { method: "POST", body: {} });
    expect(second.status).toBe(409);
    release();
    expect(await json<{ message: string }>(await first)).toEqual({ message: "Add the readme" });
  });

  test("a push of a clone with a conflict is refused before a model writes its message", async () => {
    const path = "/api/projects/2025-03-02-1015-example-app";
    sandbox.write(
      join(sandbox.root, "vault"),
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const { name, path: clonePath } = await json<{ name: string; path: string }>(
      await call(`${path}/clones`, { method: "POST", body: {} }),
    );
    const other = sandbox.clone("other");
    sandbox.write(other, "AGENTS.md", "# Remote\n");
    sandbox.git(other, "commit", "-q", "-am", "remote work");
    sandbox.git(other, "push", "-q", "origin", "main");
    const repository = join(clonePath, "remote");
    sandbox.write(repository, "AGENTS.md", "# Local\n");
    sandbox.git(repository, "commit", "-q", "-am", "local work");
    sandbox.git(repository, "fetch", "-q");
    expect(() => sandbox.git(repository, "merge", "-q", "origin/main")).toThrow();
    const asked = engine.requests.length;

    const pushed = await call(`${path}/clones/${name}/repos/remote/push`, { method: "POST", body: {} });
    expect(pushed.status).toBe(409);
    expect(engine.requests.length).toBe(asked);
  });

  test("a project's AGENTS.md: read it, save its details, save it whole", async () => {
    const path = "/api/projects/2025-03-02-1015-example-app";
    const read = await json<{ text: string; version: string }>(await call(`${path}/file`));
    expect(read.text).toBe("---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n");

    const details = await call(`${path}/details`, {
      method: "PUT",
      body: { version: read.version, title: "Better app", status: null, tags: ["work"], repos: [] },
    });
    expect(details.status).toBe(200);
    const saved = await json<{ text: string; version: string }>(details);
    expect(saved.text).toBe("---\ncreated: 2025-03-02T10:15\ntags:\n  - work\n---\n# Better app\n");

    const whole = await call(`${path}/file`, {
      method: "PUT",
      body: { version: saved.version, text: "---\nstatus: idea\n---\n# Whole\n" },
    });
    expect(await json<{ text: string }>(whole)).toMatchObject({ text: "---\nstatus: idea\n---\n# Whole\n" });
  });

  test("the form creates a project, and the list shows it", async () => {
    const form = { name: "New app", description: "Made from the form.", status: "idea", tags: ["web"] };
    const created = await call("/api/projects", { method: "POST", body: { ...form, github: false, drive: false } });
    expect(created.status).toBe(201);
    const result = await json<{ projectId: string; github: unknown; drive: unknown }>(created);
    expect(result).toMatchObject({ github: null, drive: null });
    expect(result.projectId).toEndWith("-new-app");

    const listed = await json<{ id: string; description: string }[]>(await call("/api/projects?text=new&status=idea"));
    expect(listed).toMatchObject([{ id: result.projectId, description: "Made from the form." }]);

    const again = await call("/api/projects", { method: "POST", body: { ...form, github: false, drive: false } });
    expect(again.status).toBe(400);
    expect((await call("/api/projects", { method: "POST", body: { ...form, status: "dreaming" } })).status).toBe(400);
  });

  test("a project save: a stale version is a 409, a bad file or value a 400, an unknown project a 404", async () => {
    const path = "/api/projects/2025-03-02-1015-example-app";
    const stale = await call(`${path}/file`, { method: "PUT", body: { version: "old", text: "---\n---\n" } });
    expect(stale.status).toBe(409);
    expect(await json<{ code: string }>(stale)).toMatchObject({ code: "project_changed" });
    const { version } = await json<{ version: string }>(await call(`${path}/file`));
    const bad = await call(`${path}/file`, { method: "PUT", body: { version, text: "no front matter\n" } });
    expect(bad.status).toBe(400);
    const refused = await json<{ error: string; code: string }>(bad);
    expect(refused.code).toBe("project_invalid");
    expect(refused.error).toContain("front matter");
    const body = { version, title: "x", status: "active", tags: ["two words"], repos: [] };
    expect((await call(`${path}/details`, { method: "PUT", body })).status).toBe(400);
    expect((await call(`${path}/details`, { method: "PUT", body: { ...body, status: "dreaming" } })).status).toBe(400);
    const missing = await call("/api/projects/missing/file");
    expect(missing.status).toBe(404);
    expect(await json<{ code: string }>(missing)).toMatchObject({ code: "project_not_found" });
    expect((await call("/api/projects/%E0/file")).status).toBe(400);
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
    const setup = await json<{ engines: string[]; telegram: { paired: boolean } }>(await call("/api/settings/setup"));
    expect(setup).toMatchObject({ engines: ["claude-code"], telegram: { paired: false } });
  });

  test("trust: the overview, and the removal of a saved answer", async () => {
    expect(await json<unknown>(await call("/api/trust"))).toMatchObject({
      githubAccount: null,
      owners: [],
      answers: [],
    });
    const removed = await call("/api/trust/answers", { method: "DELETE", body: { url: "https://github.com/x/y" } });
    expect(await json<{ answers: unknown[] }>(removed)).toMatchObject({ answers: [] });
    expect((await call("/api/trust/answers", { method: "DELETE", body: {} })).status).toBe(400);
  });

  test("permissions: the fake engine describes no rules", async () => {
    expect(await json<unknown>(await call("/api/permissions"))).toEqual([]);
  });

  test("the Google login waits for a client, then gives Google's consent address", async () => {
    const early = await call("/api/google/login", { method: "POST", body: {} });
    expect(early.status).toBe(409);
    expect(await json<{ code: string }>(early)).toMatchObject({ code: "google_failed" });
    for (const [name, value] of [
      ["googleOauthClientId", "123456789012-clientid.apps.googleusercontent.com"],
      ["googleOauthClientSecret", "GOCSPX-client-secret-value"],
    ] as const)
      expect((await call(`/api/secrets/${name}`, { method: "PUT", body: { value } })).status).toBe(200);
    const started = await json<{ url: string }>(await call("/api/google/login", { method: "POST", body: {} }));
    expect(started.url).toStartWith("https://accounts.google.com/o/oauth2/v2/auth?");
    const finish = (body: unknown): Promise<Response> => call("/api/google/login/finish", { method: "POST", body });
    const wrong = await finish({ address: "http://127.0.0.1/eva-google-login?state=other&code=x" });
    expect(wrong.status).toBe(409);
    expect((await json<{ error: string }>(wrong)).error).toContain("older login");
    expect((await finish({})).status).toBe(400);
  });

  test("the Google log out answers, also with no login to end", async () => {
    const logOut = await call("/api/google/login", { method: "DELETE" });
    expect(logOut.status).toBe(200);
    expect(await json<{ restartNeeded: boolean }>(logOut)).toEqual({ restartNeeded: false });
  });

  test("the Claude login says what is missing, and checks the pasted code", async () => {
    const started = await call("/api/engines/claude-code/login", { method: "POST", body: {} });
    expect(started.status).toBe(409);
    expect(await json<{ code: string; error: string }>(started)).toMatchObject({ code: "claude_login_failed" });
    const finish = (body: unknown): Promise<Response> =>
      call("/api/engines/claude-code/login/finish", { method: "POST", body });
    expect((await finish({})).status).toBe(400);
    const early = await finish({ code: "example-code" });
    expect(early.status).toBe(409);
    expect((await json<{ error: string }>(early)).error).toContain("No Claude login waits");
  });

  test("the GitHub login gives the code, then saves the token", async () => {
    const finish = (): Promise<Response> => call("/api/github/login/finish", { method: "POST", body: {} });
    const early = await finish();
    expect(early.status).toBe(409);
    expect(await json<{ code: string; error: string }>(early)).toMatchObject({ code: "github_failed" });
    const started = await call("/api/github/login", { method: "POST", body: {} });
    expect(await json<{ code: string; url: string }>(started)).toEqual({
      code: "ABCD-1234",
      url: "https://github.com/login/device",
    });
    expect(await json<{ restartNeeded: boolean }>(await finish())).toEqual({ restartNeeded: true });
    expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_example-page-login");
  });

  test("a device login changes the Google client and reaches the Google login", async () => {
    eva.deviceLogins.attachApprover({ name: "Telegram", canApprove: () => true, ask: () => undefined });
    const request = eva.deviceLogins.request("owner@example.com", "a phone");
    eva.deviceLogins.answer(request.id, "allow");
    const answer = eva.deviceLogins.check(request.id, "owner@example.com");
    const device = { cookie: `eva_device=${answer.state === "allowed" ? answer.token : ""}` };
    const deviceHeaders = { ...device, "content-type": "application/json" };
    const put = await call("/api/secrets/googleOauthClientId", {
      method: "PUT",
      body: { value: "123456789012-otherclient.apps.googleusercontent.com" },
      headers: deviceHeaders,
    });
    expect(put.status).toBe(200);
    // Past the login check: the finish route answers about the request itself.
    const finish = await call("/api/google/login/finish", { method: "POST", body: {}, headers: deviceHeaders });
    expect(finish.status).not.toBe(403);
  });

  test("secrets: write-only, only the ones that the page may change", async () => {
    const saved = await call("/api/secrets/githubToken", { method: "PUT", body: { value: "ghp_example-token-value" } });
    expect(await saved.text()).not.toContain("example-token-value");
    expect(saved.status).toBe(200);
    const settings = await json<{ secretsSet: Record<string, boolean> }>(await call("/api/settings"));
    expect(settings.secretsSet["githubToken"]).toBe(true);
    expect((await call("/api/secrets/githubToken", { method: "DELETE" })).status).toBe(200);
    expect(eva.publicSettings().secretsSet.githubToken).toBe(false);
    expect((await call("/api/secrets/localApiToken", { method: "PUT", body: { value: "x" } })).status).toBe(404);
    expect((await call("/api/secrets/githubToken", { method: "PUT", body: {} })).status).toBe(400);
    expect((await call("/api/secrets/githubToken", { method: "PUT", body: { value: " " } })).status).toBe(400);
  });

  test("an engine check may take longer than Bun's idle timeout", async () => {
    // A cold start of a real engine can outlast any idle timeout. A short one keeps the test fast.
    // Bun closes an idle request at its next 4 s tick, so 8 s leaves a margin on a slow runner.
    api.stop();
    api = startLocalApi({ eva, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [], idleTimeoutSeconds: 1 });
    turnScript = async function* (request) {
      await Bun.sleep(8_000);
      yield* FakeEngine.answer(request, "OK");
    };
    // With no body, Bun counts the wait as idle: the case that closed the socket.
    const result = await json<{ ok: boolean }>(await call("/api/checks/claude-code", { method: "POST" }));
    expect(result.ok).toBe(true);
  }, 30_000);

  test("a check runs by name, and an unknown check is a 404", async () => {
    const result = await json<{ ok: boolean }>(await call("/api/checks/vault", { method: "POST", body: {} }));
    expect(result.ok).toBe(true);
    expect((await call("/api/checks/everything", { method: "POST", body: {} })).status).toBe(404);
    const engineCheck = await json<{ ok: boolean }>(
      await call("/api/checks/claude-code", { method: "POST", body: {} }),
    );
    expect(engineCheck.ok).toBe(true);
  });

  test("schedules: add, list, refuse an invalid one, and remove", async () => {
    const entry = { id: "morning", name: "Morning", at: "07:30", text: "Drink water." };
    expect((await call("/api/schedules", { method: "POST", body: entry })).status).toBe(201);
    const listed = await json<{
      schedules: { schedule: { id: string }; nextRun: string; lastRun: unknown }[];
      timeZone: string;
    }>(await call("/api/schedules"));
    expect(listed.schedules.map((view) => [view.schedule.id, view.nextRun, view.lastRun])).toEqual([
      ["morning", "2026-10-15T07:30", null],
    ]);
    expect(listed.timeZone).toBe("UTC");
    const invalid = await call("/api/schedules", { method: "POST", body: { id: "x" } });
    expect(invalid.status).toBe(400);
    expect((await call("/api/schedules/morning", { method: "DELETE" })).status).toBe(204);
    expect((await call("/api/schedules/morning", { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/schedules/morning", { method: "PUT", body: {} })).status).toBe(404);
  });

  test("schedules: turn one off and on, and refuse a bad body or an unknown id (#188)", async () => {
    const entry = { id: "morning", name: "Morning", at: "07:30", text: "Drink water." };
    await call("/api/schedules", { method: "POST", body: entry });
    const off = await call("/api/schedules/morning", { method: "PATCH", body: { enabled: false } });
    expect(off.status).toBe(204);
    const listed = await json<{ schedules: { schedule: { enabled: boolean }; nextRun: string | null }[] }>(
      await call("/api/schedules"),
    );
    expect(listed.schedules.map((view) => [view.schedule.enabled, view.nextRun])).toEqual([[false, null]]);
    expect((await call("/api/schedules/morning", { method: "PATCH", body: { enabled: true } })).status).toBe(204);
    expect((await call("/api/schedules/morning", { method: "PATCH", body: { enabled: "no" } })).status).toBe(400);
    expect((await call("/api/schedules/nobody", { method: "PATCH", body: { enabled: true } })).status).toBe(404);
  });

  test("schedules: edit the form's fields of one, keep its other keys, and refuse a bad edit (#467)", async () => {
    const entry = { id: "morning", name: "Morning", at: "07:30", text: "Drink water.", model: "sonnet" };
    await call("/api/schedules", { method: "POST", body: entry });
    const fields = { name: "Early", at: "06:00", text: "Drink water." };
    const edited = await call("/api/schedules/morning", { method: "PATCH", body: { fields } });
    expect(edited.status).toBe(200);
    expect(await json(edited)).toMatchObject({ id: "morning", name: "Early", at: "06:00", model: "sonnet" });
    const bad = await call("/api/schedules/morning", { method: "PATCH", body: { fields: { name: "Early" } } });
    expect(bad.status).toBe(400);
    const nobody = await call("/api/schedules/nobody", { method: "PATCH", body: { fields } });
    expect(nobody.status).toBe(404);
    // One change per call, so a body with both never drops the edit and answers 204.
    const both = await call("/api/schedules/morning", { method: "PATCH", body: { enabled: false, fields } });
    expect(both.status).toBe(400);
  });

  test("chat names: the rules read back as saved, and a long or bad body is refused (issue 50)", async () => {
    expect(await json(await call("/api/chat-names"))).toEqual({ rules: "" });
    const saved = await call("/api/chat-names", { method: "PUT", body: { rules: "Lead with an emoji." } });
    expect(await json(saved)).toEqual({ rules: "Lead with an emoji." });
    expect(await json(await call("/api/chat-names"))).toEqual({ rules: "Lead with an emoji." });
    expect((await call("/api/chat-names", { method: "PUT", body: { rules: "x".repeat(5_000) } })).status).toBe(400);
    expect((await call("/api/chat-names", { method: "PUT", body: {} })).status).toBe(400);
    expect((await call("/api/chat-names", { method: "DELETE" })).status).toBe(404);
  });

  test("push: a device subscribes, gets each alert as a push, reads the newest alert, and leaves", async () => {
    const key = await json<{ publicKey: string; isHub: boolean; devices: unknown[] }>(await call("/api/push"));
    expect(key.isHub).toBe(true);
    expect(Buffer.from(key.publicKey, "base64url")).toHaveLength(65);
    expect(key.devices).toEqual([]);
    const endpoint = "https://fcm.googleapis.com/fcm/send/device-1";
    const added = await json<{ devices: { endpoint: string; label: string }[] }>(
      await call("/api/push/devices", {
        method: "POST",
        body: { subscription: { endpoint, keys: { p256dh: "key", auth: "secret" } }, label: "Phone" },
      }),
    );
    expect(added.devices.map((device) => [device.endpoint, device.label])).toEqual([[endpoint, "Phone"]]);

    expect((await call("/api/push/test", { method: "POST" })).status).toBe(204);
    expect(pushed).toEqual([endpoint]);
    // A real alert goes to the device too, with a number that the device uses to show it once.
    eva.reportProblem("example_problem", { level: "warn", message: "Something broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toEqual([endpoint, endpoint]);
    const recent = await json<{ alerts: { key: string; seq: number }[] }>(await call("/api/notifications/recent"));
    expect(recent.alerts.map((alert) => [alert.key, alert.seq])).toEqual([
      ["example_problem", 2],
      ["push_test", 1],
    ]);

    const bad = await call("/api/push/devices", {
      method: "POST",
      body: { subscription: { endpoint: "https://example.com/x", keys: { p256dh: "k", auth: "a" } }, label: "X" },
    });
    expect(bad.status).toBe(400);
    const removed = await json<{ devices: unknown[] }>(
      await call("/api/push/devices", { method: "DELETE", body: { endpoint } }),
    );
    expect(removed.devices).toEqual([]);
    expect((await call("/api/push/other")).status).toBe(404);
  });

  test("push: a device picks its kinds, says that its page is in view, and reads only its own alerts", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/device-2";
    const subscription = { endpoint, keys: { p256dh: "key", auth: "secret" } };
    await call("/api/push/devices", { method: "POST", body: { subscription, label: "Phone" } });
    const picked = await json<{ devices: { kinds: string[] }[] }>(
      await call("/api/push/devices", { method: "PATCH", body: { endpoint, kinds: ["replies", "alerts"] } }),
    );
    expect(picked.devices.map((device) => device.kinds)).toEqual([["replies", "alerts"]]);
    const unknown = await call("/api/push/devices", {
      method: "PATCH",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/none", kinds: [] },
    });
    expect(unknown.status).toBe(404);
    expect((await call("/api/push/devices", { method: "PATCH", body: { endpoint, kinds: ["nope"] } })).status).toBe(
      400,
    );

    const other = "https://fcm.googleapis.com/fcm/send/device-3";
    await call("/api/push/devices", {
      method: "POST",
      body: { subscription: { ...subscription, endpoint: other }, label: "PC" },
    });

    const claim = (inView: boolean): Promise<Response> =>
      call("/api/push/in-view", { method: "POST", body: { endpoint, pageId: "tab-1", inView } });
    expect((await claim(true)).status).toBe(204);
    eva.reportProblem("while_in_view", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await claim(false);
    eva.reportProblem("out_of_view", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toEqual([other, endpoint, other]);
    const own = await json<{ alerts: { key: string }[] }>(
      await call("/api/notifications/recent", { method: "POST", body: { endpoint } }),
    );
    expect(own.alerts.map((alert) => alert.key)).toEqual(["out_of_view"]);
    const others = await json<{ alerts: { key: string }[] }>(
      await call("/api/notifications/recent", { method: "POST", body: { endpoint: other } }),
    );
    expect(others.alerts.map((alert) => alert.key)).toEqual(["out_of_view", "while_in_view"]);

    const unknownClaim = await call("/api/push/in-view", {
      method: "POST",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/none", pageId: "tab-1", inView: true },
    });
    expect(unknownClaim.status).toBe(404);
    expect((await call("/api/notifications/recent", { method: "POST", body: {} })).status).toBe(400);
  });

  test("push: a device login's subscription ends with that device login, and a token login's stays", async () => {
    eva.deviceLogins.attachApprover({ name: "Telegram", canApprove: () => true, ask: () => undefined });
    const request = eva.deviceLogins.request("owner@example.com", "a phone");
    eva.deviceLogins.answer(request.id, "allow");
    const answer = eva.deviceLogins.check(request.id, "owner@example.com");
    const deviceToken = answer.state === "allowed" ? answer.token : "";
    const keys = { p256dh: "key", auth: "secret" };
    const phone = "https://fcm.googleapis.com/fcm/send/phone";
    const computer = "https://fcm.googleapis.com/fcm/send/computer";
    await call("/api/push/devices", {
      method: "POST",
      body: { subscription: { endpoint: phone, keys }, label: "Phone" },
      headers: { cookie: `eva_device=${deviceToken}`, "content-type": "application/json" },
    });
    // The token wins over a cookie that the same browser also carries.
    await call("/api/push/devices", {
      method: "POST",
      body: { subscription: { endpoint: computer, keys }, label: "Computer" },
      headers: headers({ cookie: `eva_device=${deviceToken}` }),
    });
    const [phoneDevice] = await json<{ id: string }[]>(await call("/api/devices"));
    expect((await call(`/api/devices/${phoneDevice?.id ?? ""}`, { method: "DELETE" })).status).toBeLessThan(300);
    const left = await json<{ devices: { endpoint: string }[] }>(await call("/api/push"));
    expect(left.devices.map((device) => device.endpoint)).toEqual([computer]);
  });

  test("the service worker loads before the login, from the root", async () => {
    const response = await fetch(`${api.url}/sw.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toContain('addEventListener("push"');
  });

  test("assistant rules: read with the built-in prompt, save by version, and restore the default after a backup", async () => {
    interface Rules {
      text: string;
      version: string;
      builtIn: string;
      defaultText: string;
    }
    const read = await json<Rules>(await call("/api/assistant-rules"));
    expect(read).toMatchObject({ text: "# You are Eva\n", builtIn: "Base." });
    expect(read.defaultText).toContain("## Learning");

    const saved = await json<Rules>(
      await call("/api/assistant-rules", { method: "PUT", body: { version: read.version, text: "# Mine\n" } }),
    );
    expect(saved.text).toBe("# Mine\n");
    const stale = await call("/api/assistant-rules", {
      method: "PUT",
      body: { version: read.version, text: "# Old\n" },
    });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: "rules_changed" });

    const restored = await json<{ text: string; backup: string | null }>(
      await call("/api/assistant-rules/restore", { method: "POST", body: { version: saved.version, backup: true } }),
    );
    expect(restored.text).toBe(read.defaultText);
    expect(restored.backup).toMatch(/^\.eva\/assistant\.backup-.+\.md$/);
    expect(readFileSync(join(eva.status().vaultPath ?? "", restored.backup ?? ""), "utf-8")).toBe("# Mine\n");

    expect((await call("/api/assistant-rules", { method: "PUT", body: { text: "# No version\n" } })).status).toBe(400);
    expect((await call("/api/assistant-rules/other", { method: "POST", body: {} })).status).toBe(404);
  });

  test("location: the web app sends a point, and the place falls back to the home of About me", async () => {
    interface Place {
      place: { lat: number; lon: number; source: string; at: string | null } | null;
    }
    expect((await json<Place>(await call("/api/location"))).place).toBeNull();
    const vaultPath = eva.status().vaultPath ?? "";
    mkdirSync(join(vaultPath, "Life"), { recursive: true });
    writeFileSync(
      join(vaultPath, "Life", "About me.md"),
      "---\nplaces:\n  home: { city: Barcelona, lat: 41.39, lon: 2.17 }\n---\n",
    );
    expect((await json<Place>(await call("/api/location"))).place).toEqual({
      lat: 41.39,
      lon: 2.17,
      source: "home",
      at: null,
    });
    expect((await json<{ isHub: boolean }>(await call("/api/location"))).isHub).toBe(true);
    const sent = await call("/api/location", {
      method: "POST",
      body: { lat: 40.4, lon: -3.7, accuracy: 30, takenAt: Date.parse("2026-10-14T10:29:00Z") },
    });
    expect(await json(sent)).toEqual({ saved: true });
    expect((await json<Place>(await call("/api/location"))).place).toMatchObject({ lat: 40.4, source: "web" });
    expect((await call("/api/location", { method: "POST", body: { lat: 100, lon: 0, takenAt: 1 } })).status).toBe(400);
  });

  test("about me: the person's facts, and the facts that Eva still needs", async () => {
    const vaultPath = eva.status().vaultPath ?? "";
    mkdirSync(join(vaultPath, "Life"), { recursive: true });
    writeFileSync(
      join(vaultPath, "Life", "About me.md"),
      "---\nname: Alex\nbirthDate: 1990-05-14\n---\n\n# About Alex\n",
    );
    const facts = await json<{ installedOn: string | null }>(await call("/api/about-me"));
    expect(facts).toMatchObject({
      name: "Alex",
      birthDate: "1990-05-14",
      region: null,
      hemisphere: null,
      missing: ["region"],
    });
    // The day of the test vault's first commit.
    expect(facts.installedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("template parts: list their states, and keep the person's version of one", async () => {
    interface Parts {
      parts: { path: string; name: string; state: string; updatedAt: string | null; newText: string | null }[];
    }
    const vaultPath = eva.status().vaultPath ?? "";
    mkdirSync(join(vaultPath, ".eva", "skills", "schedule"), { recursive: true });
    writeFileSync(join(vaultPath, ".eva", "skills", "schedule", "SKILL.md"), "# My own skill\n");
    const listed = await json<Parts>(await call("/api/template-parts"));
    const schedule = listed.parts.find((part) => part.name === "schedule");
    expect([schedule?.path, schedule?.state, schedule?.updatedAt]).toEqual([
      ".eva/skills/schedule/SKILL.md",
      "differs",
      null,
    ]);
    expect(schedule?.newText).toContain("# Schedule a message");
    const kept = await json<Parts>(
      await call("/api/template-parts", {
        method: "POST",
        body: { path: ".eva/skills/schedule/SKILL.md", choice: "mine" },
      }),
    );
    expect(kept.parts.find((part) => part.name === "schedule")?.state).toBe("kept");
    const unknown = await call("/api/template-parts", {
      method: "POST",
      body: { path: ".eva/assistant.md", choice: "new" },
    });
    expect(unknown.status).toBe(404);
    expect((await call("/api/template-parts", { method: "POST", body: { path: "x", choice: "both" } })).status).toBe(
      400,
    );
    expect((await call("/api/template-parts", { method: "DELETE" })).status).toBe(404);
  });

  test("files: the vault root lists, a text file shows, and a path out of the vault is not found (issue 253)", async () => {
    const root = await json<{ kind: string; entries: { name: string }[] }>(await call("/api/files"));
    expect(root.kind).toBe("folder");
    expect(root.entries.map((entry) => entry.name)).toEqual([".eva", "Projects", "AGENTS.md"]);
    const file = await call(`/api/files?path=${encodeURIComponent(".eva/assistant.md")}`);
    expect(await json(file)).toMatchObject({
      kind: "file",
      path: ".eva/assistant.md",
      size: 14,
      text: "# You are Eva\n",
      editable: true,
    });
    const outside = await call(`/api/files?path=${encodeURIComponent("../")}`);
    expect(outside.status).toBe(404);
    expect(await json<{ code: string }>(outside)).toMatchObject({ code: "file_not_found" });
    expect((await call("/api/files", { method: "POST", body: {} })).status).toBe(404);
  });

  test("files: the search finds a name, and the text only when the page asks for it", async () => {
    interface Found {
      matches: { path: string; name: string; kind: string; line?: { number: number } }[];
      complete: boolean;
    }
    const byName = await json<Found>(await call(`/api/files/search?query=${encodeURIComponent("assistant")}`));
    expect(byName).toEqual({
      matches: [{ path: ".eva/assistant.md", name: "assistant.md", kind: "file" }],
      complete: true,
    });
    const byText = await json<Found>(await call("/api/files/search?query=You%20are%20Eva"));
    expect(byText.matches).toEqual([]);
    const inside = await json<Found>(await call("/api/files/search?query=You%20are%20Eva&contents=true"));
    expect(inside.matches.map((match) => [match.path, match.line?.number])).toEqual([[".eva/assistant.md", 1]]);
  });

  test("files: a file downloads as itself, a folder as a zip, and a secrets file does not", async () => {
    const file = await call(`/api/files/download?path=${encodeURIComponent(".eva/assistant.md")}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    expect(file.headers.get("content-disposition")).toBe(
      "attachment; filename=\"assistant.md\"; filename*=UTF-8''assistant.md",
    );
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await file.text()).toBe("# You are Eva\n");

    const folder = await call(`/api/files/download?path=${encodeURIComponent(".eva")}`);
    expect(folder.headers.get("content-type")).toBe("application/zip");
    expect(folder.headers.get("content-disposition")).toContain("filename*=UTF-8''.eva.zip");
    expect(new Uint8Array(await folder.arrayBuffer()).subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));

    writeFileSync(join(eva.status().vaultPath ?? "", ".env"), "TOKEN=1\n");
    const secrets = await call(`/api/files/download?path=${encodeURIComponent(".env")}`);
    expect(secrets.status).toBe(409);
    expect(await json(secrets)).toMatchObject({ code: "file_not_downloadable" });
    const outside = await call(`/api/files/download?path=${encodeURIComponent("../")}`);
    expect(outside.status).toBe(404);
  });

  test("files: a download name keeps its accents, an apostrophe and its brackets", async () => {
    writeFileSync(join(eva.status().vaultPath ?? "", "Café 'plan' (1).md"), "# Plan\n");
    const file = await call(`/api/files/download?path=${encodeURIComponent("Café 'plan' (1).md")}`);
    expect(file.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Caf_ 'plan' (1).md\"; filename*=UTF-8''Caf%C3%A9%20%27plan%27%20%281%29.md",
    );
  });

  // Windows allows no quote in a file name.
  test.skipIf(process.platform === "win32")("files: a quote in a download name cannot break the header", async () => {
    writeFileSync(join(eva.status().vaultPath ?? "", 'Café "plan".md'), "# Plan\n");
    const file = await call(`/api/files/download?path=${encodeURIComponent('Café "plan".md')}`);
    expect(file.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Caf_ _plan_.md\"; filename*=UTF-8''Caf%C3%A9%20%22plan%22.md",
    );
  });

  test("files: a save writes the text, and a save of an old version answers file_changed (issue 308)", async () => {
    const path = ".eva/assistant.md";
    const { version } = await json<{ version: string }>(await call(`/api/files?path=${encodeURIComponent(path)}`));
    const saved = await call("/api/files", { method: "PUT", body: { path, version, text: "# You are Eva too\n" } });
    expect(await json(saved)).toMatchObject({ kind: "file", text: "# You are Eva too\n" });
    expect(readFileSync(join(eva.status().vaultPath ?? "", path), "utf-8")).toBe("# You are Eva too\n");

    const stale = await call("/api/files", { method: "PUT", body: { path, version, text: "# Lost\n" } });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: "file_changed" });
    expect((await call("/api/files", { method: "PUT", body: { path, text: "# No version\n" } })).status).toBe(400);
  });

  test("files: a favorite is added, listed and removed, and a missing path is not found (issue 349)", async () => {
    expect(await json(await call("/api/files/favorites"))).toEqual([]);
    const added = await call("/api/files/favorites", { method: "PUT", body: { path: "Projects", favorite: true } });
    expect(await json(added)).toEqual([{ path: "Projects", name: "Projects", kind: "folder" }]);
    expect(await json(await call("/api/files/favorites"))).toEqual([
      { path: "Projects", name: "Projects", kind: "folder" },
    ]);
    const stored = readFileSync(join(eva.status().vaultPath ?? "", ".eva/favorites.json"), "utf-8");
    expect(JSON.parse(stored)).toEqual({ version: 1, paths: ["Projects"] });

    const removed = await call("/api/files/favorites", { method: "PUT", body: { path: "Projects", favorite: false } });
    expect(await json(removed)).toEqual([]);
    const missing = await call("/api/files/favorites", { method: "PUT", body: { path: "Nothing", favorite: true } });
    expect(missing.status).toBe(404);
    expect((await call("/api/files/favorites", { method: "PUT", body: { path: "Projects" } })).status).toBe(400);
  });

  test("files: a favorite follows its folder when the person renames the folder (issues 343 and 349)", async () => {
    const vaultPath = eva.status().vaultPath ?? "";
    mkdirSync(join(vaultPath, "Notes"));
    writeFileSync(join(vaultPath, "Notes", "list.md"), "# Shopping\n");
    try {
      await call("/api/files/favorites", { method: "PUT", body: { path: "Notes/list.md", favorite: true } });
      await call("/api/files/rename", { method: "POST", body: { path: "Notes", name: "Ideas" } });
      expect(await json(await call("/api/files/favorites"))).toEqual([
        { path: "Ideas/list.md", name: "list.md", kind: "file" },
      ]);
      await call("/api/files/favorites", { method: "PUT", body: { path: "Ideas/list.md", favorite: false } });
    } finally {
      rmSync(join(vaultPath, "Notes"), { recursive: true, force: true });
      rmSync(join(vaultPath, "Ideas"), { recursive: true, force: true });
    }
  });

  test("files: a rename answers the new path, and a taken name answers file_not_writable (issue 343)", async () => {
    const vaultPath = eva.status().vaultPath ?? "";
    const renamed = await call("/api/files/rename", { method: "POST", body: { path: "AGENTS.md", name: "README.md" } });
    expect(await json(renamed)).toEqual({ path: "README.md" });
    expect(existsSync(join(vaultPath, "README.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "AGENTS.md"))).toBe(false);

    const taken = await call("/api/files/rename", { method: "POST", body: { path: "README.md", name: ".eva" } });
    expect(taken.status).toBe(409);
    expect(await json(taken)).toMatchObject({ code: "file_not_writable" });
    const missing = await call("/api/files/rename", { method: "POST", body: { path: "gone.md", name: "here.md" } });
    expect(missing.status).toBe(404);
    expect((await call("/api/files/rename", { method: "POST", body: { path: "README.md" } })).status).toBe(400);
  });

  test("files: a file from the chat lands in Scratch/received/ and answers its note (issue 409)", async () => {
    const vaultPath = eva.status().vaultPath ?? "";
    const response = await fetch(`${api.url}/api/files/received?name=${encodeURIComponent("my photo.jpg")}`, {
      method: "POST",
      headers: headers({ "content-type": "image/jpeg" }),
      body: new Uint8Array([7, 8, 9]),
    });
    expect(response.status).toBe(201);
    const saved = await json<{ path: string; note: string }>(response);
    expect(saved.path).toMatch(/^Scratch\/received\/my-photo-[0-9a-f]{12}\.jpg$/);
    expect(saved.note).toBe(`[The person sent a file, saved as ${saved.path}]`);
    expect([...readFileSync(join(vaultPath, saved.path))]).toEqual([7, 8, 9]);

    const tooLarge = await fetch(`${api.url}/api/files/received?name=big.bin`, {
      method: "POST",
      headers: headers({ "content-type": "application/octet-stream" }),
      body: new Uint8Array(26 * 1024 * 1024),
    });
    expect(tooLarge.status).toBe(413);
    expect(existsSync(join(vaultPath, "Scratch", "received", "big.bin"))).toBe(false);
  });

  test("schedule cards: a waiting card is listed, and counts once the person confirms it (lesson 66)", async () => {
    const entry = { id: "morning", name: "Morning", at: "07:30", text: "Drink water." };
    await call("/api/schedules", { method: "POST", body: entry });
    await eva.schedules?.tick();
    const cards = await json<{ scheduleId: string; fields: Record<string, string> }[]>(
      await call("/api/schedule-cards"),
    );
    expect(cards.map((card) => card.scheduleId)).toEqual(["morning"]);
    const fields = cards[0]?.fields ?? {};
    const stale = await call("/api/schedule-cards/morning", {
      method: "POST",
      body: { fields: { ...fields, at: "06:00" } },
    });
    expect(stale.status).toBe(409);
    expect((await call("/api/schedule-cards/morning", { method: "POST", body: { fields } })).status).toBe(204);
    expect(await json(await call("/api/schedule-cards"))).toEqual([]);
    expect((await call("/api/schedule-cards/morning", { method: "POST", body: {} })).status).toBe(400);
  });

  test("the WebSocket carries setup cards, and a card that only reached a socket still waits", async () => {
    const events: { kind: string }[] = [];
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/api/events`, {
      headers: headers(),
    } as unknown as string[]);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data)) as { kind: string }));
    await call("/api/schedules", {
      method: "POST",
      body: { id: "morning", name: "Morning", at: "07:30", text: "Hi." },
    });
    await eva.schedules?.tick();
    await Bun.sleep(50);
    expect(events).toEqual([]);
    // Only a card that already waits goes out, so the second check pushes it.
    await eva.schedules?.tick();
    while (!events.some((event) => event.kind === "schedule_card")) await Bun.sleep(10);
    socket.close();
    expect(eva.schedules?.waitingCards()).toHaveLength(1);
  });

  test("the WebSocket holds back a changed card until it waits, so a tap never meets an older card", async () => {
    const events: { kind: string; fields?: { at?: string } }[] = [];
    await call("/api/schedules", {
      method: "POST",
      body: { id: "morning", name: "Morning", at: "07:30", text: "Hi." },
    });
    await eva.schedules?.tick();
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/api/events`, {
      headers: headers(),
    } as unknown as string[]);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data)) as { kind: string }));
    await call("/api/schedules", {
      method: "POST",
      body: { id: "morning", name: "Morning", at: "08:00", text: "Hi." },
    });
    await eva.schedules?.tick();
    await eva.schedules?.tick();
    while (events.length === 0) await Bun.sleep(10);
    socket.close();
    expect(events.map((event) => event.fields?.at)).toEqual(["08:00"]);
  });
});

describe("without a vault", () => {
  test("the schedules answer that no vault is configured", async () => {
    const bare = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
    });
    const bareApi = startLocalApi({ eva: bare, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [] });
    try {
      const response = await fetch(`${bareApi.url}/api/schedules`, { headers: headers() });
      expect(response.status).toBe(409);
      const chatNames = await fetch(`${bareApi.url}/api/chat-names`, { headers: headers() });
      expect(chatNames.status).toBe(409);
      const rules = await fetch(`${bareApi.url}/api/assistant-rules`, { headers: headers() });
      expect(rules.status).toBe(409);
      const files = await fetch(`${bareApi.url}/api/files`, { headers: headers() });
      expect(await files.json()).toMatchObject({ code: "vault_not_found" });
      const received = await fetch(`${bareApi.url}/api/files/received?name=a.txt`, {
        method: "POST",
        headers: headers({ "content-type": "text/plain" }),
        body: "text",
      });
      expect(await received.json()).toMatchObject({ code: "vault_not_found" });
    } finally {
      bareApi.stop();
    }
  });
});

describe("loggedPath", () => {
  test("keeps the route, and leaves out the id of a device login, which lets a browser in", () => {
    expect(loggedPath("/api/settings/setup")).toBe("/api/settings/setup");
    expect(loggedPath("/api/login/device/secret-id")).toBe("/api/login/device/…");
    expect(loggedPath("/api/login/device")).toBe("/api/login/device");
    // The page answers the same pending request by its id.
    expect(loggedPath("/api/devices/requests/secret-id")).toBe("/api/devices/requests/…");
    expect(loggedPath("/api/devices/requests")).toBe("/api/devices/requests");
  });
});

describe("an unexpected error", () => {
  test("answers a plain 500, and logs the redacted message and stack for the person to read", async () => {
    const logged: { level: string; message: string; details: Readonly<Record<string, unknown>> | undefined }[] = [];
    const brokenVault = join(home, "broken-vault");
    mkdirSync(brokenVault);
    const broken = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: brokenVault, sync: { ...defaultConfig.sync, enabled: false } },
      secrets: {},
      engines: [engine],
      // A runner that fails as no EvaError does, so the setup progress fails as a bug would.
      runner: { run: () => Promise.reject(new Error("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked")) },
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
    });
    const brokenApi = startLocalApi({
      eva: broken,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
      logger: { log: (level, message, details) => logged.push({ level, message, details }) },
    });
    try {
      const response = await fetch(`${brokenApi.url}/api/settings/setup`, { headers: headers() });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Eva failed to handle the request." });
      expect(logged).toHaveLength(1);
      expect(logged[0]?.level).toBe("error");
      expect(logged[0]?.message).toBe("A request failed: GET /api/settings/setup");
      const reason = String(logged[0]?.details?.["reason"]);
      expect(reason).toContain("leaked");
      // The stack, so the log shows where it failed.
      expect(reason).toMatch(/\n\s+at /);
      expect(reason).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    } finally {
      brokenApi.stop();
      broken.stop();
    }
  });
});

describe("updates and the vault sync", () => {
  test("without an update channel, the status is null and an update is refused", async () => {
    expect(await json<unknown>(await call("/api/update"))).toBeNull();
    expect((await call("/api/update", { method: "POST", body: {} })).status).toBe(409);
    expect((await call("/api/update/check", { method: "POST", body: {} })).status).toBe(409);
  });

  test("without a claude program, the engine update status is null and an update is refused", async () => {
    expect(await json<unknown>(await call("/api/update/engine"))).toBeNull();
    const refused = await call("/api/update/engine", { method: "POST", body: {} });
    expect(refused.status).toBe(409);
    expect(await json<unknown>(refused)).toEqual({ error: "No claude program was found." });
  });

  test("the versions hold Eva's own and one entry for each tool", async () => {
    const versions = await json<{ eva: string; tools: { program: string }[] }>(await call("/api/versions"));
    expect(versions.eva).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions.tools.map((tool) => tool.program)).toContain("claude");
  });

  test("the latest versions name each tool that Eva installs, and null when no source answers", async () => {
    expect(await json<unknown>(await call("/api/versions/latest"))).toEqual([
      { program: "claude", latest: null },
      { program: "pi", latest: null },
      { program: "uv", latest: null },
      { program: "gh", latest: null },
    ]);
  });

  test("the changelog reads GitHub once, and the next page open in the hour reads it again from memory", async () => {
    const before = releaseReads;
    await call("/api/update/changelog");
    expect((await call("/api/update/changelog")).status).toBe(200);
    expect(releaseReads - before).toBe(1);
  });

  test("the changelog lists the published releases with their changes", async () => {
    expect(await json<unknown>(await call("/api/update/changelog"))).toEqual([
      {
        version: "9.1.0",
        publishedAt: null,
        headline: "Voice notes.",
        changes: "New features:\n• feat: voice notes (#7)",
        installed: false,
      },
    ]);
  });

  test("a tool install answers with what happened, and refuses a tool that Eva does not install", async () => {
    const result = await json<{ ok: boolean; message: string }>(
      await call("/api/tools/install", { method: "POST", body: { program: "gh" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Eva could not install gh");
    expect((await call("/api/tools/install", { method: "POST", body: { program: "git" } })).status).toBe(400);
  });

  test("the voice notes install answers with what happened", async () => {
    const result = await json<{ ok: boolean; message: string }>(
      await call("/api/voice-notes/install", { method: "POST", body: {} }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Eva could not install");
    const versions = await json<{ voiceNotes: { missing: string[] } }>(await call("/api/versions"));
    expect(versions.voiceNotes.missing).toContain("speech model");
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

  test("the vault conflicts list, and a pick for a note with no conflict changes nothing", async () => {
    const listed = await json<{ conflicts: unknown[] }>(await call("/api/vault/conflicts"));
    expect(listed.conflicts).toEqual([]);
    const picked = await call("/api/vault/conflicts", { method: "POST", body: { path: "a.md", choice: "mine" } });
    expect(picked.status).toBe(200);
    expect(await json<{ found: boolean }>(picked)).toMatchObject({ found: false });
    const invalid = await call("/api/vault/conflicts", { method: "POST", body: { path: "a.md", choice: "all" } });
    expect(invalid.status).toBe(400);
  });
});

describe("the vault step", () => {
  test("with no GitHub token, the list of repositories says what to do", async () => {
    const response = await call("/api/vault/repositories");
    expect(response.status).toBe(409);
    expect(await json<{ code: string }>(response)).toMatchObject({ code: "github_failed" });
  });

  test("a vault in place refuses a clone and a new vault, and a bad request is refused", async () => {
    const clone = await call("/api/vault/clone", { method: "POST", body: { repository: sandbox.remote } });
    expect(clone.status).toBe(409);
    expect(await json<{ code: string }>(clone)).toMatchObject({ code: "vault_not_found" });
    const create = await call("/api/vault/create", {
      method: "POST",
      body: { name: "Sam", language: "English", topics: ["work"], repository: "vault" },
    });
    expect(await json<{ code: string }>(create)).toMatchObject({ code: "vault_not_found" });
    expect((await call("/api/vault/clone", { method: "POST", body: {} })).status).toBe(400);
    expect((await call("/api/vault/create", { method: "POST", body: { name: "Sam" } })).status).toBe(400);
    // The cloned vault has a remote, so it needs no push.
    expect((await call("/api/vault/push", { method: "POST", body: { repository: "vault" } })).status).toBe(400);
  });
});

describe("an Eva with an update channel", () => {
  test("the API checks, then installs", async () => {
    const restarts: string[] = [];
    let checks = 0;
    const updating = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      updateChannel: {
        kind: "executable",
        check: () => {
          checks += 1;
          return Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null });
        },
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
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
      const checkIfStale = (): Promise<Response> =>
        fetch(`${updatingApi.url}/api/update/check`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ ifStale: true }),
        });
      expect(await json<unknown>(await checkIfStale())).toMatchObject({ available: true, latest: "0.2.0" });
      expect(await json<unknown>(await post("/api/update/check"))).toMatchObject({ available: true, latest: "0.2.0" });
      // The check just ran, so a page that opens now gets its answer without a new one.
      await checkIfStale();
      expect(checks).toBe(2);
      expect(await json<unknown>(await post("/api/update"))).toMatchObject({ phase: "restarting" });
      expect(restarts).toEqual(["restart"]);
    } finally {
      updatingApi.stop();
      updating.stop();
    }
  });

  test("an install may take longer than Bun's idle timeout", async () => {
    // A download of the new executable can run for minutes. A short idle timeout keeps the test fast.
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
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: async () => {
          await Bun.sleep(8_000);
          return { current: "0.1.0", latest: "0.2.0", available: false, releases: null };
        },
      },
      restartForUpdate: () => undefined,
    });
    const updatingApi = startLocalApi({
      eva: updating,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
      idleTimeoutSeconds: 1,
    });
    try {
      const answer = await fetch(`${updatingApi.url}/api/update`, { method: "POST", headers: headers() });
      expect(await json<unknown>(answer)).toMatchObject({ phase: "restarting" });
    } finally {
      updatingApi.stop();
      updating.stop();
    }
  }, 30_000);
});

describe("an Eva with a claude program", () => {
  test("the API updates the engine and gives the result", async () => {
    let version = "2.1.0";
    const updating = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: {
        run: (command) => {
          if (command[1] === "update") version = "2.2.0";
          return Promise.resolve({ exitCode: 0, stdout: `${version} (Claude Code)\n`, stderr: "" });
        },
      },
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
    });
    const updatingApi = startLocalApi({
      eva: updating,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
    });
    try {
      const engineUpdate = `${updatingApi.url}/api/update/engine`;
      expect(await json<unknown>(await fetch(engineUpdate, { headers: headers() }))).toEqual({
        phase: "idle",
        last: null,
      });
      const response = await fetch(engineUpdate, { method: "POST", headers: headers(), body: "{}" });
      expect(await json<unknown>(response)).toMatchObject({ phase: "updating" });
      for (let round = 0; round < 200 && updating.engineUpdateStatus()?.phase !== "idle"; round += 1)
        await Bun.sleep(10);
      expect(await json<unknown>(await fetch(engineUpdate, { headers: headers() }))).toMatchObject({
        phase: "idle",
        last: { outcome: "updated", before: "2.1.0", after: "2.2.0" },
      });
    } finally {
      updatingApi.stop();
      updating.stop();
    }
  });
});

describe("voice notes", () => {
  test("a machine without a whisper model says so, and its status has no voice notes", async () => {
    expect((await json<{ voiceNotes: boolean }>(await call("/api/status"))).voiceNotes).toBe(false);
    const response = await fetch(`${api.url}/api/transcribe`, { method: "POST", headers: headers(), body: "audio" });
    expect(response.status).toBe(409);
    expect((await json<{ code: string }>(response)).code).toBe("voice_unavailable");
  });

  test("the page's recording becomes text on this machine", async () => {
    const decoded: string[] = [];
    const listening = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null, voice: { ...defaultConfig.voice, modelPath: "model.bin" } },
      secrets: {},
      engines: [new FakeEngine()],
      runner: {
        run: (command) => {
          if (command[0] === "ffmpeg") decoded.push(command[command.indexOf("-i") + 1] ?? "");
          const stdout = command[0] === "whisper-cli" ? " [BLANK_AUDIO] Hello Eva \n" : "";
          return Promise.resolve({ exitCode: 0, stdout, stderr: "" });
        },
      },
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
    });
    const listeningApi = startLocalApi({
      eva: listening,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
    });
    try {
      expect(
        (await json<{ voiceNotes: boolean }>(await fetch(`${listeningApi.url}/api/status`, { headers: headers() })))
          .voiceNotes,
      ).toBe(true);
      const response = await fetch(`${listeningApi.url}/api/transcribe`, {
        method: "POST",
        headers: headers({ "content-type": "audio/webm" }),
        body: new Uint8Array([1, 2, 3]),
      });
      expect(await json<unknown>(response)).toEqual({ text: "Hello Eva" });
      expect(decoded).toHaveLength(1);
      const tooLong = await fetch(`${listeningApi.url}/api/transcribe`, {
        method: "POST",
        headers: headers({ "content-type": "audio/webm" }),
        body: new Uint8Array(26 * 1024 * 1024),
      });
      expect(tooLong.status).toBe(413);
    } finally {
      listeningApi.stop();
      listening.stop();
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
      runner: fakeGh(systemProcessRunner),
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

describe("an Eva with releases to pick", () => {
  test("the API installs a chosen newer version, and refuses an unknown one", async () => {
    const applied: (string | undefined)[] = [];
    const updating = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      updateChannel: {
        kind: "executable",
        check: () =>
          Promise.resolve({
            current: "0.2.0",
            latest: "1.0.0",
            available: true,
            releases: [
              { version: "1.0.0", notes: "" },
              { version: "0.3.0", notes: "" },
            ],
          }),
        apply: (version) => {
          applied.push(version);
          return Promise.resolve({ current: "0.2.0", latest: version ?? "?", available: false, releases: [] });
        },
      },
      restartForUpdate: () => undefined,
    });
    const updatingApi = startLocalApi({
      eva: updating,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities: [],
    });
    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${updatingApi.url}/api/update`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      expect((await post({ version: "0.1.0" })).status).toBe(409);
      // An older script posts no body at all: it still means "what the policy allows".
      const empty = await fetch(`${updatingApi.url}/api/update/check`, { method: "POST", headers: headers() });
      expect(empty.status).toBe(200);
      expect((await post({ version: "not a version" })).status).toBe(400);
      expect(await json<unknown>(await post({ version: "1.0.0" }))).toMatchObject({ phase: "restarting" });
      // During the restart, an install with no body changes nothing.
      expect((await fetch(`${updatingApi.url}/api/update`, { method: "POST", headers: headers() })).status).toBe(200);
      expect(applied).toEqual(["1.0.0"]);
    } finally {
      updatingApi.stop();
      updating.stop();
    }
  });
});

describe("remote access", () => {
  let tailscale: FakeTailscale;
  let installs: number;
  let watcher: RemoteAccessWatcher;
  let remoteEva: Eva;
  let remoteApi: LocalApi;

  function startRemote(allowedTailscaleIdentities: readonly string[] = []): void {
    watcher = tailscale.watcher({
      install: () => {
        installs += 1;
        tailscale.status = needsLoginStatus;
        return Promise.resolve();
      },
    });
    remoteEva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date("2026-10-14T10:30:00Z"),
      basePrompt: "Base.",
      remoteAccess: watcher,
    });
    remoteApi = startLocalApi({
      eva: remoteEva,
      port: 0,
      token,
      extraHosts: [],
      allowedTailscaleIdentities,
      tailnet: () => watcher.tailnet(),
    });
  }

  beforeEach(() => {
    tailscale = new FakeTailscale();
    installs = 0;
  });
  afterEach(() => {
    remoteApi.stop();
    remoteEva.stop();
  });

  function remoteCall(
    path: string,
    init: { method?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return fetch(`${remoteApi.url}${path}`, {
      method: init.method ?? "GET",
      headers: init.headers ?? headers(),
      ...(init.method === "POST" ? { body: "{}" } : {}),
    });
  }

  const owner = headers({ host: "server.example-tailnet.ts.net", "tailscale-user-login": "owner@example.com" });

  test("a tailnet name that arrives after the start is a known host at once, with its owner only", async () => {
    startRemote();
    expect((await remoteCall("/api/status", { headers: owner })).status).toBe(403);
    tailscale.status = runningStatus(true);
    await watcher.refresh();
    expect((await remoteCall("/api/status", { headers: owner })).status).toBe(200);
    const stranger = { ...owner, "tailscale-user-login": "stranger@example.com" };
    expect((await remoteCall("/api/status", { headers: stranger })).status).toBe(403);
    // A renamed machine: only the new name is a known host.
    tailscale.status = runningStatus(true, "owner@example.com", "renamed.example-tailnet.ts.net");
    await watcher.refresh();
    expect((await remoteCall("/api/status", { headers: owner })).status).toBe(403);
    const renamed = { ...owner, host: "renamed.example-tailnet.ts.net" };
    expect((await remoteCall("/api/status", { headers: renamed })).status).toBe(200);
  });

  test("a configured list of accounts wins over the owner of the machine", async () => {
    startRemote(["partner@example.com"]);
    tailscale.status = runningStatus(true);
    await watcher.refresh();
    expect((await remoteCall("/api/status", { headers: owner })).status).toBe(403);
    const partner = { ...owner, "tailscale-user-login": "partner@example.com" };
    expect((await remoteCall("/api/status", { headers: partner })).status).toBe(200);
  });

  test("the status carries the setup step, and the token starts the install and the sign-in", async () => {
    startRemote();
    expect((await json<{ remoteAccess: RemoteAccess }>(await remoteCall("/api/status"))).remoteAccess).toMatchObject({
      step: "start",
    });
    const installed = await remoteCall("/api/remote-access/install", { method: "POST" });
    expect(installed.status).toBe(200);
    expect(await json<RemoteAccess>(installed)).toMatchObject({ busy: "installing" });
    while (remoteEva.status().remoteAccess?.busy !== null) await Bun.sleep(5);
    expect(installs).toBe(1);
    const signedIn = await remoteCall("/api/remote-access/sign-in", { method: "POST" });
    expect(await json<RemoteAccess>(signedIn)).toMatchObject({
      step: "sign_in",
      link: "https://login.tailscale.com/a/fresh",
    });
    expect((await remoteCall("/api/remote-access/other", { method: "POST" })).status).toBe(404);
  });

  test("a device login sets up Tailscale, as the console does", async () => {
    startRemote();
    remoteEva.deviceLogins.attachApprover({ name: "Telegram", canApprove: () => true, ask: () => undefined });
    const request = remoteEva.deviceLogins.request("owner@example.com", "a phone");
    remoteEva.deviceLogins.answer(request.id, "allow");
    const answer = remoteEva.deviceLogins.check(request.id, "owner@example.com");
    const deviceToken = answer.state === "allowed" ? answer.token : "";
    const device = { cookie: `eva_device=${deviceToken}`, "content-type": "application/json" };
    for (const path of ["/api/remote-access/install", "/api/remote-access/sign-in"])
      expect((await remoteCall(path, { method: "POST", headers: device })).status).not.toBe(403);
  });

  test("with tailscale serve off, the actions answer that phone access is off", async () => {
    startRemote();
    expect((await call("/api/remote-access/install", { method: "POST", body: {} })).status).toBe(409);
    expect((await call("/api/remote-access/sign-in", { method: "POST", body: {} })).status).toBe(409);
  });
});

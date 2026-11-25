/**
 * The local API of an Eva that needs no git vault. Each test builds its own Eva, so this file skips
 * the git sandbox of `local-api.test.ts`, which is slow on Windows.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import type { RemoteAccess, RemoteAccessWatcher } from "../../../../src/core/remote-access/remote-access.ts";
import { defaultConfig, homePaths } from "../../../../src/core/settings/home.ts";
import { loggedPath, startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { fakeGh } from "../../../support/fake-gh.ts";
import { FakeTailscale, needsLoginStatus, runningStatus } from "../../../support/fake-tailscale.ts";
import { gitEnvironment } from "../../../support/git-sandbox.ts";

const token = "local-api-token-for-tests";
let home: string;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** An Eva with no vault and no remote access, and her API. */
function startBare(): { readonly bare: Eva; readonly bareApi: LocalApi } {
  const bare = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: null },
    secrets: {},
    engines: [new FakeEngine()],
    runner: fakeGh(systemProcessRunner),
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
  });
  return {
    bare,
    bareApi: startLocalApi({ eva: bare, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [] }),
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-api-bare-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("without a vault", () => {
  test("the schedules answer that no vault is configured", async () => {
    const { bare, bareApi } = startBare();
    try {
      const response = await fetch(`${bareApi.url}/api/schedules`, { headers: headers() });
      expect(response.status).toBe(409);
      const chatNames = await fetch(`${bareApi.url}/api/chat-names`, { headers: headers() });
      expect(chatNames.status).toBe(409);
      const menu = await fetch(`${bareApi.url}/api/composer-menu`, { headers: headers() });
      expect(menu.status).toBe(409);
      const rules = await fetch(`${bareApi.url}/api/assistant-rules`, { headers: headers() });
      expect(rules.status).toBe(409);
      const files = await fetch(`${bareApi.url}/api/files`, { headers: headers() });
      expect(await files.json()).toMatchObject({ code: "vault_not_found" });
      const life = await fetch(`${bareApi.url}/api/life/cases`, { headers: headers() });
      expect(await life.json()).toMatchObject({ code: "vault_not_found" });
      const lifeEntity = await fetch(`${bareApi.url}/api/life/cases/x`, { headers: headers() });
      expect(await lifeEntity.json()).toMatchObject({ code: "vault_not_found" });
      const received = await fetch(`${bareApi.url}/api/files/received?name=a.txt`, {
        method: "POST",
        headers: headers({ "content-type": "text/plain" }),
        body: "text",
      });
      expect(await received.json()).toMatchObject({ code: "vault_not_found" });
    } finally {
      bareApi.stop();
      bare.stop();
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
      engines: [new FakeEngine()],
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
    const { bare, bareApi } = startBare();
    try {
      for (const path of ["/api/remote-access/install", "/api/remote-access/sign-in"])
        expect((await fetch(`${bareApi.url}${path}`, { method: "POST", headers: headers(), body: "{}" })).status).toBe(
          409,
        );
    } finally {
      bareApi.stop();
      bare.stop();
    }
  });
});

describe("the widget routes", () => {
  test("the list says so, and a widget path answers nothing", async () => {
    const { bare, bareApi } = startBare();
    try {
      expect((await fetch(`${bareApi.url}/api/widgets`, { headers: headers() })).status).toBe(409);
      const frame = { origin: "null", "sec-fetch-dest": "empty" };
      expect((await fetch(`${bareApi.url}/widgets/${"a".repeat(43)}/index.html`, { headers: frame })).status).toBe(404);
    } finally {
      bareApi.stop();
      bare.stop();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { checkNames } from "../../../../src/core/checks.ts";
import type { RemoteAccess } from "../../../../src/core/remote-access/remote-access.ts";
import { missingSteps, setupProgress, type ProgressInput } from "../../../../src/core/setup/progress.ts";

const ready: RemoteAccess = {
  url: "https://eva.example-tailnet.ts.net",
  problem: null,
  step: "ready",
  link: null,
  account: "owner@example.com",
};

const fresh: ProgressInput = {
  engines: [
    { name: "claude-code", found: true, loggedIn: false },
    { name: "pi", found: true, loggedIn: false },
  ],
  defaultEngine: "claude-code",
  vaultPath: null,
  githubToken: false,
  remoteAccess: { url: null, problem: null, step: "sign_in", link: "https://login.tailscale.com/a/x", account: null },
  devices: 0,
  telegram: { token: false, paired: false },
  google: false,
  checks: {},
};

function step(input: ProgressInput, key: string): ReturnType<typeof setupProgress>[number] | undefined {
  return setupProgress(input).find((found) => found.key === key);
}

describe("setupProgress", () => {
  test("a new machine misses the engine login, the vault, Tailscale and a device; the rest is optional", () => {
    const steps = setupProgress(fresh);
    expect(steps.map((found) => [found.key, found.state])).toEqual([
      ["engine", "missing"],
      ["vault", "missing"],
      ["remoteAccess", "missing"],
      ["device", "missing"],
      ["github", "optional"],
      ["telegram", "optional"],
      ["google", "optional"],
    ]);
    expect(missingSteps(steps)).toBe(4);
    expect(step(fresh, "engine")?.detail).toContain("Log in to Claude");
    expect(step(fresh, "engine")?.detail).toContain("claude setup-token");
    expect(step(fresh, "remoteAccess")?.detail).toContain("Sign in to Tailscale");
    expect(step(fresh, "device")?.detail).toContain("eva devices allow");
  });

  test("everything set up: no step is missing, and each check shows its last result", () => {
    const done: ProgressInput = {
      ...fresh,
      engines: [
        { name: "claude-code", found: true, loggedIn: true },
        { name: "pi", found: true, loggedIn: false },
      ],
      vaultPath: "/vaults/eva",
      githubToken: true,
      remoteAccess: ready,
      devices: 2,
      telegram: { token: true, paired: true },
      google: true,
      checks: { "claude-code": { ok: true, detail: "Claude Code answered.", at: "2026-10-18T10:00:00.000Z" } },
    };
    const steps = setupProgress(done);
    expect(steps.every((found) => found.state === "done")).toBe(true);
    expect(missingSteps(steps)).toBe(0);
    expect(step(done, "engine")).toMatchObject({ check: "claude-code", lastCheck: { ok: true } });
    expect(step(done, "vault")).toMatchObject({ check: "vault", lastCheck: null });
    expect(step(done, "remoteAccess")?.detail).toContain("https://eva.example-tailnet.ts.net");
  });

  test("the engine step is done with either engine's login, and tests that engine", () => {
    const piOnly: ProgressInput = {
      ...fresh,
      engines: [
        { name: "claude-code", found: true, loggedIn: false },
        { name: "pi", found: true, loggedIn: true },
      ],
    };
    expect(step(piOnly, "engine")).toMatchObject({ state: "done", check: "pi" });
  });

  test("with no engine program, the step says that setup installs them", () => {
    const none: ProgressInput = {
      ...fresh,
      engines: [
        { name: "claude-code", found: false, loggedIn: false },
        { name: "pi", found: false, loggedIn: false },
      ],
    };
    expect(step(none, "engine")?.detail).toContain("eva setup");
  });

  test("a missing vault leads to this page, not to a terminal", () => {
    expect(step(fresh, "vault")?.detail).toContain("Pick it from your GitHub repositories");
    expect(step(fresh, "vault")?.detail).not.toContain("eva setup");
  });

  test("phone access that is off is optional; a bot with no paired chat says how to pair", () => {
    const input: ProgressInput = { ...fresh, remoteAccess: null, telegram: { token: true, paired: false } };
    expect(step(input, "remoteAccess")?.state).toBe("optional");
    expect(step(input, "telegram")).toMatchObject({
      state: "optional",
      detail: expect.stringContaining("pairing code") as string,
    });
  });
});

describe("the steps and the checks", () => {
  test("every check behind a Test button belongs to a step, so a new check cannot be forgotten", () => {
    const checks = new Set(setupProgress(fresh).map((found) => found.check));
    // The engine step tests one engine at a time: the other one when only it has a login.
    const piFirst = setupProgress({ ...fresh, defaultEngine: "pi" }).map((found) => found.check);
    for (const name of checkNames) expect(checks.has(name) || piFirst.includes(name)).toBe(true);
  });

  test("with phone access off, a device is optional; the count reads well", () => {
    expect(step({ ...fresh, remoteAccess: null }, "device")?.state).toBe("optional");
    expect(step({ ...fresh, devices: 1 }, "device")?.detail).toBe("1 device can open Eva.");
    expect(step({ ...fresh, devices: 2 }, "device")?.detail).toBe("2 devices can open Eva.");
  });
});

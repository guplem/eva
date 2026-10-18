import { describe, expect, test } from "bun:test";
import { RemoteAccessWatcher } from "../../../../src/core/remote-access/remote-access.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

const running = (https: boolean, owner = "owner@example.com"): string =>
  JSON.stringify({
    BackendState: "Running",
    CertDomains: https ? ["server.example-tailnet.ts.net"] : null,
    Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
    User: { "7": { LoginName: owner } },
  });
const needsLogin = JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "" });

/** A fake Tailscale whose answers the test changes as it goes. */
class FakeTailscale {
  /** A status JSON, or "missing" or "stopped". */
  status = "missing";
  serveExitCode = 0;
  upOutput = "To authenticate, visit:\n\thttps://login.tailscale.com/a/fresh\n";
  readonly commands: string[] = [];
  readonly runner: ProcessRunner = {
    run: (command): Promise<ProcessResult> => {
      const verb = command[1] ?? "";
      this.commands.push(verb);
      if (this.status === "missing")
        return Promise.reject(new EvaError("process_failed", "Could not start tailscale."));
      if (verb === "up") return Promise.resolve({ exitCode: 1, stdout: "", stderr: this.upOutput });
      if (verb === "serve") return Promise.resolve({ exitCode: this.serveExitCode, stdout: "", stderr: "serve broke" });
      if (this.status === "stopped") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "no tailscaled" });
      return Promise.resolve({ exitCode: 0, stdout: this.status, stderr: "" });
    },
  };
}

function watcher(
  fake: FakeTailscale,
  options: { publish?: boolean; install?: (() => Promise<void>) | null } = {},
): RemoteAccessWatcher {
  return new RemoteAccessWatcher({
    runner: fake.runner,
    environment: {},
    port: 7420,
    program: () => ["tailscale"],
    publish: options.publish ?? true,
    install: options.install ?? null,
  });
}

describe("the remote access watcher", () => {
  test("each Tailscale state gives one step, with the link that the step needs", async () => {
    const fake = new FakeTailscale();
    const access = watcher(fake, { install: () => Promise.resolve() });
    expect(await access.refresh()).toMatchObject({ step: "install", url: null, canInstall: true });
    fake.status = "stopped";
    expect(await access.refresh()).toMatchObject({ step: "start", url: null });
    fake.status = needsLogin;
    expect(await access.refresh()).toMatchObject({ step: "sign_in", link: null });
    fake.status = running(false);
    expect(await access.refresh()).toMatchObject({
      step: "https",
      link: "https://login.tailscale.com/admin/dns",
      account: "owner@example.com",
    });
    fake.status = running(true);
    expect(await access.refresh()).toMatchObject({
      step: "ready",
      url: "https://server.example-tailnet.ts.net",
      problem: null,
      account: "owner@example.com",
    });
    expect(access.current().step).toBe("ready");
  });

  test("a ready address is published once, not at each read", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    const access = watcher(fake);
    await access.refresh();
    await access.refresh();
    expect(fake.commands.filter((verb) => verb === "serve")).toHaveLength(1);
  });

  test("a failed publish is its own step; eva setup reads the address without publishing", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    fake.serveExitCode = 1;
    expect(await watcher(fake).refresh()).toMatchObject({ step: "failed", url: null });
    expect((await watcher(fake).refresh()).problem).toContain("serve broke");
    const setup = await watcher(fake, { publish: false }).refresh();
    expect(setup).toMatchObject({ step: "ready", url: "https://server.example-tailnet.ts.net" });
  });

  test("the tailnet snapshot exists only while Tailscale runs, so the local API trusts no stale host", async () => {
    const fake = new FakeTailscale();
    const access = watcher(fake);
    expect(access.tailnet()).toBeNull();
    fake.status = running(true);
    await access.refresh();
    expect(access.tailnet()).toEqual({ hostName: "server.example-tailnet.ts.net", ownerLogin: "owner@example.com" });
    fake.status = "stopped";
    await access.refresh();
    expect(access.tailnet()).toBeNull();
  });

  test("a sign-in asks for a fresh link and keeps it until Tailscale shows its own", async () => {
    const fake = new FakeTailscale();
    fake.status = needsLogin;
    const access = watcher(fake);
    expect(await access.signIn()).toMatchObject({ step: "sign_in", link: "https://login.tailscale.com/a/fresh" });
    expect(await access.refresh()).toMatchObject({ link: "https://login.tailscale.com/a/fresh" });
    fake.status = JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/newer" });
    expect(await access.refresh()).toMatchObject({ link: "https://login.tailscale.com/a/newer" });
    fake.upOutput = "Access denied: prefs write access denied";
    expect((await access.signIn()).problem).toContain("--operator");
  });

  test("an install runs once at a time, and its failure stays on the install step", async () => {
    const fake = new FakeTailscale();
    let release = (): void => undefined;
    let installs = 0;
    const access = watcher(fake, {
      install: () => {
        installs += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    await access.refresh();
    const first = access.install();
    expect(access.current().busy).toBe("installing");
    await access.install();
    expect(installs).toBe(1);
    fake.status = needsLogin;
    release();
    expect(await first).toMatchObject({ step: "sign_in", busy: null });

    const failing = watcher(new FakeTailscale(), {
      install: () => Promise.reject(new EvaError("tailscale_install_failed", "The download failed.")),
    });
    expect(await failing.install()).toMatchObject({ step: "install", problem: "The download failed.", busy: null });
  });

  test("where Eva cannot install, the install step says so and the action does nothing", async () => {
    const fake = new FakeTailscale();
    const access = watcher(fake);
    await access.refresh();
    expect(await access.install()).toMatchObject({ step: "install", canInstall: false });
    expect(fake.commands).toEqual(["status"]);
  });

  test("the watch reads again on each tick, and reports each change of step", async () => {
    const fake = new FakeTailscale();
    const ticks: (() => void)[] = [];
    const steps: string[] = [];
    const access = new RemoteAccessWatcher({
      runner: fake.runner,
      environment: {},
      port: 7420,
      program: () => ["tailscale"],
      publish: true,
      install: null,
      onChange: (changed) => steps.push(changed.step ?? ""),
      setInterval: (tick) => {
        ticks.push(tick);
        return { stop: () => ticks.splice(0) };
      },
    });
    await access.refresh();
    access.watch(30_000);
    fake.status = running(true);
    ticks[0]?.();
    await access.settled();
    ticks[0]?.();
    await access.settled();
    expect(steps).toEqual(["install", "ready"]);
    access.stop();
    expect(ticks).toHaveLength(0);
  });
});

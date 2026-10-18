import { describe, expect, test } from "bun:test";
import { RemoteAccessWatcher } from "../../../../src/core/remote-access/remote-access.ts";
import { FakeTailscale, needsLoginStatus, runningStatus } from "../../../support/fake-tailscale.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

const running = runningStatus;
const needsLogin = needsLoginStatus;

function watcher(
  fake: FakeTailscale,
  options: { install?: (() => Promise<void>) | null; port?: number } = {},
): RemoteAccessWatcher {
  return fake.watcher(options);
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

  test("a second instance publishes and shows its own port", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    expect(await watcher(fake, { port: 7421 }).refresh()).toMatchObject({
      url: "https://server.example-tailnet.ts.net:7421",
    });
    expect(fake.full.find((command) => command[1] === "serve")).toEqual([
      "tailscale",
      "serve",
      "--bg",
      "--https=7421",
      "http://127.0.0.1:7421",
    ]);
  });

  test("a ready address is published again only now and then, a lost one at once", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    const access = watcher(fake);
    await access.refresh();
    await access.refresh();
    expect(fake.commands.filter((verb) => verb === "serve")).toHaveLength(1);
    // `tailscale serve reset` shows no change in the status, so Eva publishes again now and then.
    for (let read = 0; read < 20; read += 1) await access.refresh();
    expect(fake.commands.filter((verb) => verb === "serve")).toHaveLength(2);
    fake.status = "stopped";
    await access.refresh();
    fake.status = running(true);
    await access.refresh();
    expect(fake.commands.filter((verb) => verb === "serve")).toHaveLength(3);
  });

  test("a new host name publishes again, and only the new name is trusted", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    const access = watcher(fake);
    await access.refresh();
    fake.status = running(true, "owner@example.com", "renamed.example-tailnet.ts.net");
    expect(await access.refresh()).toMatchObject({ url: "https://renamed.example-tailnet.ts.net" });
    expect(access.tailnet().hostName).toBe("renamed.example-tailnet.ts.net");
    expect(fake.commands.filter((verb) => verb === "serve")).toHaveLength(2);
  });

  test("a failed publish is its own step", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    fake.serveExitCode = 1;
    const failed = await watcher(fake).refresh();
    expect(failed).toMatchObject({ step: "failed", url: null });
    expect(failed.problem).toContain("serve broke");
  });

  test("the host name exists only while Tailscale runs; the owner stays, so the identity check stays on", async () => {
    const fake = new FakeTailscale();
    const access = watcher(fake);
    expect(access.tailnet()).toEqual({ hostName: null, ownerLogin: null });
    fake.status = running(true);
    await access.refresh();
    expect(access.tailnet()).toEqual({ hostName: "server.example-tailnet.ts.net", ownerLogin: "owner@example.com" });
    fake.status = "stopped";
    await access.refresh();
    expect(access.tailnet()).toEqual({ hostName: null, ownerLogin: "owner@example.com" });
  });

  test("a sign-in asks for a fresh link and keeps it while Tailscale waits for the sign-in", async () => {
    const fake = new FakeTailscale();
    fake.status = needsLogin;
    const access = watcher(fake);
    expect(await access.signIn()).toMatchObject({ step: "sign_in", link: "https://login.tailscale.com/a/fresh" });
    expect(await access.refresh()).toMatchObject({ link: "https://login.tailscale.com/a/fresh" });
    fake.status = JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/newer" });
    expect(await access.refresh()).toMatchObject({ link: "https://login.tailscale.com/a/newer" });
    fake.upOutput = "Access denied: prefs write access denied";
    expect((await access.signIn()).problem).toContain("--operator");
    // A link that expired never comes back after another state.
    fake.status = "stopped";
    await access.refresh();
    fake.status = needsLogin;
    expect(await access.refresh()).toMatchObject({ link: null });
  });

  test("an install runs once at a time", async () => {
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
    while (installs === 0) await Bun.sleep(1);
    fake.status = needsLogin;
    release();
    expect(await first).toMatchObject({ step: "sign_in", busy: null });
    expect(installs).toBe(1);
  });

  test("Eva never installs where Tailscale exists: a second daemon would hide the one that works", async () => {
    const fake = new FakeTailscale();
    fake.status = running(true);
    let installs = 0;
    const access = watcher(fake, {
      install: () => {
        installs += 1;
        return Promise.resolve();
      },
    });
    await access.refresh();
    expect(await access.install()).toMatchObject({ step: "ready", busy: null });
    expect(installs).toBe(0);
  });

  test("a failed install stays visible, also when it left a daemon that does not run", async () => {
    const failing = watcher(new FakeTailscale(), {
      install: () => Promise.reject(new EvaError("tailscale_install_failed", "The download failed.")),
    });
    expect(await failing.install()).toMatchObject({ step: "install", problem: "The download failed.", busy: null });
    expect(await failing.refresh()).toMatchObject({ problem: "The download failed." });

    const fake = new FakeTailscale();
    const partial = watcher(fake, {
      install: () => {
        fake.status = "stopped";
        return Promise.reject(new EvaError("tailscale_install_failed", "systemctl --user failed: no bus"));
      },
    });
    expect(await partial.install()).toMatchObject({ step: "start", problem: "systemctl --user failed: no bus" });

    const other = watcher(new FakeTailscale(), { install: () => Promise.reject(new Error("disk full")) });
    expect((await other.install()).problem).toBe("The Tailscale install failed: disk full");
  });

  test("an install that ends with no Tailscale to find says so", async () => {
    const access = watcher(new FakeTailscale(), { install: () => Promise.resolve() });
    const after = await access.install();
    expect(after.step).toBe("install");
    expect(after.problem).toContain("does not find Tailscale yet");
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
    await access.refresh();
    ticks[0]?.();
    await access.refresh();
    expect(steps).toEqual(["install", "ready"]);
    access.stop();
    expect(ticks).toHaveLength(0);
  });
});

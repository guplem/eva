import { describe, expect, test } from "bun:test";
import type { RemoteAccess } from "../../../../src/core/remote-access/remote-access.ts";
import { describeAccess, deviceSteps, remoteAccessStep, setupSteps } from "../../../../src/core/remote-access/steps.ts";

const base: RemoteAccess = { url: null, problem: null, link: null, account: null, canInstall: false, busy: null };

describe("the setup steps", () => {
  test("each step names what the person does, with its link and the action Eva can take", () => {
    expect(setupSteps({ ...base, step: "install", canInstall: true })).toEqual([
      { text: "Install Tailscale on this machine. Eva can install it for you.", link: null, action: "install" },
    ]);
    expect(setupSteps({ ...base, step: "install" })).toEqual([
      {
        text: "Install Tailscale on this machine, and open it once.",
        link: "https://tailscale.com/download",
        action: null,
      },
    ]);
    expect(setupSteps({ ...base, step: "install", canInstall: true, busy: "installing" })[0]?.action).toBeNull();
    expect(setupSteps({ ...base, step: "start" })[0]?.text).toContain("Start Tailscale");
    expect(setupSteps({ ...base, step: "sign_in", link: "https://login.tailscale.com/a/x" })).toEqual([
      {
        text: "Sign in to Tailscale: open this link on any device.",
        link: "https://login.tailscale.com/a/x",
        action: "sign_in",
      },
    ]);
    expect(setupSteps({ ...base, step: "sign_in" })[0]).toMatchObject({ link: null, action: "sign_in" });
    expect(setupSteps({ ...base, step: "https", link: "https://login.tailscale.com/admin/dns" })[0]).toMatchObject({
      link: "https://login.tailscale.com/admin/dns",
      action: null,
    });
    expect(setupSteps({ ...base, step: "ready", url: "https://server.example-tailnet.ts.net" })).toEqual([]);
  });

  test("a problem comes first, before the step that fixes it", () => {
    const steps = setupSteps({ ...base, step: "install", canInstall: true, problem: "The download failed." });
    expect(steps[0]).toEqual({ text: "The download failed.", link: null, action: null });
    expect(steps[1]?.action).toBe("install");
    expect(setupSteps({ ...base, step: "failed", problem: "tailscale serve failed: x" })).toEqual([
      { text: "tailscale serve failed: x", link: null, action: null },
    ]);
  });

  test("an older Eva sends no step: an address means ready, and no address means a failure", () => {
    expect(remoteAccessStep({ url: "https://a.example-tailnet.ts.net", problem: null })).toBe("ready");
    expect(remoteAccessStep({ url: null, problem: "x" })).toBe("failed");
    expect(remoteAccessStep({ url: null, problem: null, step: "https" })).toBe("https");
  });
});

describe("the steps for each new device", () => {
  test("install, sign in with the same account, open or scan the address", () => {
    const steps = deviceSteps({
      ...base,
      step: "ready",
      url: "https://server.example-tailnet.ts.net",
      account: "owner@example.com",
    });
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ link: "https://tailscale.com/download" });
    expect(steps[1]?.text).toContain("owner@example.com");
    expect(steps[2]?.text).toContain("https://server.example-tailnet.ts.net");
    expect(steps[2]?.text).toContain("scan");
    const notReady = deviceSteps({ ...base, step: "install" });
    expect(notReady[1]?.text).toContain("same account as this machine");
    expect(notReady[2]?.text).not.toContain("https://");
  });
});

describe("describeAccess", () => {
  const localUrl = "http://127.0.0.1:7420";

  test("a ready address comes first, then the device steps, then the local address", () => {
    const lines = describeAccess({
      remoteAccess: { ...base, step: "ready", url: "https://server.example-tailnet.ts.net", account: "o@example.com" },
      localUrl,
    });
    expect(lines[0]).toBe("Open Eva: https://server.example-tailnet.ts.net");
    expect(lines.join("\n")).toContain("1. Install Tailscale");
    expect(lines.join("\n")).toContain("o@example.com");
    expect(lines.at(-1)).toContain("On this machine only (advanced): http://127.0.0.1:7420");
  });

  test("before it is ready, the lines say what to do here, then on each device", () => {
    const text = describeAccess({
      remoteAccess: { ...base, step: "sign_in", link: "https://login.tailscale.com/a/x" },
      localUrl,
      actionHint: "Run `eva setup` to do this with Eva.",
    }).join("\n");
    expect(text).toContain("Use Eva from any device");
    expect(text).toContain("Sign in to Tailscale: open this link on any device. https://login.tailscale.com/a/x");
    expect(text).toContain("Run `eva setup` to do this with Eva.");
    expect(text).toContain("Then, on each phone or computer:");
    expect(text).toContain("within a minute");
    expect(text).not.toContain("restart");
  });

  test("with tailscale serve turned off, the lines say how to turn it on", () => {
    expect(describeAccess({ remoteAccess: null, localUrl })[0]).toContain("remoteAccess.tailscaleServe");
  });
});

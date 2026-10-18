import { describe, expect, test } from "bun:test";
import {
  allowedTailscaleIdentities,
  publishWithTailscale,
  readTailscale,
  TailscalePublisher,
  tailnetPort,
} from "../../../../src/core/remote-access/tailscale.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

function answering(exitCode: number, stdout: string, stderr = ""): ProcessRunner {
  return { run: () => Promise.resolve({ exitCode, stdout, stderr }) };
}

describe("readTailscale", () => {
  test("Tailscale facts come from tailscale status, only when it runs and is logged in", async () => {
    const status = (extra: Record<string, unknown>): string =>
      JSON.stringify({
        BackendState: "Running",
        CertDomains: ["server.example-tailnet.ts.net"],
        Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
        User: { "7": { LoginName: "owner@example.com" } },
        ...extra,
      });
    expect(await readTailscale(answering(0, status({})), {})).toEqual({
      hostName: "server.example-tailnet.ts.net",
      ownerLogin: "owner@example.com",
      httpsEnabled: true,
    });
    expect(await readTailscale(answering(0, status({ User: {} })), {})).toEqual({
      hostName: "server.example-tailnet.ts.net",
      ownerLogin: null,
      httpsEnabled: true,
    });
    expect(await readTailscale(answering(0, status({ BackendState: "NeedsLogin" })), {})).toBeNull();
    expect(await readTailscale(answering(1, status({})), {})).toBeNull();
    expect(await readTailscale(answering(0, "{}"), {})).toBeNull();
    expect(await readTailscale(answering(0, "not json"), {})).toBeNull();
    expect(await readTailscale({ run: () => Promise.reject(new Error("no tailscale")) }, {})).toBeNull();
  });
});

describe("publishWithTailscale", () => {
  const facts = { hostName: "server.example-tailnet.ts.net", ownerLogin: "owner@example.com", httpsEnabled: true };

  test("the default instance gets an address with no port; another instance keeps its own port", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
    expect(await publishWithTailscale(recording, {}, facts, 7420)).toEqual({
      url: "https://server.example-tailnet.ts.net",
      problem: null,
    });
    expect(await publishWithTailscale(recording, {}, facts, 7421)).toEqual({
      url: "https://server.example-tailnet.ts.net:7421",
      problem: null,
    });
    expect(commands[0]).toEqual(["tailscale", "serve", "--bg", "--https=443", "http://127.0.0.1:7420"]);
    expect(tailnetPort(7421)).toBe(7421);
  });

  test("a tailnet without HTTPS gets the link that turns it on; any other failure names itself", async () => {
    const disabled = answering(
      1,
      "Serve is not enabled on your tailnet.\nhttps://login.tailscale.com/f/serve?node=abc\n",
    );
    expect(await publishWithTailscale(disabled, {}, facts, 7420)).toEqual({
      url: null,
      problem:
        "Turn on HTTPS for your tailnet once at https://login.tailscale.com/f/serve?node=abc. Eva then publishes her page by herself.",
    });
    expect((await publishWithTailscale(answering(1, "", "permission denied"), {}, facts, 7420)).problem).toContain(
      "permission denied",
    );
    const throwing: ProcessRunner = { run: () => Promise.reject(new Error("timed out")) };
    expect((await publishWithTailscale(throwing, {}, facts, 7420)).problem).toContain("timed out");
  });
});

describe("a tailnet with HTTPS off", () => {
  test("Eva never runs tailscale serve, which would wait for a person, and names the page that turns HTTPS on", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
    const facts = { hostName: "server.example-tailnet.ts.net", ownerLogin: null, httpsEnabled: false };
    expect((await publishWithTailscale(recording, {}, facts, 7420)).problem).toContain(
      "https://login.tailscale.com/admin/dns",
    );
    expect(commands).toEqual([]);
    const status = JSON.stringify({ BackendState: "Running", Self: { DNSName: "server.example-tailnet.ts.net." } });
    expect((await readTailscale(answering(0, status), {}))?.httpsEnabled).toBe(false);
  });
});

describe("TailscalePublisher", () => {
  const statusJson = (https: boolean): string =>
    JSON.stringify({
      BackendState: "Running",
      CertDomains: https ? ["server.example-tailnet.ts.net"] : [],
      Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
      User: { "7": { LoginName: "owner@example.com" } },
    });

  /** A tailnet whose HTTPS a test can turn on; it records each `tailscale` command. */
  function tailnet(): { runner: ProcessRunner; commands: string[][]; https: { on: boolean } } {
    const https = { on: false };
    const commands: string[][] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        const stdout = command[1] === "status" ? statusJson(https.on) : "";
        return Promise.resolve({ exitCode: 0, stdout, stderr: "" });
      },
    };
    return { runner, commands, https };
  }

  test("with tailscaleServe off, Eva never runs tailscale", async () => {
    const { runner, commands } = tailnet();
    const publisher = await TailscalePublisher.start({ enabled: false, runner, environment: {}, port: 7420 });
    expect(publisher.access()).toBeNull();
    expect(publisher.hostName()).toBeNull();
    expect(publisher.ownerLogin()).toBeNull();
    expect(await publisher.retry()).toBe(false);
    expect(commands).toEqual([]);
  });

  test("without a running Tailscale, there is no access and no retry", async () => {
    const commands: string[][] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      },
    };
    const publisher = await TailscalePublisher.start({ enabled: true, runner, environment: {}, port: 7420 });
    expect(publisher.access()).toBeNull();
    expect(await publisher.retry()).toBe(false);
    expect(commands).toHaveLength(1);
  });

  test("tries again until the tailnet turns HTTPS on, then stops trying", async () => {
    const { runner, commands, https } = tailnet();
    const publisher = await TailscalePublisher.start({ enabled: true, runner, environment: {}, port: 7420 });
    expect(publisher.hostName()).toBe("server.example-tailnet.ts.net");
    expect(publisher.ownerLogin()).toBe("owner@example.com");
    expect(publisher.access()?.url).toBeNull();
    expect(await publisher.retry()).toBe(false);
    https.on = true;
    expect(await publisher.retry()).toBe(true);
    expect(publisher.access()).toEqual({ url: "https://server.example-tailnet.ts.net", problem: null });
    const ran = commands.length;
    expect(await publisher.retry()).toBe(false);
    expect(commands).toHaveLength(ran);
  });
});

describe("allowedTailscaleIdentities", () => {
  test("with no list, only the account that owns this machine gets in", () => {
    expect(allowedTailscaleIdentities([], "owner@example.com")).toEqual(["owner@example.com"]);
    expect(allowedTailscaleIdentities([], null)).toEqual([]);
    expect(allowedTailscaleIdentities(["friend@example.com"], "owner@example.com")).toEqual(["friend@example.com"]);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimHub,
  claimHubIfUnclaimed,
  hubFilePath,
  machineRole,
  readHubClaim,
} from "../../../../src/core/instance/hub.ts";
import {
  publishWithTailscale,
  readTailscale,
  tailnetPort,
  withMachineDefaults,
} from "../../../../src/core/instance/machine-defaults.ts";
import { defaultConfig } from "../../../../src/core/instance/home.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

let vault: string;
const now = new Date("2026-10-17T10:00:00Z");

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-hub-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("the hub claim", () => {
  test("without a vault, or before any claim, this machine is the hub", () => {
    expect(machineRole(null, "laptop", "satellite")).toBe("hub");
    expect(machineRole(vault, "laptop", "satellite")).toBe("hub");
    expect(readHubClaim(vault)).toBeNull();
  });

  test("a broken claim keeps the last known role, so two machines never both become the hub", () => {
    mkdirSync(join(vault, ".eva"));
    for (const broken of ["{ not json", "null", JSON.stringify({ machine: "" })]) {
      writeFileSync(hubFilePath(vault), broken);
      expect(machineRole(vault, "pc", "satellite")).toBe("satellite");
      expect(machineRole(vault, "server", "hub")).toBe("hub");
    }
  });

  test("a broken claim is never claimed over by a machine that starts", () => {
    mkdirSync(join(vault, ".eva"));
    writeFileSync(hubFilePath(vault), "{ not json");
    expect(claimHubIfUnclaimed(vault, "pc", now)).toBe(false);
  });

  test("the first machine claims the hub, and the others become satellites", () => {
    expect(claimHubIfUnclaimed(vault, "server", now)).toBe(true);
    expect(claimHubIfUnclaimed(vault, "pc", now)).toBe(false);
    expect(readHubClaim(vault)).toEqual({ machine: "server", since: "2026-10-17T10:00:00.000Z" });
    expect(machineRole(vault, "server", "hub")).toBe("hub");
    expect(machineRole(vault, "pc", "hub")).toBe("satellite");
  });

  test("any machine can take the hub over", () => {
    claimHub(vault, "server", now);
    claimHub(vault, "pc", now);
    expect(machineRole(vault, "pc", "hub")).toBe("hub");
    expect(machineRole(vault, "server", "hub")).toBe("satellite");
  });

  test("a broken or empty claim counts as no claim", () => {
    mkdirSync(join(vault, ".eva"));
    writeFileSync(hubFilePath(vault), "{ not json");
    expect(readHubClaim(vault)).toBeNull();
    writeFileSync(hubFilePath(vault), JSON.stringify({ machine: "" }));
    expect(readHubClaim(vault)).toBeNull();
    writeFileSync(hubFilePath(vault), "null");
    expect(readHubClaim(vault)).toBeNull();
    writeFileSync(hubFilePath(vault), JSON.stringify({ machine: "server" }));
    expect(readHubClaim(vault)).toEqual({ machine: "server", since: "" });
  });

  test("a missing vault folder is never claimed", () => {
    expect(claimHubIfUnclaimed(join(vault, "missing"), "server", now)).toBe(false);
  });
});

describe("machine defaults (plug and play)", () => {
  test("the vault folder and the voice model come from the home folder when they exist there", () => {
    const found = new Set([join("/home/eva", "vault", ".git"), join("/home/eva", "voice", "ggml-base.bin")]);
    const config = withMachineDefaults(defaultConfig, { homeRoot: "/home/eva", exists: (path) => found.has(path) });
    expect(config.vaultPath).toBe(join("/home/eva", "vault"));
    expect(config.voice.modelPath).toBe(join("/home/eva", "voice", "ggml-base.bin"));
  });

  test("a value that is set, or a file that is missing, leaves the setting as it is", () => {
    const set = { ...defaultConfig, vaultPath: "/vault", voice: { ...defaultConfig.voice, modelPath: "/model.bin" } };
    expect(withMachineDefaults(set, { homeRoot: "/home/eva", exists: () => true })).toEqual(set);
    expect(withMachineDefaults(defaultConfig, { homeRoot: "/home/eva", exists: () => false })).toEqual(defaultConfig);
  });

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

function answering(exitCode: number, stdout: string, stderr = ""): ProcessRunner {
  return { run: () => Promise.resolve({ exitCode, stdout, stderr }) };
}

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

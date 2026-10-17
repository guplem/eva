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
import { tailscaleHostName, withMachineDefaults } from "../../../../src/core/instance/machine-defaults.ts";
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

describe("the hub claim (plan §4.4)", () => {
  test("without a vault, or before any claim, this machine is the hub", () => {
    expect(machineRole(null, "laptop")).toBe("hub");
    expect(machineRole(vault, "laptop")).toBe("hub");
    expect(readHubClaim(vault)).toBeNull();
  });

  test("the first machine claims the hub, and the others become satellites", () => {
    expect(claimHubIfUnclaimed(vault, "server", now)).toBe(true);
    expect(claimHubIfUnclaimed(vault, "pc", now)).toBe(false);
    expect(readHubClaim(vault)).toEqual({ machine: "server", since: "2026-10-17T10:00:00.000Z" });
    expect(machineRole(vault, "server")).toBe("hub");
    expect(machineRole(vault, "pc")).toBe("satellite");
  });

  test("any machine can take the hub over", () => {
    claimHub(vault, "server", now);
    claimHub(vault, "pc", now);
    expect(machineRole(vault, "pc")).toBe("hub");
    expect(machineRole(vault, "server")).toBe("satellite");
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

  test("the Tailscale name comes from tailscale status, and anything else means no name", async () => {
    const answering = (exitCode: number, stdout: string): ProcessRunner => ({
      run: () => Promise.resolve({ exitCode, stdout, stderr: "" }),
    });
    const status = JSON.stringify({ Self: { DNSName: "server.example-tailnet.ts.net." } });
    expect(await tailscaleHostName(answering(0, status), {})).toBe("server.example-tailnet.ts.net");
    expect(await tailscaleHostName(answering(1, status), {})).toBeNull();
    expect(await tailscaleHostName(answering(0, "{}"), {})).toBeNull();
    expect(await tailscaleHostName(answering(0, "not json"), {})).toBeNull();
    expect(await tailscaleHostName({ run: () => Promise.reject(new Error("no tailscale")) }, {})).toBeNull();
  });
});

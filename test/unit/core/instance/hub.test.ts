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

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMachineReport } from "../../../../src/core/alerts/machine-reports.ts";
import { listComputers } from "../../../../src/core/instance/computers.ts";
import { claimHub } from "../../../../src/core/instance/hub.ts";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-computers-"));
  mkdirSync(join(vault, ".git"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const now = new Date("2026-01-02T10:00:00Z");

describe("the computers with the vault", () => {
  test("lists each computer that reports, with the hub first and this computer marked", () => {
    writeMachineReport(vault, { machine: "laptop", version: "1.2.0", problems: [] }, now);
    writeMachineReport(vault, { machine: "desktop", version: "1.3.0", problems: [] }, now);
    writeMachineReport(vault, { machine: "server", version: "1.3.0", problems: [] }, now);
    claimHub(vault, "server", now);
    expect(listComputers(vault, "laptop", "1.4.0", "satellite")).toEqual([
      { name: "server", role: "hub", version: "1.3.0", current: false },
      { name: "desktop", role: "satellite", version: "1.3.0", current: false },
      // This computer shows the version that runs now, not the one of its last report.
      { name: "laptop", role: "satellite", version: "1.4.0", current: true },
    ]);
  });

  test("lists this computer and the hub even before they report", () => {
    claimHub(vault, "server", now);
    expect(listComputers(vault, "laptop", "1.4.0", "satellite")).toEqual([
      { name: "server", role: "hub", version: null, current: false },
      { name: "laptop", role: "satellite", version: "1.4.0", current: true },
    ]);
  });

  test("without a vault or a hub claim, this computer is the hub and the only one", () => {
    expect(listComputers(null, "laptop", "1.4.0", "hub")).toEqual([
      { name: "laptop", role: "hub", version: "1.4.0", current: true },
    ]);
    expect(listComputers(vault, "laptop", "1.4.0", "hub")).toEqual([
      { name: "laptop", role: "hub", version: "1.4.0", current: true },
    ]);
  });

  test("skips a broken report, and keeps the others", () => {
    writeMachineReport(vault, { machine: "desktop", version: "1.3.0", problems: [] }, now);
    writeFileSync(join(vault, ".eva", "machines", "broken.json"), "{ not json");
    claimHub(vault, "laptop", now);
    expect(listComputers(vault, "laptop", "1.4.0", "hub").map((each) => each.name)).toEqual(["laptop", "desktop"]);
  });
});

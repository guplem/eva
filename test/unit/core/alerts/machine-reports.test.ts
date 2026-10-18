import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  machineReportPath,
  readMachineReports,
  writeMachineReport,
  type MachineReport,
} from "../../../../src/core/alerts/machine-reports.ts";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-reports-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const report: MachineReport = {
  machine: "laptop",
  version: "1.2.3",
  problems: [{ key: "vault_ahead", level: "warn", message: "Update Eva on laptop.", resolvedMessage: "Fixed." }],
};

describe("the machine reports", () => {
  test("a report round-trips through the vault", () => {
    expect(writeMachineReport(vault, report)).toBe(true);
    expect(readMachineReports(vault)).toEqual([report]);
  });

  test("an unchanged report is not written again, so it makes no commit", () => {
    writeMachineReport(vault, report);
    const before = statSync(machineReportPath(vault, "laptop")).mtimeMs;
    expect(writeMachineReport(vault, { ...report, problems: [...report.problems] })).toBe(false);
    expect(statSync(machineReportPath(vault, "laptop")).mtimeMs).toBe(before);
    expect(writeMachineReport(vault, { ...report, problems: [] })).toBe(true);
    expect(readMachineReports(vault)[0]?.problems).toEqual([]);
  });

  test("a vault folder that is not cloned yet gets no report", () => {
    rmSync(vault, { recursive: true, force: true });
    expect(writeMachineReport(vault, report)).toBe(false);
    expect(readMachineReports(vault)).toEqual([]);
  });

  test("the file name keeps only safe characters", () => {
    expect(machineReportPath(vault, "my laptop/../x")).toBe(join(vault, ".eva", "machines", "my-laptop-..-x.json"));
    writeMachineReport(vault, { ...report, machine: "my laptop/../x" });
    expect(readMachineReports(vault).map((read) => read.machine)).toEqual(["my laptop/../x"]);
  });

  test("a broken file, a broken problem, or a file under another machine's name is skipped", () => {
    const folder = join(vault, ".eva", "machines");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "broken.json"), "{ not json");
    writeFileSync(join(folder, "nameless.json"), JSON.stringify({ problems: [] }));
    writeFileSync(join(folder, "other.json"), JSON.stringify({ ...report, machine: "server" }));
    writeFileSync(join(folder, "notes.txt"), "not a report");
    writeFileSync(
      join(folder, "pc.json"),
      JSON.stringify({ machine: "pc", problems: [{ key: "x" }, { key: "y", level: "error", message: "Broken." }] }),
    );
    expect(readMachineReports(vault)).toEqual([
      {
        machine: "pc",
        version: "",
        problems: [{ key: "y", level: "error", message: "Broken.", resolvedMessage: "" }],
      },
    ]);
  });

  test("the file ends with a new line, as the other vault files do", () => {
    writeMachineReport(vault, report);
    expect(readFileSync(machineReportPath(vault, "laptop"), "utf8").endsWith("}\n")).toBe(true);
  });
});

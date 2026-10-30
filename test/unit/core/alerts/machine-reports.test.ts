import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  machineReportPath,
  readMachineReports,
  writeMachineReport,
  type MachineReport,
} from "../../../../src/core/alerts/machine-reports.ts";

let vault: string;
const now = new Date("2026-10-14T10:30:00Z");
const hourMs = 60 * 60_000;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-reports-"));
  mkdirSync(join(vault, ".git"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const report: MachineReport = {
  machine: "laptop",
  version: "1.2.3",
  problems: [{ key: "vault_ahead", level: "warn", message: "Update Eva on laptop.", resolvedMessage: "Fixed." }],
};
const stamped: MachineReport = { ...report, reportedAt: now.toISOString() };

describe("the machine reports", () => {
  test("a report round-trips through the vault", () => {
    expect(writeMachineReport(vault, report, now)).toBe("written");
    expect(readMachineReports(vault)).toEqual([{ file: "laptop.json", report: stamped }]);
  });

  test("an unchanged report is not written again, so it makes no commit", () => {
    writeMachineReport(vault, report, now);
    const before = statSync(machineReportPath(vault, "laptop")).mtimeMs;
    expect(writeMachineReport(vault, { ...report, problems: [...report.problems] }, now)).toBe("unchanged");
    expect(statSync(machineReportPath(vault, "laptop")).mtimeMs).toBe(before);
    expect(writeMachineReport(vault, { ...report, problems: [] }, now)).toBe("written");
    expect(readMachineReports(vault)[0]?.report?.problems).toEqual([]);
  });

  test("a report with problems renews its time stamp only after 12 hours, so a sync makes few commits (#542)", () => {
    writeMachineReport(vault, report, now);
    const later = (hours: number): Date => new Date(now.getTime() + hours * hourMs);
    expect(writeMachineReport(vault, report, later(11))).toBe("unchanged");
    expect(writeMachineReport(vault, report, later(13))).toBe("written");
    expect(readMachineReports(vault)[0]?.report?.reportedAt).toBe(later(13).toISOString());
  });

  test("a report with no problems has no time stamp, so it never changes on its own (#542)", () => {
    writeMachineReport(vault, { ...report, problems: [] }, now);
    expect(readMachineReports(vault)[0]?.report?.reportedAt).toBeUndefined();
    expect(writeMachineReport(vault, { ...report, problems: [] }, new Date(now.getTime() + 48 * hourMs))).toBe(
      "unchanged",
    );
  });

  test("a time stamp in the future is renewed, so a wrong clock cannot freeze it (#542)", () => {
    writeMachineReport(vault, report, new Date(now.getTime() + 48 * hourMs));
    expect(writeMachineReport(vault, report, now)).toBe("written");
    expect(readMachineReports(vault)[0]?.report?.reportedAt).toBe(now.toISOString());
  });

  test("a report from an older Eva has no time stamp, and a broken one reads as none (#542)", () => {
    mkdirSync(join(vault, ".eva", "machines"), { recursive: true });
    writeFileSync(machineReportPath(vault, "laptop"), JSON.stringify(report));
    expect(readMachineReports(vault)[0]?.report).toEqual(report);
    writeFileSync(machineReportPath(vault, "laptop"), JSON.stringify({ ...report, reportedAt: "yesterday" }));
    expect(readMachineReports(vault)[0]?.report).toEqual(report);
  });

  test("a vault folder that waits for its clone gets no report, so the clone still works", () => {
    rmSync(join(vault, ".git"), { recursive: true });
    expect(writeMachineReport(vault, report, now)).toBe("no_vault");
    expect(readdirSync(vault)).toEqual([]);
    rmSync(vault, { recursive: true, force: true });
    expect(writeMachineReport(vault, report, now)).toBe("no_vault");
    expect(readMachineReports(vault)).toEqual([]);
  });

  test("the file name keeps only safe characters", () => {
    expect(machineReportPath(vault, "my laptop/../x")).toBe(join(vault, ".eva", "machines", "my-laptop-..-x.json"));
    writeMachineReport(vault, { ...report, machine: "my laptop/../x" }, now);
    expect(readMachineReports(vault).map((read) => read.report?.machine)).toEqual(["my laptop/../x"]);
  });

  test("a broken file reads as null, and a file under another machine's name or a broken problem is skipped", () => {
    const folder = join(vault, ".eva", "machines");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "broken.json"), "{ not json");
    writeFileSync(join(folder, "nameless.json"), JSON.stringify({ problems: [] }));
    writeFileSync(join(folder, "other.json"), JSON.stringify({ ...report, machine: "server" }));
    writeFileSync(join(folder, "notes.txt"), "not a report");
    writeFileSync(
      join(folder, "pc.json"),
      JSON.stringify({ machine: "PC", problems: [{ key: "x" }, { key: "y", level: "error", message: "Broken." }] }),
    );
    expect(readMachineReports(vault)).toEqual([
      { file: "broken.json", report: null },
      { file: "nameless.json", report: null },
      {
        file: "pc.json",
        report: {
          machine: "PC",
          version: "",
          problems: [{ key: "y", level: "error", message: "Broken.", resolvedMessage: "" }],
        },
      },
    ]);
  });

  test("a machine never takes over the file of another machine whose name shares it", () => {
    writeMachineReport(vault, report, now);
    expect(writeMachineReport(vault, { ...report, machine: "Laptop", problems: [] }, now)).toBe("name_taken");
    expect(readMachineReports(vault)).toEqual([{ file: "laptop.json", report: stamped }]);
    expect(writeMachineReport(vault, { ...report, problems: [] }, now)).toBe("written");
  });

  test("the file ends with a new line, as the other vault files do", () => {
    writeMachineReport(vault, report, now);
    expect(readFileSync(machineReportPath(vault, "laptop"), "utf8").endsWith("}\n")).toBe(true);
  });
});

test("a hidden mark round-trips, and any other value of it reads as not hidden (#541)", () => {
  const hidden: MachineReport = { ...report, problems: [{ ...report.problems[0]!, hidden: true }] };
  writeMachineReport(vault, hidden, now);
  expect(readMachineReports(vault)[0]?.report).toEqual({ ...hidden, reportedAt: now.toISOString() });
  writeFileSync(
    machineReportPath(vault, "laptop"),
    JSON.stringify({ ...report, problems: [{ ...report.problems[0], hidden: "yes" }] }),
  );
  expect(readMachineReports(vault)[0]?.report).toEqual(report);
});

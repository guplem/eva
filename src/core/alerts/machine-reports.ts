/**
 * The open problems of each machine, in the vault. Only the hub runs Telegram, so each machine
 * writes its problems to `.eva/machines/<machine>.json`, and the hub raises their alerts (#126).
 * The #119 gate does not cover these files: a machine that is behind the vault must still report it.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant, readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { OpenAlert } from "./alert-center.ts";

/** A problem in a report. "hidden" is present only when the person hid its notice on that machine. */
export interface ReportedProblem extends OpenAlert {
  readonly hidden?: true;
}

export interface MachineReport {
  readonly machine: string;
  /** The Eva version of the machine. */
  readonly version: string;
  readonly problems: readonly ReportedProblem[];
}

const reportsFolder = [".eva", "machines"] as const;

export function machineReportPath(vaultPath: string, machine: string): string {
  return join(vaultPath, ...reportsFolder, `${safeFileName(machine)}.json`);
}

/** The report's path inside the vault, with forward slashes, for a message to the owner. */
export function machineReportFile(machine: string): string {
  return [...reportsFolder, `${safeFileName(machine)}.json`].join("/");
}

export type ReportWrite = "written" | "unchanged" | "no_vault" | "name_taken";

/**
 * Writes the report only when its content changes. The file has no time stamp. The sync commits
 * every change, and a report runs after each sync step.
 */
export function writeMachineReport(vaultPath: string, report: MachineReport): ReportWrite {
  // A vault folder that waits for its clone must stay empty, or the clone fails.
  if (!existsSync(join(vaultPath, ".git"))) return "no_vault";
  const path = machineReportPath(vaultPath, report.machine);
  const current = readTextTolerant(path);
  const content = JSON.stringify(report, null, 2) + "\n";
  if (current === content) return "unchanged";
  // Two machines that share a file would rewrite it at each sync, and make a commit each time.
  const owner = current === null ? null : readOwner(current);
  if (owner !== null && owner !== report.machine) return "name_taken";
  writeFileAtomic(path, content);
  return "written";
}

export interface ReadReport {
  readonly file: string;
  /** Null when the file is broken, such as in the middle of a sync conflict. */
  readonly report: MachineReport | null;
}

/** The reports in the vault, by file. A file under another machine's name is skipped. */
export function readMachineReports(vaultPath: string): ReadReport[] {
  const folder = join(vaultPath, ...reportsFolder);
  let names: string[];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const reports: ReadReport[] = [];
  for (const file of names.sort()) {
    const read = readJsonTolerant(join(folder, file));
    const report = read.ok ? parseReport(read.value) : null;
    if (report === null || `${safeFileName(report.machine)}.json` === file) reports.push({ file, report });
  }
  return reports;
}

/** Lower case, because Windows sees "Laptop" and "laptop" as one file. */
function safeFileName(machine: string): string {
  return machine.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function readOwner(content: string): string | null {
  try {
    return parseReport(JSON.parse(content) as unknown)?.machine ?? null;
  } catch {
    return null;
  }
}

function parseReport(value: unknown): MachineReport | null {
  if (value === null || typeof value !== "object") return null;
  const { machine, version, problems } = value as Partial<Record<keyof MachineReport, unknown>>;
  if (typeof machine !== "string" || machine.length === 0) return null;
  return {
    machine,
    version: typeof version === "string" ? version : "",
    problems: Array.isArray(problems) ? problems.flatMap((problem) => parseProblem(problem) ?? []) : [],
  };
}

function parseProblem(value: unknown): ReportedProblem | null {
  if (value === null || typeof value !== "object") return null;
  const { key, level, message, resolvedMessage, hidden } = value as Partial<Record<keyof ReportedProblem, unknown>>;
  if (typeof key !== "string" || typeof message !== "string") return null;
  if (level !== "warn" && level !== "error") return null;
  return {
    key,
    level,
    message,
    resolvedMessage: typeof resolvedMessage === "string" ? resolvedMessage : "",
    // An older Eva writes no mark: its problems are not hidden.
    ...(hidden === true ? { hidden } : {}),
  };
}

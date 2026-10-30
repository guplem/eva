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
  /**
   * When the machine last renewed its report, so the hub can tell an old report (#542).
   * Absent when the report has no problems, or from an older Eva.
   */
  readonly reportedAt?: string;
  readonly problems: readonly ReportedProblem[];
}

const reportsFolder = [".eva", "machines"] as const;
/**
 * A machine renews its time stamp only after this long, so the stamp makes at most two commits a
 * day. It stays below one day, so a running machine never looks old on the hub.
 */
const renewStampAfterMs = 12 * 60 * 60_000;

export function machineReportPath(vaultPath: string, machine: string): string {
  return join(vaultPath, ...reportsFolder, `${safeFileName(machine)}.json`);
}

/** The report's path inside the vault, with forward slashes, for a message to the owner. */
export function machineReportFile(machine: string): string {
  return [...reportsFolder, `${safeFileName(machine)}.json`].join("/");
}

export type ReportWrite = "written" | "unchanged" | "no_vault" | "name_taken";

/**
 * Writes the report only when its content changes. The sync commits every change, and a report
 * runs after each sync step. So the time stamp changes only after `renewStampAfterMs`, and only
 * while the machine has problems.
 */
export function writeMachineReport(
  vaultPath: string,
  report: Omit<MachineReport, "reportedAt">,
  now: Date,
): ReportWrite {
  // A vault folder that waits for its clone must stay empty, or the clone fails.
  if (!existsSync(join(vaultPath, ".git"))) return "no_vault";
  const path = machineReportPath(vaultPath, report.machine);
  const current = readTextTolerant(path);
  const written = current === null ? null : readReport(current);
  const content = JSON.stringify(stamped(report, written?.reportedAt, now), null, 2) + "\n";
  if (current === content) return "unchanged";
  // Two machines that share a file would rewrite it at each sync, and make a commit each time.
  const owner = written?.machine ?? null;
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

/** The report with its time stamp: the written one while it is fresh, or now. */
function stamped(report: Omit<MachineReport, "reportedAt">, writtenAt: string | undefined, now: Date): MachineReport {
  const { machine, version, problems } = report;
  if (problems.length === 0) return { machine, version, problems };
  const ageMs = writtenAt === undefined ? Number.NaN : now.getTime() - Date.parse(writtenAt);
  // A stamp from the future, such as after a clock fix, would never age, so it is renewed too.
  const reportedAt = writtenAt !== undefined && ageMs >= 0 && ageMs < renewStampAfterMs ? writtenAt : now.toISOString();
  return { machine, version, reportedAt, problems };
}

function readReport(content: string): MachineReport | null {
  try {
    return parseReport(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
}

function parseReport(value: unknown): MachineReport | null {
  if (value === null || typeof value !== "object") return null;
  const { machine, version, reportedAt, problems } = value as Partial<Record<keyof MachineReport, unknown>>;
  if (typeof machine !== "string" || machine.length === 0) return null;
  return {
    machine,
    version: typeof version === "string" ? version : "",
    ...(typeof reportedAt === "string" && !Number.isNaN(Date.parse(reportedAt)) ? { reportedAt } : {}),
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

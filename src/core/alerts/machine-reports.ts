/**
 * The open problems of each machine, in the vault. Only the hub runs Telegram, so each machine
 * writes its problems to `.eva/machines/<machine>.json`, and the hub raises their alerts (#126).
 * The #119 gate does not cover these files: a machine that is behind the vault must still report it.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant, readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { OpenAlert } from "./alert-center.ts";

export interface MachineReport {
  readonly machine: string;
  /** The Eva version of the machine. */
  readonly version: string;
  readonly problems: readonly OpenAlert[];
}

const reportsFolder = [".eva", "machines"] as const;

export function machineReportPath(vaultPath: string, machine: string): string {
  return join(vaultPath, ...reportsFolder, `${safeFileName(machine)}.json`);
}

/**
 * Writes the report only when its content changes. The file has no time stamp, because the
 * sync commits every change, and a report runs after each sync step. Returns true when it wrote.
 */
export function writeMachineReport(vaultPath: string, report: MachineReport): boolean {
  // A vault folder that is not cloned yet must stay empty, or the clone fails.
  if (!existsSync(vaultPath)) return false;
  const path = machineReportPath(vaultPath, report.machine);
  const content = JSON.stringify(report, null, 2) + "\n";
  if (readTextTolerant(path) === content) return false;
  writeFileAtomic(path, content);
  return true;
}

/** The reports in the vault. A broken file, or a file under another machine's name, is skipped. */
export function readMachineReports(vaultPath: string): MachineReport[] {
  const folder = join(vaultPath, ...reportsFolder);
  let names: string[];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const reports: MachineReport[] = [];
  for (const name of names.sort()) {
    const read = readJsonTolerant(join(folder, name));
    const report = read.ok ? parseReport(read.value) : null;
    // Two names can share one safe file name; only the owner of the name counts.
    if (report !== null && `${safeFileName(report.machine)}.json` === name) reports.push(report);
  }
  return reports;
}

function safeFileName(machine: string): string {
  return machine.replace(/[^A-Za-z0-9._-]/g, "-");
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

function parseProblem(value: unknown): OpenAlert | null {
  if (value === null || typeof value !== "object") return null;
  const { key, level, message, resolvedMessage } = value as Partial<Record<keyof OpenAlert, unknown>>;
  if (typeof key !== "string" || typeof message !== "string") return null;
  if (level !== "warn" && level !== "error") return null;
  return { key, level, message, resolvedMessage: typeof resolvedMessage === "string" ? resolvedMessage : "" };
}

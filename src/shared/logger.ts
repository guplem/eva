/**
 * Eva's log: one JSON line per record in `logs/eva-YYYY-MM-DD.jsonl`, kept for 14 days
 * (docs/plan.md §4.4). Every record is redacted first (lesson 95). Logging never throws.
 * `readRecentLogEntries` reads the last warnings and errors back, for `/logs` (plan §8.2).
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Redactor } from "./redaction.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface FileLoggerOptions {
  readonly folder: string;
  readonly redactor: Redactor;
  readonly now: () => Date;
  readonly retentionDays?: number;
}

const dayMs = 24 * 60 * 60 * 1000;

export class FileLogger implements Logger {
  private readonly options: FileLoggerOptions;

  constructor(options: FileLoggerOptions) {
    this.options = options;
  }

  log(level: LogLevel, message: string, details?: Readonly<Record<string, unknown>>): void {
    const at = this.options.now();
    const record = { at: at.toISOString(), level, message, ...(details === undefined ? {} : { details }) };
    const line = this.options.redactor.redact(JSON.stringify(record));
    try {
      mkdirSync(this.options.folder, { recursive: true });
      appendFileSync(join(this.options.folder, `eva-${at.toISOString().slice(0, 10)}.jsonl`), `${line}\n`);
    } catch {
      // A full disk or a missing folder must never stop Eva.
    }
  }

  /** Deletes log files whose last change is older than the retention period. */
  removeOldFiles(): void {
    const limit = this.options.now().getTime() - (this.options.retentionDays ?? 14) * dayMs;
    try {
      for (const name of readdirSync(this.options.folder)) {
        if (!/^eva-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
        const path = join(this.options.folder, name);
        if (statSync(path).mtimeMs < limit) rmSync(path, { force: true });
      }
    } catch {
      // No folder yet: nothing to remove.
    }
  }
}

/** One log record, short enough for a phone: `summary` puts the details on one line. */
export interface LogEntry {
  readonly at: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly summary: string;
}

export interface RecentLogQuery {
  /** "warn" gives warnings and errors; "error" gives errors only. */
  readonly minimumLevel: "warn" | "error";
  readonly limit: number;
}

const logFileName = /^eva-\d{4}-\d{2}-\d{2}\.jsonl$/;
const summaryValueLength = 80;
const summaryLength = 160;

/**
 * The last records at or above a level, from the newest log files, oldest first. The records
 * were redacted when they were written (lesson 95). A broken line is skipped (lesson 69).
 */
export function readRecentLogEntries(folder: string, query: RecentLogQuery): LogEntry[] {
  const levels: readonly string[] = query.minimumLevel === "error" ? ["error"] : ["warn", "error"];
  let names: string[];
  try {
    names = readdirSync(folder)
      .filter((name) => logFileName.test(name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const found: LogEntry[] = [];
  for (const name of names) {
    let lines: string[];
    try {
      lines = readFileSync(join(folder, name), "utf-8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines.reverse()) {
      const entry = parseLogLine(line);
      if (entry === null || !levels.includes(entry.level)) continue;
      found.push(entry);
      if (found.length >= query.limit) return found.reverse();
    }
  }
  return found.reverse();
}

function parseLogLine(line: string): LogEntry | null {
  if (line.trim().length === 0) return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null) return null;
  const { at, level, message, details } = record as Record<string, unknown>;
  if (typeof at !== "string" || typeof level !== "string" || typeof message !== "string") return null;
  if (!["debug", "info", "warn", "error"].includes(level)) return null;
  return { at, level: level as LogLevel, message, summary: summarizeDetails(details) };
}

/** `key: value` pairs, the first line of each value only, so a stack trace stays short. */
function summarizeDetails(details: unknown): string {
  if (typeof details !== "object" || details === null) return "";
  const parts = Object.entries(details).map(([key, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const firstLine = (text.split("\n")[0] ?? "").trim();
    return `${key}: ${firstLine.length > summaryValueLength ? `${firstLine.slice(0, summaryValueLength - 1)}…` : firstLine}`;
  });
  const summary = parts.join(", ");
  return summary.length > summaryLength ? `${summary.slice(0, summaryLength - 1)}…` : summary;
}

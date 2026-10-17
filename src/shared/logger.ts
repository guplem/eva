/**
 * Eva's log: one JSON line per record in `logs/eva-YYYY-MM-DD.jsonl`, kept for 14 days
 * (docs/plan.md §4.4). Every record is redacted first (lesson 95). Logging never throws.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
      // The log can hold chat text, so only the OS user may read it. Windows ignores the mode.
      mkdirSync(this.options.folder, { recursive: true, mode: 0o700 });
      appendFileSync(join(this.options.folder, `eva-${at.toISOString().slice(0, 10)}.jsonl`), `${line}\n`, {
        mode: 0o600,
      });
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

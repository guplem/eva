import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogger, readRecentLogEntries } from "../../../src/shared/logger.ts";
import { Redactor } from "../../../src/shared/redaction.ts";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-logs-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("FileLogger", () => {
  test("writes one redacted JSON line per record, in a file for the day (lesson 95)", () => {
    const redactor = new Redactor();
    redactor.addSecret("bot-token-secret-value");
    const logger = new FileLogger({ folder, redactor, now: () => new Date("2026-10-14T10:30:00Z") });
    logger.log("error", "Telegram failed", { url: "https://api.telegram.org/botbot-token-secret-value/getUpdates" });
    const lines = readFileSync(join(folder, "eva-2026-10-14.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      at: "2026-10-14T10:30:00.000Z",
      level: "error",
      message: "Telegram failed",
      details: { url: "https://api.telegram.org/bot[redacted]/getUpdates" },
    });
  });

  test("removes log files older than the retention period", () => {
    mkdirSync(folder, { recursive: true });
    const old = join(folder, "eva-2026-09-01.jsonl");
    const recent = join(folder, "eva-2026-10-10.jsonl");
    writeFileSync(old, "{}\n");
    writeFileSync(recent, "{}\n");
    const now = new Date("2026-10-14T10:30:00Z");
    utimesSync(old, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
    const logger = new FileLogger({ folder, redactor: new Redactor(), now: () => now, retentionDays: 14 });
    logger.removeOldFiles();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  test("a log that cannot be written never throws", () => {
    const logger = new FileLogger({
      folder: join(folder, "file-not-folder"),
      redactor: new Redactor(),
      now: () => new Date(),
    });
    writeFileSync(join(folder, "file-not-folder"), "x");
    expect(() => logger.log("info", "hello")).not.toThrow();
  });

  test("creates the log folder and files for the OS user only (plan §12)", () => {
    const logs = join(folder, "logs");
    const logger = new FileLogger({
      folder: logs,
      redactor: new Redactor(),
      now: () => new Date("2026-10-14T10:30:00Z"),
    });
    logger.log("info", "hello");
    expect(existsSync(join(logs, "eva-2026-10-14.jsonl"))).toBe(true);
    // Windows has no POSIX modes.
    if (process.platform === "win32") return;
    expect(statSync(logs).mode & 0o777).toBe(0o700);
    expect(statSync(join(logs, "eva-2026-10-14.jsonl")).mode & 0o777).toBe(0o600);
  });
});

describe("readRecentLogEntries", () => {
  function writeDay(day: string, records: readonly unknown[]): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `eva-${day}.jsonl`),
      records.map((record) => (typeof record === "string" ? record : JSON.stringify(record))).join("\n") + "\n",
    );
  }

  test("returns the newest warn and error records across the newest files, oldest first", () => {
    writeDay("2026-10-13", [
      { at: "2026-10-13T09:00:00.000Z", level: "error", message: "Old error." },
      { at: "2026-10-13T10:00:00.000Z", level: "warn", message: "Old warning." },
    ]);
    writeDay("2026-10-14", [
      { at: "2026-10-14T09:00:00.000Z", level: "info", message: "Eva started." },
      { at: "2026-10-14T10:00:00.000Z", level: "error", message: "New error." },
    ]);
    const entries = readRecentLogEntries(folder, { minimumLevel: "warn", limit: 2 });
    expect(entries.map((entry) => entry.message)).toEqual(["Old warning.", "New error."]);
  });

  test("the error level leaves the warnings out", () => {
    writeDay("2026-10-14", [
      { at: "2026-10-14T09:00:00.000Z", level: "warn", message: "A warning." },
      { at: "2026-10-14T10:00:00.000Z", level: "error", message: "An error." },
    ]);
    const entries = readRecentLogEntries(folder, { minimumLevel: "error", limit: 20 });
    expect(entries.map((entry) => entry.message)).toEqual(["An error."]);
  });

  test("skips a broken line and a file with another name (lesson 69)", () => {
    writeDay("2026-10-14", ["{not json", { at: "2026-10-14T10:00:00.000Z", level: "warn", message: "Kept." }]);
    writeFileSync(join(folder, "notes.jsonl"), JSON.stringify({ at: "x", level: "error", message: "Other." }));
    expect(readRecentLogEntries(folder, { minimumLevel: "warn", limit: 20 }).map((entry) => entry.message)).toEqual([
      "Kept.",
    ]);
  });

  test("sums up the details on one short line: the first line of each value", () => {
    writeDay("2026-10-14", [
      {
        at: "2026-10-14T10:00:00.000Z",
        level: "error",
        message: "A turn failed.",
        details: { reason: "Error: boom\n    at stack line", attempt: 2, long: "x".repeat(300) },
      },
    ]);
    const [entry] = readRecentLogEntries(folder, { minimumLevel: "warn", limit: 20 });
    expect(entry?.summary).toStartWith("reason: Error: boom, attempt: 2, long: xxx");
    expect(entry?.summary.length ?? 0).toBeLessThanOrEqual(160);
  });

  test("a missing folder gives no entries", () => {
    expect(readRecentLogEntries(join(folder, "missing"), { minimumLevel: "warn", limit: 20 })).toEqual([]);
  });
});

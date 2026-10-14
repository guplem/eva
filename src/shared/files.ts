/** File helpers for state files: atomic writes and reads that never crash (lesson 54). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Writes a file through a temporary file and a rename, so a reader never sees half a file. */
export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export type TolerantJsonResult = { ok: true; value: unknown } | { ok: false; reason: "missing" | "invalid" };

/** Reads and parses a JSON file. A missing or broken file is a result, never an exception. */
export function readJsonTolerant(path: string): TolerantJsonResult {
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf-8")) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

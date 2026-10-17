/**
 * The `state/running` marker: Eva writes it at start and removes it at a clean stop. A start
 * that finds it knows that the earlier run ended in a crash, a kill or a power loss.
 */
import { existsSync, rmSync } from "node:fs";
import { writeFileAtomic } from "../../shared/files.ts";

/** Writes the marker. Returns true when the marker of an earlier run was still there. */
export function startRunMarker(path: string, now: Date): boolean {
  const wasRunning = existsSync(path);
  writeFileAtomic(path, `${now.toISOString()}\n`);
  return wasRunning;
}

export function clearRunMarker(path: string): void {
  rmSync(path, { force: true });
}

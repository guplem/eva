/**
 * The `apply-seccomp` helper of the sandbox library (#759). On Linux, it applies the filter that
 * closes each Unix socket to a sandboxed command. The library finds it next to its own files, but
 * a single executable has no such files, so Eva carries it and gives its path in the wall file.
 *
 * Each release build carries only the helper of its own processor: Bun fixes `process.platform`
 * and `process.arch` for its target and drops the other branches. Without a helper, the library
 * runs each command with no socket filter, so Eva must always give one where the filter is on.
 */
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";

const helperName = "apply-seccomp";

/** The path of the helper that this build carries, or null on a system that needs none. */
export async function embeddedSeccompHelper(): Promise<string | null> {
  // One small module for each processor, so that each build loads only its own.
  if (process.platform === "linux" && process.arch === "x64") return (await import("./seccomp-x64.ts")).helperPath;
  if (process.platform === "linux" && process.arch === "arm64") return (await import("./seccomp-arm64.ts")).helperPath;
  return null;
}

/**
 * Copies the helper into a folder that the sandbox reads, as a program, and gives its path. The
 * sandbox runs it inside the box, so it must be a real file there. A copy that differs, such as
 * one that a shell with no wall planted, is replaced. Null when there is no helper or the copy fails.
 */
export function installSeccompHelper(source: string | null, folder: string): string | null {
  if (source === null) return null;
  const target = join(folder, helperName);
  try {
    const content = readFileSync(source);
    let current: Buffer | null = null;
    try {
      current = readFileSync(target);
    } catch {
      // No copy yet.
    }
    if (!current?.equals(content)) writeFileAtomic(target, content);
    chmodSync(target, 0o755);
    return target;
  } catch {
    return null;
  }
}

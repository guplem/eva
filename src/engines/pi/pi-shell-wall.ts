/**
 * The sandbox config of a pi Project chat's shell (#759), in the shape that the sandbox library
 * takes. Eva writes it to the turn's wall file, and `eva shell-sandbox` reads it for each command.
 * The walls are those of Claude Code's shell (#711): only the folders that each engine adds differ.
 */
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FileWall } from "../../shared/engine-port.ts";
import { shellWallSettings, type SandboxMachine } from "../../shared/shell-wall-settings.ts";

export function piShellWallConfig(
  wall: FileWall,
  environment: Readonly<Record<string, string>>,
  seccompFile: string | null,
  machine: SandboxMachine,
): Record<string, unknown> {
  const agentFolder = environment["PI_CODING_AGENT_DIR"];
  // pi puts its own rg and fd on the command's PATH. Its logins and every chat's history stay closed.
  const readable = [...wall.readable, ...(agentFolder === undefined ? [] : [join(agentFolder, "bin")])];
  // Without the helper, the library would run each command with no socket filter and say nothing.
  // So the socket folders close instead, as where a nested sandbox cannot start (#760).
  const socketFilter = wall.socketFilter && (seccompFile !== null || machine.platform === "darwin");
  const settings = shellWallSettings({ ...wall, readable, socketFilter }, machine);
  return {
    network: settings.network,
    // pi reads its settings and its extensions from `.pi`, and a shell command prefix there would run
    // before the wrap. A file tool may not write there either. The library itself protects the clone's
    // `.git/hooks` and `.git/config`.
    filesystem: { ...settings.filesystem, denyWrite: [join(wall.area, ".pi")] },
    ...(seccompFile === null ? {} : { seccomp: { applyPath: seccompFile } }),
  };
}

/**
 * The names in a command's folder that the library protects from writes (its `DANGEROUS_FILES`
 * and its folders of tool settings). Where one is absent, bubblewrap puts an empty placeholder
 * there while the command runs, and removes it after. pi stops a command hard, so a stopped
 * command leaves its placeholders in the chat's folder. Deepest first, so a folder empties first.
 */
const placeholderNames = [
  ".gitconfig",
  ".gitmodules",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".ripgreprc",
  ".mcp.json",
  // Eva's own: pi's settings folder (see piShellWallConfig).
  ".pi",
  ".vscode",
  ".idea",
  ".claude/commands",
  ".claude/agents",
  ".claude",
];

/** The placeholder names that are absent from the folder at the start of a turn. */
export function absentPlaceholders(folder: string): string[] {
  return placeholderNames.filter((name) => !existsSync(join(folder, name)));
}

/**
 * Removes each placeholder that a stopped command left: a name that was absent at the start of
 * the turn and is now an empty file or an empty folder. The shell cannot write these names in the
 * sandbox. A file tool can, but an empty file or folder holds nothing to lose. A file with
 * content, or a folder with a file, stays.
 */
export function removePlaceholders(folder: string, absent: readonly string[]): void {
  for (const name of absent) {
    const path = join(folder, name);
    try {
      const stats = lstatSync(path);
      if (stats.isFile() && stats.size === 0) rmSync(path);
      else if (stats.isDirectory() && readdirSync(path).length === 0) rmdirSync(path);
    } catch {
      // Absent, or busy: a placeholder that stays is a small mess, never a hole in the wall.
    }
  }
}

/**
 * The sandbox config of a pi Project chat's shell (#759), in the shape that the sandbox library
 * takes. Eva writes it to the turn's wall file, and `eva shell-sandbox` reads it for each command.
 * The walls are those of Claude Code's shell (#711): only the folders that each engine adds differ.
 */
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

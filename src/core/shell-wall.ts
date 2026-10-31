/**
 * Whether Claude Code's sandbox can wall the shell of a Project chat on this computer (#711). The
 * sandbox reports nothing to Eva when it cannot start, so Eva looks for what it needs. The file
 * tools of each chat stay walled either way: only the shell can then read the whole vault.
 */

/** Null when the sandbox can run here, else why not, in words for the person. */
export function shellWallGap(machine: {
  readonly platform: NodeJS.Platform;
  readonly which: (program: string) => string | null;
}): string | null {
  if (machine.platform === "darwin") return null;
  if (machine.platform === "win32")
    return "Claude Code has no shell sandbox that Eva can turn on for you on Windows yet.";
  if (machine.platform !== "linux") return `Claude Code has no shell sandbox on ${machine.platform}.`;
  const missing = [
    ...(machine.which("bwrap") === null ? ["bubblewrap"] : []),
    ...(machine.which("socat") === null ? ["socat"] : []),
  ];
  if (missing.length === 0) return null;
  return `Claude Code's shell sandbox needs ${missing.join(" and ")}. Install them, such as with \`sudo apt install bubblewrap socat\`, then restart Eva.`;
}

/**
 * The pi extension that runs each shell command of a pi Project chat in the sandbox (#759). pi
 * has no sandbox, so its bash tool could read the vault. Before each `bash` call, this extension
 * rewrites the command into a call of Eva's wrapper: `eva shell-sandbox <wall file> <command>`.
 *
 * pi sends `tool_execution_start` and saves the model's message before it runs this handler, from
 * a copy of the input. So the chat shows, and the model keeps, the command as the model wrote it.
 *
 * Eva loads it with `-e` right after her approval extension, so a call that the approval blocks
 * never gets here. A trusted clone's own extensions load after it and can change the command
 * again: the wall does not cover them, and Settings says so.
 *
 * The handler never throws, since pi takes a throw as a block with pi's own words. When it cannot
 * wrap a command, it blocks the call: the wall fails closed. With no wall in its variable, it
 * wraps nothing, because Eva's start check found no sandbox on this computer.
 *
 * pi loads this file as text with `-e` (see pi-shell-wrap-extension.ts), so it imports nothing.
 */

/** The variable that holds the wall. pi-shell-wrap-extension.ts holds the same name for Eva. */
export const shellWallVariable = "EVA_SHELL_WALL";

/** pi can load the extensions again in the same process, after the variable is gone. */
const wallSlot = Symbol.for("eva.shellWall");

/** What the model reads when a command cannot go in the sandbox. It names no path. */
const blocked = {
  block: true,
  reason: "Eva's shell sandbox could not start, so this command did not run.",
} as const;

export interface ShellWall {
  /** The command that runs Eva, such as `["eva"]` with its full path. */
  readonly command: readonly string[];
  /** The library's config for this turn, which the pi engine wrote. */
  readonly wallFile: string;
}

export interface ShellWrapEvent {
  readonly toolName: string;
  readonly toolCallId: string;
  /** pi runs the tool with this object, so a change to it changes the command that runs. */
  readonly input: Record<string, unknown>;
}

export interface ShellWrapPi {
  on(event: "tool_call", handler: (event: ShellWrapEvent) => unknown): void;
}

/** One word for a POSIX shell: in single quotes, where only a single quote needs care. */
function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The command line that runs `command` in the wrapper, with each part as one word. */
export function wrappedCommand(wall: ShellWall, command: string): string {
  return [...wall.command, "shell-sandbox", wall.wallFile, command].map(shellQuote).join(" ");
}

function parsedWall(text: string): ShellWall | null {
  try {
    const value = JSON.parse(text) as { command?: unknown; wallFile?: unknown } | null;
    const command = value?.command;
    const wallFile = value?.wallFile;
    if (!Array.isArray(command) || command.length === 0 || typeof wallFile !== "string") return null;
    if (!command.every((part): part is string => typeof part === "string")) return null;
    return { command, wallFile };
  } catch {
    return null;
  }
}

export default function evaShellWrap(pi: ShellWrapPi): void {
  const slots = globalThis as Record<symbol, string | undefined>;
  // Read once and deleted: pi's bash tool gives each command pi's environment.
  const text = process.env[shellWallVariable] ?? slots[wallSlot];
  Reflect.deleteProperty(process.env, shellWallVariable);
  if (text === undefined || text === "") return;
  slots[wallSlot] = text;
  const wall = parsedWall(text);
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined;
    try {
      const command = event.input["command"];
      if (wall === null || typeof command !== "string") return blocked;
      event.input["command"] = wrappedCommand(wall, command);
      return undefined;
    } catch {
      return blocked;
    }
  });
}

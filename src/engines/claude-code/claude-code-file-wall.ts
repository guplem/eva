/**
 * The file wall of a Claude Code Project chat (#711): a chat cannot open the vault, the other
 * project roots or Eva's own folder, but its own folder.
 * - The file tools: an SDK `PreToolUse` callback refuses a path in a closed folder. A hook's deny
 *   comes before the permission mode, so it holds under `bypassPermissions` too. Any other path
 *   gets no answer, so it keeps its mode's path. `disableAllHooks` does not turn off an SDK callback.
 * - The shell: Claude Code's sandbox closes the same folders for reads, and opens the chat's folder
 *   again. A sandboxed command writes only to the chat's folder and the temporary folder.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import type { FileWall } from "../../shared/engine-port.ts";
import { wallRefusal, type WallFolders, type WallRefusal } from "../../shared/path-area.ts";
import { shellWallSettings, type SandboxMachine } from "../../shared/shell-wall-settings.ts";

/** What the agent reads when Eva refuses a path. It names no vault: the chat must not know of one. */
export const outsideMessage = "This path is outside this chat's folder.";

/** What the agent reads when it searches a whole read-only folder that holds a closed one (#774). */
export const searchMessage =
  "This search holds the project's clones. Search a sub-folder of the project, or list the notes with the shell.";

/** The fields that hold a file pattern, by tool. A `..` or an absolute start could lead out. */
const patternKeys: Readonly<Record<string, readonly string[]>> = { Glob: ["pattern"], Grep: ["glob"] };

/** The tools that write a file. A write to the folder's own settings could run code at the next turn. */
const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** The tools that only read. Only they open a read-only folder, so an MCP tool cannot write there (#774). */
const readTools = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);

/** The tools that list one level of a folder. Glob is a search: it runs `rg --files`, which goes to any depth. */
const listTools = new Set(["LS"]);

/** Why the wall refuses a tool call, or null when it does not. */
function refusalOf(wall: WallFolders, cwd: string, toolName: string, input: unknown): WallRefusal | null {
  return wallRefusal(wall, cwd, input, {
    patternKeys: patternKeys[toolName] ?? [],
    write: writeTools.has(toolName),
    reads: readTools.has(toolName),
    lists: listTools.has(toolName),
    dropsAt: false,
  });
}

/** Claude Code names a folder by its path, with each other character as `-`. A longer name ends with a hash. */
const longName = 200;

/**
 * Claude Code's own folder for the chat, in its config folder: a large tool output and the auto
 * memory live there, and the agent reads them back with the file tools. The folders of the other
 * chats stay closed: an Assistant chat's history holds vault text.
 */
export function chatDataFolders(configFolder: string | null, startFolder: string): string[] {
  if (configFolder === null) return [];
  const projects = join(configFolder, "projects");
  const name = startFolder.replace(/[^a-zA-Z0-9]/g, "-");
  if (name.length <= longName) return [join(projects, name)];
  const start = `${name.slice(0, longName)}-`;
  try {
    return readdirSync(projects)
      .filter((each) => each.startsWith(start))
      .map((each) => join(projects, each));
  } catch {
    return [];
  }
}

/**
 * The parts of Claude Code's config folder that its shell needs: the shell setup, the skills and
 * the plugins. Its login and the history of every chat stay closed.
 */
export function claudeShellFolders(configFolder: string | null): string[] {
  if (configFolder === null) return [];
  return ["shell-snapshots", "session-env", "skills", "plugins"].map((name) => join(configFolder, name));
}

export function fileWallHooks(
  wall: FileWall,
  startFolder: string,
  configFolder: string | null,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [
          (input) => {
            // A relative path starts where the tool runs, which the hook input names.
            const cwd = input.cwd || startFolder;
            const open = chatDataFolders(configFolder, startFolder);
            if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
            const refusal = refusalOf({ ...wall, open }, cwd, input.tool_name, input.tool_input);
            if (refusal === null) return Promise.resolve({});
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: refusal === "search" ? searchMessage : outsideMessage,
              },
            });
          },
        ],
      },
    ],
  };
}

/** The sandbox of the chat's shell, in the shape of the `settings` option. */
export function fileWallSandbox(
  wall: FileWall,
  machine: SandboxMachine = { runtimeFolder: null, platform: process.platform },
): Record<string, unknown> {
  return {
    enabled: true,
    // A machine with no sandbox runs the turn on. Eva's status says that its shell has no wall.
    failIfUnavailable: false,
    // A command must not ask to run outside the sandbox.
    allowUnsandboxedCommands: false,
    // Each Bash call keeps the approval of its permission mode, as before the wall.
    autoAllowBashIfSandboxed: false,
    ...shellWallSettings(wall, machine),
  };
}

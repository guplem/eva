/**
 * The file wall of a Claude Code Project chat (#711): a chat reads and writes only its own folder.
 * - The file tools: an SDK `PreToolUse` callback refuses a path outside the folder. A hook's deny
 *   comes before the permission mode, so it holds under `bypassPermissions` too. A path inside gets
 *   no answer, so it keeps its mode's path. `disableAllHooks` does not turn off an SDK callback.
 * - The shell: Claude Code's sandbox closes the vault and each extra project root for reads, and
 *   opens the chat's folder again. A sandboxed command writes only to its start folder and the
 *   paths of `allowWrite`.
 */
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import type { FileWall } from "../../shared/engine-port.ts";
import { isInsideArea, isPatternInsideArea } from "../../shared/path-area.ts";

/** What the agent reads when Eva refuses a path. It names no vault: the chat must not know of one. */
export const outsideMessage = "This path is outside this chat's folder.";

/**
 * The folders of the home folder where tools keep their caches, such as npm and pip. The whole home
 * folder stays closed for writes: the default vault lives in it, and a deny inside an allow wins.
 */
const toolCaches = [".cache", ".npm", ".bun", ".cargo", ".gradle", ".m2", ".pnpm-store", ".yarn", "go"];

/**
 * The hosts of git and of the package managers. The wall closes files, never the network, but the
 * sandbox asks about each host that no rule names: in auto mode, Claude Code's classifier answers.
 */
const developmentHosts = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "*.crates.io",
  "proxy.golang.org",
  "repo.maven.apache.org",
];

/** The tools whose arguments name a file or a folder, and the fields that name it. */
const pathFields: Readonly<Record<string, readonly string[]>> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  // Grep also takes `file_path`, which it reads as `path`.
  Grep: ["path", "file_path"],
};

/** The fields that hold a file pattern, which a `..` or an absolute start could lead out. */
const patternFields: Readonly<Record<string, readonly string[]>> = { Glob: ["pattern"], Grep: ["glob"] };

/** True when a file tool call names a path or a pattern outside the chat's folder. */
export function isOutsideWall(wall: FileWall, startFolder: string, toolName: string, input: unknown): boolean {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const named = (keys: readonly string[] | undefined): string[] =>
    (keys ?? [])
      .map((key) => fields[key])
      .filter((value): value is string => typeof value === "string" && value !== "");
  return (
    named(pathFields[toolName]).some((path) => !isInsideArea(wall.area, path, startFolder)) ||
    named(patternFields[toolName]).some((pattern) => !isPatternInsideArea(wall.area, pattern, startFolder))
  );
}

export function fileWallHooks(wall: FileWall, startFolder: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [
          (input) => {
            if (
              input.hook_event_name !== "PreToolUse" ||
              !isOutsideWall(wall, startFolder, input.tool_name, input.tool_input)
            )
              return Promise.resolve({});
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: outsideMessage,
              },
            });
          },
        ],
      },
    ],
  };
}

/** The sandbox of the chat's shell, in the shape of the `settings` option. */
export function fileWallSandbox(wall: FileWall): Record<string, unknown> {
  return {
    enabled: true,
    // A machine with no sandbox runs the turn on. Eva's status says that its shell has no wall.
    failIfUnavailable: false,
    // A command must not ask to run outside the sandbox.
    allowUnsandboxedCommands: false,
    // Each Bash call keeps the approval of its permission mode, as before the wall.
    autoAllowBashIfSandboxed: false,
    network: { allowedDomains: [...developmentHosts] },
    filesystem: {
      denyRead: [...wall.closed],
      allowRead: [wall.area],
      allowWrite: [wall.area, tmpdir(), ...toolCaches.map((cache) => join(homedir(), cache))],
    },
  };
}

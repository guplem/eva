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
import { wallRefusesCall } from "../../shared/path-area.ts";

/** What the agent reads when Eva refuses a path. It names no vault: the chat must not know of one. */
export const outsideMessage = "This path is outside this chat's folder.";

/**
 * The caches in the home folder where tools such as npm, pip and cargo keep downloads. Only the
 * caches: a `bin` folder beside one, such as `~/.cargo/bin`, holds programs that run outside the
 * sandbox later. The whole home folder stays closed for writes: the default vault lives in it.
 */
const toolCaches = [
  ".cache/pip",
  ".cache/uv",
  ".cache/yarn",
  ".cache/go-build",
  ".cache/node-gyp",
  ".npm/_cacache",
  ".bun/install/cache",
  ".cargo/registry",
  ".cargo/git",
  "go/pkg/mod",
  ".gradle/caches",
  ".m2/repository",
  ".pnpm-store",
];

/** The names of this computer and of the tailnet, where Eva's own API listens. */
const evaHosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "*.ts.net"];

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

/** The fields that hold a file pattern, by tool. A `..` or an absolute start could lead out. */
const patternKeys: Readonly<Record<string, readonly string[]>> = { Glob: ["pattern"], Grep: ["glob"] };

/** The tools that write a file. A write to the folder's own settings could run code at the next turn. */
const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** True when a tool call names a path or a pattern that the wall closes. */
export function isOutsideWall(wall: FileWall, cwd: string, toolName: string, input: unknown): boolean {
  return wallRefusesCall(wall, cwd, input, {
    patternKeys: patternKeys[toolName] ?? [],
    write: writeTools.has(toolName),
  });
}

export function fileWallHooks(wall: FileWall, startFolder: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [
          (input) => {
            if (
              input.hook_event_name !== "PreToolUse" ||
              // A relative path starts where the tool runs, which the hook input names.
              !isOutsideWall(wall, input.cwd || startFolder, input.tool_name, input.tool_input)
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
    // Eva's own API listens on this computer and on the tailnet: a command must reach neither.
    network: { allowedDomains: [...developmentHosts], deniedDomains: [...evaHosts] },
    filesystem: {
      denyRead: [...wall.closed],
      // The chat's folder, and the git login that a push needs, though the instance folder is closed.
      allowRead: [wall.area, ...wall.readable],
      allowWrite: [wall.area, tmpdir(), ...toolCaches.map((cache) => join(homedir(), cache))],
    },
  };
}

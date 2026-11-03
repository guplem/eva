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
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import type { FileWall } from "../../shared/engine-port.ts";
import { isInside, wallRefusal, type WallFolders, type WallRefusal } from "../../shared/path-area.ts";

/** What the agent reads when Eva refuses a path. It names no vault: the chat must not know of one. */
export const outsideMessage = "This path is outside this chat's folder.";

/** What the agent reads when it searches a whole read-only folder that holds a closed one (#774). */
export const searchMessage =
  "This search holds the project's clones. Search a sub-folder of the project, or list the notes with the shell.";

/**
 * The cache folders of the package tools, moved to the temporary folder. A sandboxed command may
 * not write to the home folder, and a build outside the sandbox reuses a home cache with no check:
 * a planted package there would run later with every right. npm checks each package of its cache.
 */
export function toolCacheVariables(): Record<string, string> {
  const folder = join(tmpdir(), "eva-tool-caches");
  return {
    PIP_CACHE_DIR: join(folder, "pip"),
    UV_CACHE_DIR: join(folder, "uv"),
    YARN_CACHE_FOLDER: join(folder, "yarn"),
    npm_config_store_dir: join(folder, "pnpm"),
    BUN_INSTALL_CACHE_DIR: join(folder, "bun"),
    GOCACHE: join(folder, "go-build"),
    GOMODCACHE: join(folder, "go-mod"),
  };
}

/** The names of this computer and of the tailnet, where Eva's own API listens. */
const evaHosts = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "*.ts.net"];

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

/**
 * The places of the Unix sockets through which a command could run code outside the box, such as
 * systemd's, Docker's, podman's, tmux's, X11's or Tailscale's. With no socket filter (#760), Eva
 * closes them instead. All of `/run` closes: a root Eva reaches each root socket there. A list
 * can miss a socket, so the guide calls the wall weaker there.
 */
const socketPlaces = ["/run", "/var/run", "/var/snap/lxd", "/tmp/.X11-unix"];

/** Docker Desktop, Rancher Desktop, Colima and Lima keep their sockets in the home folder. */
const homeSocketPlaces = [".docker", ".rd", ".colima", ".lima"];

/** The name server file of many systems links into `/run`, so it stays readable when `/run` closes. */
const nameServerPlaces = ["/run/systemd/resolve", "/run/resolvconf"];

/** The user's own sockets: systemd, rootless Docker and podman, gpg, tmux. */
function userSocketPlaces(runtimeFolder: string | null): string[] {
  const uid = process.getuid?.();
  const ownRuntime = uid === undefined ? [] : [`/run/user/${String(uid)}`, `/tmp/tmux-${String(uid)}`];
  return [...new Set([...(runtimeFolder === null ? [] : [runtimeFolder]), ...ownRuntime])];
}

/** What the sandbox needs to know of the machine. */
export interface SandboxMachine {
  /** The user's runtime folder, where systemd and others keep their sockets. */
  readonly runtimeFolder: string | null;
  readonly platform: NodeJS.Platform;
}

/**
 * A closed folder as the sandbox's `denyRead` names it. On macOS, the last rule that matches wins,
 * and the sandbox adds a literal deny again after the allows. So a closed folder inside a read-only
 * one, such as `repos/`, would close the chat's own clone there. Its glob form keeps the clone open
 * (#774): the sandbox bundled in Claude Code turns a `denyRead` glob into its matches and spares
 * each path that `allowRead` names. The review of #774 read that code. The globs take no escape that Eva can count on, so each glob character becomes `?`, as in
 * `hiddenInstructionPatterns`: it also matches a sibling with a similar name, which only closes more.
 */
function deniedFolder(wall: FileWall, folder: string, platform: NodeJS.Platform): string {
  const nested = (wall.readOnly ?? []).some((readOnly) => readOnly !== folder && isInside(readOnly, folder));
  if (!nested || platform !== "darwin") return folder;
  return `${folder.replace(/[*?[\]{}()!+@]/g, "?")}/**`;
}

/** The sandbox of the chat's shell, in the shape of the `settings` option. */
export function fileWallSandbox(
  wall: FileWall,
  machine: SandboxMachine = { runtimeFolder: null, platform: process.platform },
): Record<string, unknown> {
  // macOS filters sockets with no nested sandbox, so only Linux may need the filter off (#760).
  const noFilter = !wall.socketFilter && machine.platform !== "darwin";
  const socketFolders = noFilter
    ? [
        ...userSocketPlaces(machine.runtimeFolder),
        ...socketPlaces,
        ...homeSocketPlaces.map((name) => join(homedir(), name)),
      ]
    : [];
  return {
    enabled: true,
    // A machine with no sandbox runs the turn on. Eva's status says that its shell has no wall.
    failIfUnavailable: false,
    // A command must not ask to run outside the sandbox.
    allowUnsandboxedCommands: false,
    // Each Bash call keeps the approval of its permission mode, as before the wall.
    autoAllowBashIfSandboxed: false,
    network: {
      allowedDomains: [...developmentHosts],
      // Eva's own API listens on this computer and on the tailnet: a command must reach neither.
      deniedDomains: [...evaHosts],
      // A dev server or a test server of the clone listens on this computer. macOS asks for this.
      allowLocalBinding: true,
      // The socket filter starts a sandbox inside the sandbox. Where the system blocks that, the
      // filter would break every command, so it stays off and the socket folders close (#760).
      ...(noFilter ? { allowAllUnixSockets: true } : {}),
    },
    filesystem: {
      denyRead: [...wall.closed.map((folder) => deniedFolder(wall, folder, machine.platform)), ...socketFolders],
      // The chat's folder, its read-only folders, and the parts of Eva's folder that its git and its shell need.
      allowRead: [wall.area, ...(wall.readOnly ?? []), ...wall.readable, ...(noFilter ? nameServerPlaces : [])],
      // npm checks each package of its cache. The other tools use the temporary folder.
      allowWrite: [wall.area, tmpdir(), join(homedir(), ".npm", "_cacache")],
    },
  };
}

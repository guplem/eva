/**
 * The shell wall of a Project chat (#711), in the shape that the sandbox library takes: the
 * network and the folders. Claude Code bundles this library in its own sandbox. Each engine adds
 * the options of its own sandbox. The sandbox closes the vault, the other project roots and Eva's
 * own folder for reads, and opens the chat's folder again. A sandboxed command writes only to the
 * chat's folder and the temporary folder.
 */
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { FileWall } from "./engine-port.ts";
import { isInside } from "./path-area.ts";

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
 * (#774): the sandbox library turns a `denyRead` glob into its matches and spares each path that
 * `allowRead` names. The review of #774 read that code. The globs take no escape that Eva can
 * count on, so each glob character becomes `?`, as in `hiddenInstructionPatterns`: it also matches
 * a sibling with a similar name, which only closes more.
 */
function deniedFolder(wall: FileWall, folder: string, platform: NodeJS.Platform): string {
  const nested = (wall.readOnly ?? []).some((readOnly) => readOnly !== folder && isInside(readOnly, folder));
  if (!nested || platform !== "darwin") return folder;
  return `${folder.replace(/[*?[\]{}()!+@]/g, "?")}/**`;
}

export interface ShellWallSettings {
  readonly network: {
    readonly allowedDomains: string[];
    readonly deniedDomains: string[];
    readonly allowLocalBinding: boolean;
    readonly allowAllUnixSockets?: boolean;
  };
  readonly filesystem: {
    readonly denyRead: string[];
    readonly allowRead: string[];
    readonly allowWrite: string[];
  };
}

/** The network and the folders of a Project chat's shell. */
export function shellWallSettings(wall: FileWall, machine: SandboxMachine): ShellWallSettings {
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

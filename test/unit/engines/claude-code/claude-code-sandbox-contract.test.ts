/**
 * Pins the sandbox of a Claude Code Project chat and its package cache variables, byte for byte,
 * from the core's wall roots to the `settings` and `env` options (#759). The wall settings move
 * between the core, `src/shared/` and the adapter, and none of these moves may change what Claude
 * Code gets.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { engineEnvironment, projectWallRoots } from "../../../../src/core/instance/child-environments.ts";
import { userspaceFolders } from "../../../../src/core/remote-access/tailscale.ts";
import { engineFolders, homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { buildQueryOptions } from "../../../../src/engines/claude-code/claude-code-adapter.ts";
import type { FileWall, TurnRequest } from "../../../../src/shared/engine-port.ts";
import { defaultOutwardActionLevels } from "../../../../src/shared/outward-actions.ts";

let home: string;
let paths: HomePaths;
let vault: string;
let project: string;
let clone: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-sandbox-contract-"));
  paths = homePaths(join(home, "eva"));
  vault = join(home, "vault");
  project = join(vault, "Projects", "2025-03-02-1015-example-app");
  clone = join(project, "repos", "clone-0");
  mkdirSync(clone, { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** The wall of a clone chat, as `ProjectPreparer` builds it. */
function cloneWall(socketFilter: boolean): FileWall {
  const roots = projectWallRoots(paths, vault, ["/srv/projects"]);
  return {
    area: clone,
    ...roots,
    socketFilter,
    closed: [...roots.closed, join(project, "repos")],
    readOnly: [project],
  };
}

function sandboxOf(fileWall: FileWall): unknown {
  return (optionsOf(fileWall).settings as { sandbox: unknown }).sandbox;
}

function optionsOf(fileWall: FileWall): Options {
  const environment = engineEnvironment({ paths, processEnvironment: { PATH: "/usr/bin" }, evaCommand: ["eva"] }, {});
  const request: TurnRequest = {
    mode: "project",
    history: { kind: "new", engineSessionId: "session-1" },
    startFolder: clone,
    projectFolder: project,
    prompt: "Hello",
    model: "opus",
    effort: null,
    appendSystemPrompt: null,
    pluginFolders: [],
    mcpServers: {},
    trusted: true,
    harnessMemory: true,
    folderHooks: true,
    fileWall,
    environment,
    requestApproval: () => Promise.resolve("allow"),
    outwardActionLevels: () => defaultOutwardActionLevels,
    askQuestions: () => Promise.resolve("declined"),
    signal: new AbortController().signal,
  };
  return buildQueryOptions(request, "/bin/claude", "auto");
}

/** Every list is written out here, so a move of a constant cannot change both sides at once. */
function expectedSandbox(socketFilter: boolean): unknown {
  const folders = engineFolders(paths);
  const noFilter = !socketFilter && process.platform !== "darwin";
  const uid = process.getuid?.();
  const socketFolders = noFilter
    ? [
        ...(uid === undefined ? [] : [`/run/user/${String(uid)}`, `/tmp/tmux-${String(uid)}`]),
        "/run",
        "/var/run",
        "/var/snap/lxd",
        "/tmp/.X11-unix",
        ...[".docker", ".rd", ".colima", ".lima"].map((name) => join(homedir(), name)),
      ]
    : [];
  // On macOS, `repos/` sits inside the read-only project folder, so it closes as a glob (#774).
  const repos = process.platform === "darwin" ? `${join(project, "repos")}/**` : join(project, "repos");
  return {
    enabled: true,
    failIfUnavailable: false,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    network: {
      allowedDomains: [
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
      ],
      deniedDomains: ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "*.ts.net"],
      allowLocalBinding: true,
      ...(noFilter ? { allowAllUnixSockets: true } : {}),
    },
    filesystem: {
      denyRead: [vault, "/srv/projects", paths.root, userspaceFolders(homedir()).state, repos, ...socketFolders],
      allowRead: [
        clone,
        project,
        folders.git,
        folders.gh,
        join(paths.root, "bin"),
        join(folders.claude, "shell-snapshots"),
        join(folders.claude, "session-env"),
        join(folders.claude, "skills"),
        join(folders.claude, "plugins"),
        ...(noFilter ? ["/run/systemd/resolve", "/run/resolvconf"] : []),
      ],
      allowWrite: [clone, tmpdir(), join(homedir(), ".npm", "_cacache")],
    },
  };
}

describe("the sandbox of a Claude Code Project chat stays the same (#759)", () => {
  test("with the socket filter", () => {
    expect(JSON.stringify(sandboxOf(cloneWall(true)))).toBe(JSON.stringify(expectedSandbox(true)));
  });

  test("without the socket filter (#760)", () => {
    expect(JSON.stringify(sandboxOf(cloneWall(false)))).toBe(JSON.stringify(expectedSandbox(false)));
  });

  test("the package caches move to the temporary folder", () => {
    const folder = join(tmpdir(), "eva-tool-caches");
    expect(optionsOf(cloneWall(true)).env).toMatchObject({
      PIP_CACHE_DIR: join(folder, "pip"),
      UV_CACHE_DIR: join(folder, "uv"),
      YARN_CACHE_FOLDER: join(folder, "yarn"),
      npm_config_store_dir: join(folder, "pnpm"),
      BUN_INSTALL_CACHE_DIR: join(folder, "bun"),
      GOCACHE: join(folder, "go-build"),
      GOMODCACHE: join(folder, "go-mod"),
    });
  });
});

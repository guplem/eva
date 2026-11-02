import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { buildQueryOptions } from "../../../../src/engines/claude-code/claude-code-adapter.ts";
import { chatDataFolders, fileWallSandbox } from "../../../../src/engines/claude-code/claude-code-file-wall.ts";
import type { ApprovalAnswer, QuestionsOutcome, TurnRequest } from "../../../../src/shared/engine-port.ts";

let vault: string;
let clone: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-wall-"));
  clone = join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "clone-0");
  mkdirSync(join(clone, "src"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Map\n");
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function projectRequest(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    mode: "project",
    history: { kind: "new", engineSessionId: "session-1" },
    startFolder: clone,
    projectFolder: join(vault, "Projects", "2025-03-02-1015-example-app"),
    prompt: "Hello",
    model: "opus",
    effort: null,
    appendSystemPrompt: null,
    pluginFolders: [],
    mcpServers: {},
    trusted: true,
    harnessMemory: true,
    folderHooks: true,
    fileWall: { area: clone, closed: [vault, "/srv/projects"], readable: [join(vault, "gh")], socketFilter: true },
    environment: { PATH: "/bin" },
    requestApproval: () => Promise.resolve<ApprovalAnswer>("allow"),
    askQuestions: () => Promise.resolve<QuestionsOutcome>("declined"),
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** The one PreToolUse callback that Eva adds for the wall. */
function wallHook(options: Options): HookCallback {
  const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
  if (hook === undefined) throw new Error("No PreToolUse hook.");
  return hook;
}

async function decide(options: Options, tool: string, input: Record<string, unknown>): Promise<unknown> {
  const answer = await wallHook(options)(
    {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
      tool_use_id: "t1",
    } as Parameters<HookCallback>[0],
    "t1",
    { signal: new AbortController().signal },
  );
  return (answer as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
}

describe("the file wall of a Claude Code Project chat (#711)", () => {
  test("the shell runs in the sandbox: the vault and each root closed for reads, the chat's folder open", () => {
    const options = buildQueryOptions(projectRequest(), "/bin/claude", "auto");
    expect(options.settings).toMatchObject({
      sandbox: {
        enabled: true,
        // A machine with no sandbox runs the turn on, and Eva's status says so.
        failIfUnavailable: false,
        allowUnsandboxedCommands: false,
        // A Bash call still asks the person, as before the wall.
        autoAllowBashIfSandboxed: false,
        filesystem: {
          denyRead: [vault, "/srv/projects"],
          // The git login that a push needs stays readable, though the instance folder is closed.
          allowRead: [clone, join(vault, "gh")],
        },
      },
    });
    const writes = (options.settings as { sandbox: { filesystem: { allowWrite: string[] } } }).sandbox.filesystem
      .allowWrite;
    expect(writes).toContain(clone);
    expect(writes).toContain(tmpdir());
    // npm checks each package of its cache. A build outside the sandbox reuses the other caches with no check.
    expect(writes).toEqual([clone, tmpdir(), join(homedir(), ".npm", "_cacache")]);
    expect(options.env).toMatchObject({ UV_CACHE_DIR: join(tmpdir(), "eva-tool-caches", "uv") });
    expect(options.settings).toMatchObject({ sandbox: { network: { allowLocalBinding: true } } });
    // In auto mode, a host that no rule names goes to Claude Code's classifier: the common ones are named.
    const hosts = (options.settings as { sandbox: { network: { allowedDomains: string[] } } }).sandbox.network
      .allowedDomains;
    expect(hosts).toContain("github.com");
    expect(hosts).toContain("registry.npmjs.org");
    expect(hosts).toContain("pypi.org");
    // Eva's own API listens on this computer and on the tailnet.
    const denied = (options.settings as { sandbox: { network: { deniedDomains: string[] } } }).sandbox.network
      .deniedDomains;
    for (const host of ["localhost", "127.0.0.1", "*.ts.net"]) expect(denied).toContain(host);
    // The sandbox refuses its whole config for one bad host. An IPv6 address needs brackets, such as `[::1]`.
    for (const host of [...hosts, ...denied])
      expect(host).toMatch(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$|^\[[0-9a-f:]+\]$/);
  });

  test("a file tool outside the chat's folder is refused in every mode, and one inside keeps its mode's path", async () => {
    for (const mode of ["bypassPermissions", "auto"] as const) {
      const options = buildQueryOptions(projectRequest(), "/bin/claude", mode);
      expect(await decide(options, "Read", { file_path: join(vault, "AGENTS.md") })).toBe("deny");
      expect(await decide(options, "Read", { file_path: "../../../../AGENTS.md" })).toBe("deny");
      expect(await decide(options, "Write", { file_path: join(clone, "src", "new.ts") })).toBeUndefined();
      expect(await decide(options, "Edit", { file_path: "src/a.ts" })).toBeUndefined();
      expect(await decide(options, "NotebookEdit", { notebook_path: join(vault, "n.ipynb") })).toBe("deny");
      expect(await decide(options, "Glob", { pattern: "**/*.md", path: vault })).toBe("deny");
      expect(await decide(options, "Glob", { pattern: join(vault, "*.md") })).toBe("deny");
      expect(await decide(options, "Glob", { pattern: "src/**/*.ts" })).toBeUndefined();
      expect(await decide(options, "Grep", { pattern: "x", path: vault })).toBe("deny");
      expect(await decide(options, "Grep", { pattern: "x", file_path: join(vault, "AGENTS.md") })).toBe("deny");
      expect(await decide(options, "Grep", { pattern: "x", glob: "../**" })).toBe("deny");
      expect(await decide(options, "Grep", { pattern: "x" })).toBeUndefined();
      // A shell command is the sandbox's, and any other tool keeps its path.
      expect(await decide(options, "Bash", { command: "cat ../../../../AGENTS.md" })).toBeUndefined();
    }
  });

  test("a specialist chat, which turns off the hooks of its settings, keeps Eva's own wall", () => {
    const folder = join(vault, "Projects", "2025-03-02-1015-coach");
    const options = buildQueryOptions(
      projectRequest({
        startFolder: folder,
        projectFolder: folder,
        folderHooks: false,
        fileWall: { area: folder, closed: [vault], readable: [], socketFilter: true },
      }),
      "/bin/claude",
      "auto",
    );
    expect(options.settings).toMatchObject({ disableAllHooks: true, sandbox: { enabled: true } });
    expect(options.hooks?.PreToolUse).toHaveLength(1);
  });

  test("an untrusted clone keeps the wall too", () => {
    const options = buildQueryOptions(projectRequest({ trusted: false }), "/bin/claude", "auto");
    expect(options.settings).toMatchObject({ sandbox: { enabled: true } });
    expect(options.hooks?.PreToolUse).toHaveLength(1);
  });

  test("an Assistant chat has no wall", () => {
    const options = buildQueryOptions(
      projectRequest({ mode: "assistant", projectFolder: null, fileWall: null, appendSystemPrompt: "Eva." }),
      "/bin/claude",
      "auto",
    );
    expect(options.hooks).toBeUndefined();
    expect((options.settings as { sandbox?: unknown }).sandbox).toBeUndefined();
  });
});

describe("the file wall, after the review of #711", () => {
  test("a file write that could run code at the next turn is refused, and a read of the same file is not", async () => {
    const options = buildQueryOptions(projectRequest(), "/bin/claude", "bypassPermissions");
    expect(await decide(options, "Write", { file_path: ".claude/settings.local.json" })).toBe("deny");
    expect(await decide(options, "Edit", { file_path: join(clone, ".mcp.json") })).toBe("deny");
    expect(await decide(options, "Write", { file_path: "example-app/.git/hooks/pre-commit" })).toBe("deny");
    expect(await decide(options, "Read", { file_path: ".claude/settings.local.json" })).toBeUndefined();
  });

  test("any tool with a path field is walled, and a relative path starts at the tool's own folder", async () => {
    const options = buildQueryOptions(projectRequest(), "/bin/claude", "auto");
    expect(await decide(options, "mcp__files__read", { path: join(vault, "AGENTS.md") })).toBe("deny");
    expect(await decide(options, "mcp__files__read", { paths: ["src", join(vault, "AGENTS.md")] })).toBe("deny");
    expect(await decide(options, "Read", { file_path: "~other/notes.md" })).toBe("deny");
    const answer = await wallHook(options)(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "AGENTS.md" },
        tool_use_id: "t1",
        cwd: vault,
      } as Parameters<HookCallback>[0],
      "t1",
      { signal: new AbortController().signal },
    );
    expect(answer).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  test("the other files of the machine stay open to the file tools", async () => {
    const other = mkdtempSync(join(tmpdir(), "eva-elsewhere-"));
    try {
      const options = buildQueryOptions(projectRequest(), "/bin/claude", "auto");
      expect(await decide(options, "Read", { file_path: join(other, "x.log") })).toBeUndefined();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("Claude Code's own folder for the chat (review of #711)", () => {
  test("the file tools read back the chat's large outputs and memory, and no other chat's history", async () => {
    const config = join(vault, "engines", "claude");
    const own = join(config, "projects", clone.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(join(own, "memory"), { recursive: true });
    mkdirSync(join(config, "projects", "-assistant"), { recursive: true });
    const options = buildQueryOptions(
      projectRequest({ environment: { PATH: "/bin", CLAUDE_CONFIG_DIR: config } }),
      "/bin/claude",
      "auto",
    );
    expect(await decide(options, "Read", { file_path: join(own, "s1", "tool-results", "out.txt") })).toBeUndefined();
    expect(await decide(options, "Write", { file_path: join(own, "memory", "MEMORY.md") })).toBeUndefined();
    expect(await decide(options, "Read", { file_path: join(config, "projects", "-assistant", "s.jsonl") })).toBe(
      "deny",
    );
    expect(await decide(options, "Read", { file_path: join(config, ".credentials.json") })).toBe("deny");
  });

  test("a long start folder matches Claude Code's shortened name, which ends with a hash", () => {
    const config = join(vault, "engines", "claude");
    const start = join(vault, "x".repeat(250));
    const name = start.replace(/[^a-zA-Z0-9]/g, "-");
    const shortened = join(config, "projects", `${name.slice(0, 200)}-abc123`);
    mkdirSync(shortened, { recursive: true });
    expect(chatDataFolders(config, start)).toEqual([shortened]);
    expect(chatDataFolders(join(vault, "none"), start)).toEqual([]);
    expect(chatDataFolders(null, clone)).toEqual([]);
  });
});

describe("the socket filter (#760)", () => {
  const sockets = (request: TurnRequest): unknown =>
    (buildQueryOptions(request, "/bin/claude", "auto").settings as { sandbox: { network: Record<string, unknown> } })
      .sandbox.network["allowAllUnixSockets"];

  test("a machine that blocks a nested sandbox gets no socket filter, so each command still runs", () => {
    const wall = { area: clone, closed: [vault], readable: [], socketFilter: false };
    expect(sockets(projectRequest({ fileWall: wall }))).toBe(true);
    // With no filter, a socket of the user, such as systemd's, could run a command outside the box.
    const request = projectRequest({
      fileWall: wall,
      environment: { PATH: "/bin", XDG_RUNTIME_DIR: "/run/user/1000" },
    });
    const denied = (
      buildQueryOptions(request, "/bin/claude", "auto").settings as { sandbox: { filesystem: { denyRead: string[] } } }
    ).sandbox.filesystem.denyRead;
    // As root, a command could reach any socket under /run, such as systemd's, so all of it closes.
    for (const folder of ["/run/user/1000", "/run", "/var/run", "/tmp/.X11-unix", join(homedir(), ".docker")])
      expect(denied).toContain(folder);
    expect(denied).toContain(vault);
    // The name server file of many systems lives under /run.
    const readable = (
      buildQueryOptions(request, "/bin/claude", "auto").settings as { sandbox: { filesystem: { allowRead: string[] } } }
    ).sandbox.filesystem.allowRead;
    expect(readable).toContain("/run/systemd/resolve");
  });

  test("macOS keeps its socket filter, which needs no nested sandbox", () => {
    const wall = { area: clone, closed: [vault], readable: [], socketFilter: false };
    const network = (
      fileWallSandbox(wall, { runtimeFolder: null, platform: "darwin" }) as { network: Record<string, unknown> }
    ).network;
    expect(network["allowAllUnixSockets"]).toBeUndefined();
  });

  test("another machine keeps the filter", () => {
    expect(sockets(projectRequest())).toBeUndefined();
    const denied = (
      buildQueryOptions(projectRequest(), "/bin/claude", "auto").settings as {
        sandbox: { filesystem: { denyRead: string[] } };
      }
    ).sandbox.filesystem.denyRead;
    expect(denied).toEqual([vault, "/srv/projects"]);
  });
});

describe("a clone chat reads its project's notes (#774)", () => {
  const project = (): string => join(vault, "Projects", "2025-03-02-1015-example-app");
  const notesWall = (): TurnRequest["fileWall"] => ({
    area: clone,
    closed: [vault, join(project(), "repos")],
    readable: [],
    readOnly: [project()],
    socketFilter: true,
  });
  const filesystem = (platform: NodeJS.Platform): { denyRead: string[]; allowRead: string[]; allowWrite: string[] } =>
    (
      fileWallSandbox(notesWall() ?? { area: clone, closed: [], readable: [], socketFilter: true }, {
        runtimeFolder: null,
        platform,
      }) as { filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] } }
    ).filesystem;

  test("the shell reads the project folder but not `repos/`, and writes only in the clone", () => {
    const linux = filesystem("linux");
    expect(linux.denyRead).toEqual([vault, join(project(), "repos")]);
    expect(linux.allowRead).toEqual([clone, project()]);
    expect(linux.allowWrite).not.toContain(project());
  });

  test("on macOS, `repos/` closes as a glob, since its last matching rule wins and would close the clone", () => {
    expect(filesystem("darwin").denyRead).toEqual([vault, `${join(project(), "repos")}/**`]);
  });

  test("on macOS, each glob character of the path becomes `?`, since no escape is sure to work", () => {
    const odd = join(vault, "Projects", "2025-03-02-1015-a[b]*{c}");
    const sandbox = fileWallSandbox(
      {
        area: join(odd, "repos", "clone-0"),
        closed: [vault, join(odd, "repos")],
        readable: [],
        readOnly: [odd],
        socketFilter: true,
      },
      { runtimeFolder: null, platform: "darwin" },
    ) as { filesystem: { denyRead: string[] } };
    expect(sandbox.filesystem.denyRead[1]).toBe(`${join(vault, "Projects", "2025-03-02-1015-a?b???c?", "repos")}/**`);
  });

  test("a read of a note keeps its mode's path, a write to it is refused, and the other clones stay closed", async () => {
    mkdirSync(join(project(), "repos", "clone-1"), { recursive: true });
    writeFileSync(join(project(), "plan.md"), "");
    const options = buildQueryOptions(projectRequest({ fileWall: notesWall() }), "/bin/claude", "auto");
    expect(await decide(options, "Read", { file_path: "../../plan.md" })).toBeUndefined();
    expect(await decide(options, "Grep", { pattern: "x", path: project(), glob: "*.md" })).toBe("deny");
    expect(await decide(options, "Write", { file_path: "../../plan.md" })).toBe("deny");
    expect(await decide(options, "Edit", { file_path: join(project(), "plan.md") })).toBe("deny");
    expect(await decide(options, "Read", { file_path: "../clone-1/a.ts" })).toBe("deny");
    expect(await decide(options, "Read", { file_path: "src/a.ts" })).toBeUndefined();
    expect(await decide(options, "Read", { file_path: join(vault, "AGENTS.md") })).toBe("deny");
  });
});

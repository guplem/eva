import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { buildQueryOptions } from "../../../../src/engines/claude-code/claude-code-adapter.ts";
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
    fileWall: { area: clone, closed: [vault, "/srv/projects"], readable: [join(vault, "gh")] },
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
    expect(writes).toContain(join(homedir(), ".cache", "pip"));
    // The default vault lives in the home folder, and a `bin` folder beside a cache runs later outside the sandbox.
    expect(writes).not.toContain(homedir());
    expect(writes).not.toContain(join(homedir(), ".cache"));
    expect(writes).not.toContain(join(homedir(), ".cargo"));
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
        fileWall: { area: folder, closed: [vault], readable: [] },
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
    expect(await decide(options, "Read", { file_path: "$HOME/notes.md" })).toBe("deny");
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

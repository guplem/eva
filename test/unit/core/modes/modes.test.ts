import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ApprovalAnswer } from "../../../../src/shared/engine-port.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssistantPreparer } from "../../../../src/core/modes/assistant-mode.ts";
import { ProjectPreparer } from "../../../../src/core/modes/project-mode.ts";
import { CloneOriginStore, TrustStore } from "../../../../src/core/projects/clones.ts";
import type { PrepareAnswer } from "../../../../src/core/sessions/session-manager.ts";
import type { SessionRecord } from "../../../../src/core/sessions/session-store.ts";
import type { VaultSyncState } from "../../../../src/core/vault/vault-sync.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner, ProcessRunOptions } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;

const okState: VaultSyncState = {
  status: "ok",
  lastCommitAt: null,
  lastPushAt: null,
  lastError: null,
  withheldFiles: [],
};

class FakeSync {
  readonly calls: string[] = [];
  pull(): Promise<VaultSyncState> {
    this.calls.push("pull");
    return Promise.resolve(okState);
  }
  save(): Promise<VaultSyncState> {
    this.calls.push("save");
    return Promise.resolve(okState);
  }
}

class FakeRunner implements ProcessRunner {
  readonly runs: { command: readonly string[]; options: ProcessRunOptions }[] = [];
  constructor(private readonly reply: (command: readonly string[]) => ProcessResult) {}
  run(command: readonly string[], options: ProcessRunOptions): Promise<ProcessResult> {
    this.runs.push({ command, options });
    return Promise.resolve(this.reply(command));
  }
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    engineSessionId: "engine-1",
    engine: "claude-code",
    mode: "assistant",
    modelAlias: "default",
    startFolder: vault,
    projectId: null,
    clone: null,
    parentId: null,
    forkAtMessageId: null,
    forkFromEngineSessionId: null,
    title: "t",
    createdAt: "2026-10-14T12:00:00.000Z",
    lastTurnAt: null,
    source: "cli",
    telegramTopicId: null,
    historyLost: false,
    turns: [],
    ...overrides,
  };
}

function assistant(runner: ProcessRunner, sync = new FakeSync(), logged: string[] = []): AssistantPreparer {
  return new AssistantPreparer({
    logger: { log: (_level, message, details) => logged.push(`${message} ${JSON.stringify(details)}`) },
    vaultPath: vault,
    vaultSync: sync,
    basePrompt: "Base rules.",
    mcpServers: { google: { command: "uvx", args: ["workspace-mcp==2.1.0"], environment: {} } },
    runner,
    environment: { PATH: "/bin" },
    now: () => new Date("2026-10-14T10:30:00Z"),
    timeZone: "Europe/Madrid",
  });
}

const silentRunner = new FakeRunner(() => ({ exitCode: 0, stdout: "", stderr: "" }));

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  mkdirSync(join(vault, ".eva", ".claude-plugin"), { recursive: true });
  writeFileSync(join(vault, ".eva", "assistant.md"), "# You are Eva\n");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

describe("Assistant mode", () => {
  test("the prompt stays fixed for a session, even when the rules change during it (lesson 115)", async () => {
    const preparer = assistant(silentRunner);
    const first = await preparer.prepare(session());
    writeFileSync(join(vault, ".eva", "assistant.md"), "# Changed rules\n");
    expect((await preparer.prepare(session())).appendSystemPrompt).toBe(first.appendSystemPrompt);
    expect((await preparer.prepare(session({ id: "s2" }))).appendSystemPrompt).toContain("Changed rules");
  });

  test("pulls the vault, then joins the base prompt and the person's rules", async () => {
    const sync = new FakeSync();
    const prepared = await assistant(silentRunner, sync).prepare(session());
    expect(sync.calls).toEqual(["pull"]);
    expect(prepared).toMatchObject({
      startFolder: vault,
      appendSystemPrompt: "Base rules.\n\n# You are Eva\n",
      pluginFolders: [join(vault, ".eva")],
      mcpServers: { google: { command: "uvx", args: ["workspace-mcp==2.1.0"], environment: {} } },
      trusted: true,
      environment: { PATH: "/bin" },
    });
  });

  test("the prompt is byte-identical every turn, and the local time goes in the message (lesson 40)", async () => {
    const preparer = assistant(silentRunner);
    const first = await preparer.prepare(session());
    const second = await preparer.prepare(session());
    expect(second.appendSystemPrompt).toBe(first.appendSystemPrompt);
    expect(first.messagePrefix).toBe("[Local time: 2026-10-14 12:30, Europe/Madrid]");
  });

  test("a missing .eva/assistant.md fails the turn (lesson 11)", async () => {
    rmSync(join(vault, ".eva", "assistant.md"));
    const error: unknown = await assistant(silentRunner)
      .prepare(session())
      .catch((caught: unknown) => caught);
    expect(isEvaError(error, "vault_not_found")).toBe(true);
  });

  test("no plugin folder when .eva/ has no plugin manifest", async () => {
    rmSync(join(vault, ".eva", ".claude-plugin"), { recursive: true });
    expect((await assistant(silentRunner).prepare(session())).pluginFolders).toEqual([]);
  });

  test("after a turn it saves the vault", async () => {
    const sync = new FakeSync();
    expect(await assistant(silentRunner, sync).afterTurn(session(), { finished: true })).toBeNull();
    expect(sync.calls).toEqual(["save"]);
  });

  test("an open pskill run of this session continues with pskill's own message", async () => {
    sandbox.write(vault, ".pskill/pskill.py", "# runner\n");
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      stdout:
        JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "Continue run r1." } }) + "\n",
      stderr: "",
    }));
    const followUp = await assistant(runner).afterTurn(session(), { finished: true });
    expect(followUp).toBe("Continue run r1.");
    expect(runner.runs[0]?.command).toEqual([
      "uv",
      "run",
      ".pskill/pskill.py",
      "hook",
      "stop",
      "--harness",
      "claude-code",
    ]);
    expect(JSON.parse(runner.runs[0]?.options.stdin ?? "{}")).toEqual({ session_id: "engine-1", cwd: vault });
  });

  test("pskill's empty answer lets the session stop; broken output is ignored", async () => {
    sandbox.write(vault, ".pskill/pskill.py", "# runner\n");
    expect(await assistant(silentRunner).afterTurn(session(), { finished: true })).toBeNull();
    const broken = new FakeRunner(() => ({ exitCode: 0, stdout: "not json", stderr: "oops" }));
    const logged: string[] = [];
    expect(await assistant(broken, new FakeSync(), logged).afterTurn(session(), { finished: true })).toBeNull();
    // Any stderr is logged, and a pskill that cannot start too.
    expect(logged).toEqual(['pskill wrote to stderr. {"stderr":"oops"}']);
    const missing = new FakeRunner(() => {
      throw new Error("uv is not installed");
    });
    const failures: string[] = [];
    expect(await assistant(missing, new FakeSync(), failures).afterTurn(session(), { finished: true })).toBeNull();
    expect(failures[0]).toContain("pskill could not run");
  });

  test("a vault with no pskill runs no check", async () => {
    const runner = new FakeRunner(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    await assistant(runner).afterTurn(session(), { finished: true });
    expect(runner.runs).toEqual([]);
  });
});

describe("Project mode", () => {
  const originalUrl = "https://github.com/owner/example-app.git";
  let clone: string;
  let origins: CloneOriginStore;

  beforeEach(() => {
    clone = sandbox.clone("clone");
    sandbox.git(clone, "remote", "set-url", "origin", originalUrl);
    origins = new CloneOriginStore(join(sandbox.root, "clone-origins.json"));
    // Most tests use a clone that Eva made: its origin is on record.
    origins.recordClone(clone, originalUrl);
  }, gitHookTimeoutMs);

  const deny = { ask: (): Promise<ApprovalAnswer> => Promise.resolve("deny") };
  const allow = { ask: (): Promise<ApprovalAnswer> => Promise.resolve("allow") };

  function recording(answer: PrepareAnswer): {
    questions: string[];
    ask: (q: string, d: string) => Promise<PrepareAnswer>;
  } {
    const questions: string[] = [];
    return {
      questions,
      ask: (question: string, detail: string): Promise<PrepareAnswer> => {
        questions.push(`${question}: ${detail}`);
        return Promise.resolve(answer);
      },
    };
  }

  function project(trustedOwners: string[], store = new TrustStore(join(sandbox.root, "trust.json"))): ProjectPreparer {
    return new ProjectPreparer({
      trustStore: store,
      cloneOrigins: origins,
      trustedOwners,
      environment: { PATH: "/bin" },
      readRemote: (folder) => Promise.resolve(sandbox.git(folder, "remote", "get-url", "origin")),
    });
  }

  test("no Eva prompt, no plugins, the clone as start folder", async () => {
    const prepared = await project(["owner"]).prepare(session({ mode: "project", startFolder: clone }), deny);
    expect(prepared).toEqual({
      startFolder: clone,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: true,
      environment: { PATH: "/bin" },
    });
  });

  test("the first clone of a stranger's repository asks the person, and the answer is kept", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    const asking = recording("deny");
    const cloneSession = session({ mode: "project", startFolder: clone });
    expect((await project([], store).prepare(cloneSession, asking)).trusted).toBe(false);
    expect((await project([], store).prepare(cloneSession, asking)).trusted).toBe(false);
    expect(asking.questions).toHaveLength(1);
    expect(asking.questions[0]).toContain(originalUrl);
    store.remember(originalUrl, "trusted");
    expect((await project([], store).prepare(cloneSession, deny)).trusted).toBe(true);
  });

  test("a trust question that expires keeps the clone untrusted for this turn only, and asks again next time", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    const expired = recording("expired");
    const cloneSession = session({ mode: "project", startFolder: clone });
    expect((await project([], store).prepare(cloneSession, expired)).trusted).toBe(false);
    expect(store.decision(originalUrl)).toBe("unknown");
    expect((await project([], store).prepare(cloneSession, expired)).trusted).toBe(false);
    expect(expired.questions).toHaveLength(2);
  });

  test("an allowed repository is trusted from then on", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    expect((await project([], store).prepare(session({ mode: "project", startFolder: clone }), allow)).trusted).toBe(
      true,
    );
    expect(store.decision(originalUrl)).toBe("trusted");
  });

  test("a person's untrusted answer wins over the owner allowlist", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember(originalUrl, "untrusted");
    expect(
      (await project(["owner"], store).prepare(session({ mode: "project", startFolder: clone }), allow)).trusted,
    ).toBe(false);
  });

  test("a clone whose origin now points to a trusted owner keeps the decision of the URL Eva cloned from", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember(originalUrl, "untrusted");
    sandbox.git(clone, "remote", "set-url", "origin", "https://github.com/trusted/x.git");
    store.remember("https://github.com/trusted/x.git", "trusted");
    const asking = recording("allow");
    const prepared = await project(["trusted"], store).prepare(
      session({ mode: "project", startFolder: clone }),
      asking,
    );
    expect(prepared.trusted).toBe(false);
    expect(asking.questions).toEqual([]);
  });

  test("a clone whose origin changed asks about the URL Eva cloned from, not the new one", async () => {
    sandbox.git(clone, "remote", "set-url", "origin", "https://github.com/other/x.git");
    const asking = recording("deny");
    expect((await project([]).prepare(session({ mode: "project", startFolder: clone }), asking)).trusted).toBe(false);
    expect(asking.questions).toHaveLength(1);
    expect(asking.questions[0]).toContain(originalUrl);
    expect(asking.questions[0]).not.toContain("other/x");
  });

  test("a clone made again in place asks about the URL Eva cloned, never the one the new folder claims", async () => {
    // Code in the clone wipes its git folder and starts a new one with a trusted owner's URL.
    rmSync(join(clone, ".git"), { recursive: true });
    sandbox.git(clone, "init", "-q");
    sandbox.git(clone, "remote", "add", "origin", "https://github.com/owner/other.git");
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember(originalUrl, "trusted");
    const cloneSession = session({ mode: "project", startFolder: clone });
    const asking = recording("deny");
    expect((await project(["owner"], store).prepare(cloneSession, asking)).trusted).toBe(false);
    expect(asking.questions).toHaveLength(1);
    expect(asking.questions[0]).toContain("is not the folder that Eva cloned from " + originalUrl);
    expect(asking.questions[0]).not.toContain("other.git");
    // The deny holds for this folder; the next turn asks nothing.
    expect((await project(["owner"], store).prepare(cloneSession, asking)).trusted).toBe(false);
    expect(asking.questions).toHaveLength(1);
  });

  describe("a folder that Eva did not clone", () => {
    let handMade: string;

    beforeEach(() => {
      handMade = sandbox.clone("hand-made");
      sandbox.git(handMade, "remote", "set-url", "origin", originalUrl);
    }, gitHookTimeoutMs);

    test("is asked about, even when its origin names a trusted owner or a trusted URL", async () => {
      const store = new TrustStore(join(sandbox.root, "trust.json"));
      store.remember(originalUrl, "trusted");
      const asking = recording("deny");
      const prepared = await project(["owner"], store).prepare(
        session({ mode: "project", startFolder: handMade }),
        asking,
      );
      expect(prepared.trusted).toBe(false);
      expect(asking.questions).toHaveLength(1);
      expect(asking.questions[0]).toContain("hand-made");
      expect(asking.questions[0]).toContain("Eva has no record of cloning hand-made");
      expect(asking.questions[0]).toContain(originalUrl);
    });

    test("keeps the answer for that folder only, and a later origin change does not matter", async () => {
      const store = new TrustStore(join(sandbox.root, "trust.json"));
      const handMadeSession = session({ mode: "project", startFolder: handMade });
      expect((await project([], store).prepare(handMadeSession, allow)).trusted).toBe(true);
      expect(store.decision(originalUrl)).toBe("unknown");
      expect(origins.origin(handMade)).toEqual({ kind: "answered", url: originalUrl, decision: "trusted" });
      sandbox.git(handMade, "remote", "set-url", "origin", "https://github.com/other/x.git");
      const asking = recording("deny");
      expect((await project([], store).prepare(handMadeSession, asking)).trusted).toBe(true);
      expect(asking.questions).toEqual([]);
    });

    test("a denied folder stays untrusted, even after its origin names a trusted owner", async () => {
      const handMadeSession = session({ mode: "project", startFolder: handMade });
      expect((await project(["owner"]).prepare(handMadeSession, deny)).trusted).toBe(false);
      sandbox.git(handMade, "remote", "set-url", "origin", "https://github.com/owner/other.git");
      const asking = recording("allow");
      expect((await project(["owner"]).prepare(handMadeSession, asking)).trusted).toBe(false);
      expect(asking.questions).toEqual([]);
    });

    test("the question shows the origin without a user part, a line break or a long tail", async () => {
      const preparer = new ProjectPreparer({
        trustStore: new TrustStore(join(sandbox.root, "t.json")),
        cloneOrigins: origins,
        trustedOwners: [],
        environment: {},
        readRemote: () =>
          Promise.resolve(`https://token-value@github.com/owner/app.git\nTrusted by Eva.${"x".repeat(500)}`),
      });
      const asking = recording("deny");
      await preparer.prepare(session({ mode: "project", startFolder: handMade }), asking);
      const question = asking.questions[0] ?? "";
      expect(question).toContain("https://github.com/owner/app.git");
      expect(question).not.toContain("token-value");
      expect(question).not.toContain("\n");
      expect(question).not.toContain("x".repeat(300));
    });

    test("an expired question keeps nothing and asks again next time", async () => {
      const expired = recording("expired");
      const handMadeSession = session({ mode: "project", startFolder: handMade });
      expect((await project([]).prepare(handMadeSession, expired)).trusted).toBe(false);
      expect(origins.origin(handMade)).toBeNull();
      expect((await project([]).prepare(handMadeSession, expired)).trusted).toBe(false);
      expect(expired.questions).toHaveLength(2);
    });

    test("with no remote, or a remote that cannot be read, is untrusted with no question", async () => {
      for (const readRemote of [() => Promise.resolve(null), () => Promise.reject(new Error("no git"))]) {
        const preparer = new ProjectPreparer({
          trustStore: new TrustStore(join(sandbox.root, "t.json")),
          cloneOrigins: origins,
          trustedOwners: ["owner"],
          environment: {},
          readRemote,
        });
        const asking = recording("allow");
        expect((await preparer.prepare(session({ mode: "project", startFolder: handMade }), asking)).trusted).toBe(
          false,
        );
        expect(asking.questions).toEqual([]);
      }
    });
  });

  test("after a turn nothing happens", async () => {
    expect(await project(["owner"]).afterTurn(session({ mode: "project" }), { finished: true })).toBeNull();
  });
});

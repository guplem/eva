import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ApprovalAnswer } from "../../../../src/shared/engine-port.ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { moveAssistantPersonality } from "../../../../src/core/migrations/assistant-rules-move.ts";
import { vaultMigrationRecordPath } from "../../../../src/core/migrations/migration-runner.ts";
import { AssistantPreparer } from "../../../../src/core/modes/assistant-mode.ts";
import { ProjectPreparer } from "../../../../src/core/modes/project-mode.ts";
import { CloneOriginStore, TrustStore } from "../../../../src/core/projects/clones.ts";
import type { PrepareAnswer } from "../../../../src/core/sessions/session-manager.ts";
import type { SessionRecord } from "../../../../src/core/sessions/session-store.ts";
import type { VaultSyncState } from "../../../../src/core/vault/vault-sync.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner, ProcessRunOptions } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";

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
    effort: "default",
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
    seenTurns: 0,
    archived: false,
    closed: false,
    continuedFrom: null,
    firstMessageDraft: null,
    pendingRestore: null,
    forkedFrom: null,
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
  writeFileSync(
    vaultMigrationRecordPath(vault),
    JSON.stringify({ applied: [{ id: moveAssistantPersonality.id, at: "", version: "" }] }),
  );
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

  test("before the hub migrates the vault, the prompt adds the sections that left the built-in prompt", async () => {
    rmSync(vaultMigrationRecordPath(vault));
    const prompt = (await assistant(silentRunner).prepare(session())).appendSystemPrompt ?? "";
    expect(prompt.startsWith("Base rules.\n\n# You are Eva\n\n## Answering from the notes\n")).toBe(true);
    expect(prompt).toContain("\n## Learning\n");
    expect(prompt).toContain("\n## Style\n");
  });

  test("the prompt is byte-identical every turn, and the local time goes in the message (lesson 40)", async () => {
    const preparer = assistant(silentRunner);
    const first = await preparer.prepare(session());
    const second = await preparer.prepare(session());
    expect(second.appendSystemPrompt).toBe(first.appendSystemPrompt);
    expect(first.messagePrefix).toBe("[Local time: 2026-10-14 12:30, Europe/Madrid]");
  });

  test("a bad field in Life/About me.md adds a note to the message, so Eva fixes it", async () => {
    mkdirSync(join(vault, "Life"), { recursive: true });
    writeFileSync(join(vault, "Life", "About me.md"), "---\nhemisphere: up\n---\n\n# About Alex\n");
    const prepared = await assistant(silentRunner).prepare(session());
    expect(prepared.messagePrefix).toBe(
      "[Local time: 2026-10-14 12:30, Europe/Madrid]\n[Life/About me.md has problems: hemisphere must be north or south. Fix them with the about-me skill.]",
    );
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

  test("a turn that did not finish saves the vault but asks pskill for no follow-up", async () => {
    sandbox.write(vault, ".pskill/pskill.py", "# runner\n");
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: "Continue run r1." } }),
      stderr: "",
    }));
    const sync = new FakeSync();
    expect(await assistant(runner, sync).afterTurn(session(), { finished: false })).toBeNull();
    expect(sync.calls).toEqual(["save"]);
    expect(runner.runs).toEqual([]);
  });

  test("a vault with no pskill runs no check", async () => {
    const runner = new FakeRunner(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    await assistant(runner).afterTurn(session(), { finished: true });
    expect(runner.runs).toEqual([]);
  });
});

describe("Project mode", () => {
  const originalUrl = "https://github.com/owner/example-app.git";
  // The repository folder inside the clone folder, as Eva makes them: `clone-0/example-app/`.
  let clone: string;
  let cloneFolder: string;
  let origins: CloneOriginStore;

  beforeEach(() => {
    clone = sandbox.clone(join("clone-0", "example-app"));
    cloneFolder = dirname(clone);
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
      trustedOwners: () => trustedOwners,
      environment: { PATH: "/bin" },
      readRemote: (folder) => Promise.resolve(sandbox.git(folder, "remote", "get-url", "origin")),
    });
  }

  test("no Eva prompt, no plugins, the clone as start folder", async () => {
    const prepared = await project(["owner"]).prepare(session({ mode: "project", startFolder: cloneFolder }), deny);
    expect(prepared).toEqual({
      startFolder: cloneFolder,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: true,
      // Git stops at the folder of the clones, so a git command in the clone folder never reads the vault.
      environment: { PATH: "/bin", GIT_CEILING_DIRECTORIES: sandbox.root },
    });
  });

  test("the first clone of a stranger's repository asks the person, and the answer is kept", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    const asking = recording("deny");
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
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
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
    expect((await project([], store).prepare(cloneSession, expired)).trusted).toBe(false);
    expect(store.decision(originalUrl)).toBe("unknown");
    expect((await project([], store).prepare(cloneSession, expired)).trusted).toBe(false);
    expect(expired.questions).toHaveLength(2);
  });

  test("each turn reads the trusted owners again, so a change needs no restart", async () => {
    const owners: string[] = [];
    const preparer = new ProjectPreparer({
      trustStore: new TrustStore(join(sandbox.root, "trust.json")),
      cloneOrigins: origins,
      trustedOwners: () => owners,
      environment: { PATH: "/bin" },
      readRemote: () => Promise.resolve(null),
    });
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
    expect((await preparer.prepare(cloneSession, recording("expired"))).trusted).toBe(false);
    owners.push("owner");
    const asking = recording("deny");
    expect((await preparer.prepare(cloneSession, asking)).trusted).toBe(true);
    expect(asking.questions).toHaveLength(0);
  });

  test("an allowed repository is trusted from then on", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    expect(
      (await project([], store).prepare(session({ mode: "project", startFolder: cloneFolder }), allow)).trusted,
    ).toBe(true);
    expect(store.decision(originalUrl)).toBe("trusted");
  });

  test("a person's untrusted answer wins over the owner allowlist", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember(originalUrl, "untrusted");
    expect(
      (await project(["owner"], store).prepare(session({ mode: "project", startFolder: cloneFolder }), allow)).trusted,
    ).toBe(false);
  });

  test("a clone whose origin now points to a trusted owner keeps the decision of the URL Eva cloned from", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember(originalUrl, "untrusted");
    sandbox.git(clone, "remote", "set-url", "origin", "https://github.com/trusted/x.git");
    store.remember("https://github.com/trusted/x.git", "trusted");
    const asking = recording("allow");
    const prepared = await project(["trusted"], store).prepare(
      session({ mode: "project", startFolder: cloneFolder }),
      asking,
    );
    expect(prepared.trusted).toBe(false);
    expect(asking.questions).toEqual([]);
  });

  test("a clone whose origin changed asks about the URL Eva cloned from, not the new one", async () => {
    sandbox.git(clone, "remote", "set-url", "origin", "https://github.com/other/x.git");
    const asking = recording("deny");
    expect((await project([]).prepare(session({ mode: "project", startFolder: cloneFolder }), asking)).trusted).toBe(
      false,
    );
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
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
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
    let handMadeFolder: string;

    beforeEach(() => {
      handMade = sandbox.clone(join("clone-1", "hand-made"));
      handMadeFolder = dirname(handMade);
      sandbox.git(handMade, "remote", "set-url", "origin", originalUrl);
    }, gitHookTimeoutMs);

    test("is asked about, even when its origin names a trusted owner or a trusted URL", async () => {
      const store = new TrustStore(join(sandbox.root, "trust.json"));
      store.remember(originalUrl, "trusted");
      const asking = recording("deny");
      const prepared = await project(["owner"], store).prepare(
        session({ mode: "project", startFolder: handMadeFolder }),
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
      const handMadeSession = session({ mode: "project", startFolder: handMadeFolder });
      expect((await project([], store).prepare(handMadeSession, allow)).trusted).toBe(true);
      expect(store.decision(originalUrl)).toBe("unknown");
      expect(origins.origin(handMade)).toEqual({ kind: "answered", url: originalUrl, decision: "trusted" });
      sandbox.git(handMade, "remote", "set-url", "origin", "https://github.com/other/x.git");
      const asking = recording("deny");
      expect((await project([], store).prepare(handMadeSession, asking)).trusted).toBe(true);
      expect(asking.questions).toEqual([]);
    });

    test("a denied folder stays untrusted, even after its origin names a trusted owner", async () => {
      const handMadeSession = session({ mode: "project", startFolder: handMadeFolder });
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
        trustedOwners: () => [],
        environment: {},
        readRemote: () =>
          Promise.resolve(`https://token-value@github.com/owner/app.git\nTrusted by Eva.${"x".repeat(500)}`),
      });
      const asking = recording("deny");
      await preparer.prepare(session({ mode: "project", startFolder: handMadeFolder }), asking);
      const question = asking.questions[0] ?? "";
      expect(question).toContain("https://github.com/owner/app.git");
      expect(question).not.toContain("token-value");
      expect(question).not.toContain("\n");
      expect(question).not.toContain("x".repeat(300));
    });

    test("the question hides a token in a short git address, and keeps a plain user name", async () => {
      for (const [remote, shown, hidden] of [
        ["x-access-token:token-value@github.com:owner/app.git", "from github.com:owner/app.git", "token-value"],
        ["git@github.com:owner/app.git", "from git@github.com:owner/app.git", "nothing-hidden"],
      ] as const) {
        const asking = recording("expired");
        await new ProjectPreparer({
          trustStore: new TrustStore(join(sandbox.root, "t.json")),
          cloneOrigins: origins,
          trustedOwners: () => [],
          environment: {},
          readRemote: () => Promise.resolve(remote),
        }).prepare(session({ mode: "project", startFolder: handMadeFolder }), asking);
        expect(asking.questions[0]).toContain(shown);
        expect(asking.questions[0]).not.toContain(hidden);
      }
    });

    test("an expired question keeps nothing and asks again next time", async () => {
      const expired = recording("expired");
      const handMadeSession = session({ mode: "project", startFolder: handMadeFolder });
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
          trustedOwners: () => ["owner"],
          environment: {},
          readRemote,
        });
        const asking = recording("allow");
        expect(
          (await preparer.prepare(session({ mode: "project", startFolder: handMadeFolder }), asking)).trusted,
        ).toBe(false);
        expect(asking.questions).toEqual([]);
      }
    });
  });

  describe("a clone with several repositories (issue 521)", () => {
    const strangerUrl = "https://github.com/stranger/example-api.git";
    let api: string;

    beforeEach(() => {
      api = sandbox.clone(join("clone-0", "example-api"));
      sandbox.git(api, "remote", "set-url", "origin", strangerUrl);
      origins.recordClone(api, strangerUrl);
    }, gitHookTimeoutMs);

    test("is trusted only when every repository is trusted", async () => {
      const store = new TrustStore(join(sandbox.root, "trust.json"));
      const cloneSession = session({ mode: "project", startFolder: cloneFolder });
      const asking = recording("deny");
      expect((await project(["owner"], store).prepare(cloneSession, asking)).trusted).toBe(false);
      expect(asking.questions).toHaveLength(1);
      expect(asking.questions[0]).toContain(strangerUrl);
      store.remember(strangerUrl, "trusted");
      expect((await project(["owner"], store).prepare(cloneSession, deny)).trusted).toBe(true);
    });

    test("stops asking at the first repository that the person does not trust", async () => {
      const asking = recording("deny");
      const cloneSession = session({ mode: "project", startFolder: cloneFolder });
      expect((await project([]).prepare(cloneSession, asking)).trusted).toBe(false);
      expect(asking.questions).toHaveLength(1);
    });

    test("a clone folder with no repository is untrusted, with no question", async () => {
      const empty = join(sandbox.root, "clone-9");
      mkdirSync(empty);
      const asking = recording("allow");
      expect((await project(["owner"]).prepare(session({ mode: "project", startFolder: empty }), asking)).trusted).toBe(
        false,
      );
      expect(asking.questions).toEqual([]);
    });
  });

  test("after a turn nothing happens", async () => {
    expect(await project(["owner"]).afterTurn(session({ mode: "project" }), { finished: true })).toBeNull();
  });

  test("keeps and brings back the files of the clone (issue 523)", async () => {
    const preparer = new ProjectPreparer({
      trustStore: new TrustStore(join(sandbox.root, "trust.json")),
      cloneOrigins: origins,
      trustedOwners: () => [],
      environment: { PATH: "/bin" },
      readRemote: () => Promise.resolve(null),
      snapshots: { runner: systemProcessRunner, environment: gitEnvironment },
    });
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
    sandbox.write(clone, "draft.txt", "first\n");
    expect(await preparer.snapshot(cloneSession, "s1")).toBe(true);
    sandbox.write(clone, "draft.txt", "second\n");
    await preparer.restore(cloneSession, "s1");
    expect(readFileSync(join(clone, "draft.txt"), "utf8")).toBe("first\n");
  });

  test("refuses a restore while Eva pulls or pushes in the clone", async () => {
    const preparer = new ProjectPreparer({
      trustStore: new TrustStore(join(sandbox.root, "trust.json")),
      cloneOrigins: origins,
      trustedOwners: () => [],
      environment: { PATH: "/bin" },
      readRemote: () => Promise.resolve(null),
      snapshots: { runner: systemProcessRunner, environment: gitEnvironment },
      isSyncing: (folder) => folder === cloneFolder,
    });
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
    const error: unknown = await preparer.restore(cloneSession, "s1").catch((caught: unknown) => caught);
    expect(isEvaError(error, "session_busy")).toBe(true);
  });

  test("without Eva's git it keeps no snapshot, and refuses a restore", async () => {
    const preparer = project(["owner"]);
    const cloneSession = session({ mode: "project", startFolder: cloneFolder });
    expect(await preparer.snapshot(cloneSession, "s1")).toBe(false);
    const error: unknown = await preparer.restore(cloneSession, "s1").catch((caught: unknown) => caught);
    expect(isEvaError(error, "snapshot_missing")).toBe(true);
  });
});

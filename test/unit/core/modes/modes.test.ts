import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ApprovalAnswer } from "../../../../src/shared/engine-port.ts";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { moveAssistantPersonality } from "../../../../src/core/migrations/assistant-rules-move.ts";
import { vaultMigrationRecordPath } from "../../../../src/core/migrations/migration-runner.ts";
import { AssistantPreparer, type AssistantPreparerOptions } from "../../../../src/core/modes/assistant-mode.ts";
import { ProjectPreparer } from "../../../../src/core/modes/project-mode.ts";
import { widgetsIntro } from "../../../../src/core/modes/widgets-block.ts";
import { SpecialistPreparer } from "../../../../src/core/modes/specialist-mode.ts";
import { discoverProjects } from "../../../../src/core/projects/project-catalog.ts";
import { CloneOriginStore, TrustStore } from "../../../../src/core/projects/clones.ts";
import type { PrepareAnswer, TurnOutcome } from "../../../../src/core/sessions/session-manager.ts";
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
  snapshot(ref: string): Promise<void> {
    this.calls.push(`snapshot ${ref}`);
    return Promise.resolve();
  }
  /** The files that the next turn changed, or null for a missing snapshot. */
  changed: readonly string[] | null = null;
  readonly asked: string[] = [];
  changedFiles(before: string, after: string): Promise<readonly string[] | null> {
    this.asked.push(`${before} ${after}`);
    return Promise.resolve(this.changed);
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
    modelAlias: "opus",
    effort: "medium",
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
    reportsTo: null,
    forkName: null,
    turns: [],
    ...overrides,
  };
}

function assistant(
  runner: ProcessRunner,
  sync = new FakeSync(),
  logged: string[] = [],
  extra: Partial<AssistantPreparerOptions> = {},
): AssistantPreparer {
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
    projects: () => discoverProjects({ vaultPath: vault, extraRoots: [] }),
    ...extra,
  });
}

function addProject(id: string, status: string, body: string): void {
  mkdirSync(join(vault, "Projects", id), { recursive: true });
  writeFileSync(
    join(vault, "Projects", id, "AGENTS.md"),
    `---\ncreated: 2025-01-01T09:00\nstatus: ${status}\n---\n${body}`,
  );
}

const silentRunner = new FakeRunner(() => ({ exitCode: 0, stdout: "", stderr: "" }));
const finishedTurn: TurnOutcome = { finished: true, addNote: () => undefined };
const stoppedTurn: TurnOutcome = { finished: false, addNote: () => undefined };

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

  test("describes Eva's prompt, the person's rules and the note before each message, and changes nothing", async () => {
    const sync = new FakeSync();
    const described = await assistant(silentRunner, sync).describe(session());
    expect(sync.calls).toEqual([]);
    expect(described.parts.map((part) => [part.group, part.title, part.text])).toEqual([
      ["prompt", "Eva's prompt", "Base rules."],
      ["prompt", "Your rules for Eva", "# You are Eva\n"],
      ["message", "Before each message", "[Local time: 2026-10-14 12:30, Europe/Madrid]"],
    ]);
    expect(described.engine).toEqual({
      mode: "assistant",
      startFolder: vault,
      projectFolder: null,
      trusted: true,
      pluginFolders: [join(vault, ".eva")],
      environment: { PATH: "/bin" },
    });
  });

  test("describes the rules that a running chat keeps, and a missing rules file", async () => {
    const preparer = assistant(silentRunner);
    await preparer.prepare(session());
    writeFileSync(join(vault, ".eva", "assistant.md"), "# Changed rules\n");
    const rules = async (id: string): Promise<unknown> =>
      (await preparer.describe(session({ id }))).parts.find((part) => part.title === "Your rules for Eva");
    expect(await rules("s1")).toMatchObject({ text: "# You are Eva\n", note: null });
    expect(await rules("s2")).toMatchObject({ text: "# Changed rules\n" });
    rmSync(join(vault, ".eva", "assistant.md"));
    const missing = "The file is missing, so a new message fails.";
    expect(await rules("s2")).toMatchObject({ text: null, note: missing });
    // A chat that keeps a copy still fails at its next message, so it gets the note too.
    expect(await rules("s1")).toMatchObject({ text: "# You are Eva\n", note: missing });
    // A folder in the file's place cannot be read. The details still show, with a note.
    mkdirSync(join(vault, ".eva", "assistant.md"));
    expect(await rules("s2")).toMatchObject({ text: null, note: "Eva cannot read the file." });
    expect(await rules("s1")).toMatchObject({ text: "# You are Eva\n", note: null });
  });

  test("pulls the vault, then joins the base prompt and the person's rules", async () => {
    const sync = new FakeSync();
    const prepared = await assistant(silentRunner, sync).prepare(session());
    expect(sync.calls).toEqual(["pull", "snapshot refs/eva/turns/s1/0/before"]);
    expect(prepared).toMatchObject({
      startFolder: vault,
      appendSystemPrompt: "Base rules.\n\n# You are Eva\n",
      pluginFolders: [join(vault, ".eva")],
      mcpServers: { google: { command: "uvx", args: ["workspace-mcp==2.1.0"], environment: {} } },
      trusted: true,
      harnessMemory: false,
      folderHooks: false,
      // The Assistant keeps the whole vault: the outer level may know the inner ones (#711).
      fileWall: null,
      environment: { PATH: "/bin" },
    });
  });

  test("the prompt lists the projects that the person develops and uses after the rules (#690)", async () => {
    addProject("2025-01-01-0900-website", "active", "# Website\n\nThe person's site.\n");
    addProject("2025-02-01-0900-recipes", "in-use", "# Recipes\n");
    addProject("2025-03-01-0900-old", "closed", "# Old\n");
    const prompt = (await assistant(silentRunner).prepare(session())).appendSystemPrompt ?? "";
    expect(prompt).toStartWith("Base rules.\n\n# You are Eva\n\n# The person's projects\n\n");
    expect(prompt).toContain("- Website (`2025-01-01-0900-website`): The person's site.\n");
    expect(prompt).toContain("- Recipes (`2025-02-01-0900-recipes`)\n");
    expect(prompt).not.toContain("2025-03-01-0900-old");
  });

  test("the projects stay fixed for a chat while Eva runs, and a new chat gets the change (#690)", async () => {
    addProject("2025-01-01-0900-website", "active", "# Website\n");
    const preparer = assistant(silentRunner);
    const first = await preparer.prepare(session());
    addProject("2025-02-01-0900-recipes", "in-use", "# Recipes\n");
    addProject("2025-01-01-0900-website", "paused", "# Website\n");
    expect((await preparer.prepare(session())).appendSystemPrompt).toBe(first.appendSystemPrompt);
    const projectsPart = async (id: string): Promise<string | null | undefined> =>
      (await preparer.describe(session({ id }))).parts.find((part) => part.title === "Your projects")?.text;
    expect(await projectsPart("s1")).toContain("Website");
    const next = (await preparer.prepare(session({ id: "s2" }))).appendSystemPrompt ?? "";
    expect(next).toContain("Recipes");
    expect(next).not.toContain("Website");
    expect(await projectsPart("s2")).toContain("Recipes");
    expect(await projectsPart("s3")).toContain("Recipes");
  });

  test("with no project that the person develops or uses, the prompt and the details have no projects part", async () => {
    addProject("2025-01-01-0900-someday", "idea", "# Someday\n");
    const preparer = assistant(silentRunner);
    expect((await preparer.prepare(session())).appendSystemPrompt).toBe("Base rules.\n\n# You are Eva\n");
    expect((await preparer.describe(session())).parts.map((part) => part.title)).not.toContain("Your projects");
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

  test("snapshots the vault after the pull and before the save, under the index of the turn (#525)", async () => {
    const sync = new FakeSync();
    const preparer = assistant(silentRunner, sync);
    const done = { userText: "hi", lastMessageId: "m1", at: "2026-10-14T10:00:00.000Z" };
    const earlier = session({ turns: [done as SessionRecord["turns"][number]] });
    await preparer.prepare(earlier);
    // The turn is in the record when its work ends.
    await preparer.afterTurn(session({ turns: [...earlier.turns, ...earlier.turns] }), stoppedTurn);
    expect(sync.calls).toEqual([
      "pull",
      "snapshot refs/eva/turns/s1/1/before",
      "snapshot refs/eva/turns/s1/1/after",
      "save",
    ]);
  });

  test("after a turn it saves the vault", async () => {
    const sync = new FakeSync();
    expect(await assistant(silentRunner, sync).afterTurn(session(), finishedTurn)).toBeNull();
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
    const followUp = await assistant(runner).afterTurn(session(), finishedTurn);
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
    expect(await assistant(silentRunner).afterTurn(session(), finishedTurn)).toBeNull();
    const broken = new FakeRunner(() => ({ exitCode: 0, stdout: "not json", stderr: "oops" }));
    const logged: string[] = [];
    expect(await assistant(broken, new FakeSync(), logged).afterTurn(session(), finishedTurn)).toBeNull();
    // Any stderr is logged, and a pskill that cannot start too.
    expect(logged).toEqual(['pskill wrote to stderr. {"stderr":"oops"}']);
    const missing = new FakeRunner(() => {
      throw new Error("uv is not installed");
    });
    const failures: string[] = [];
    expect(await assistant(missing, new FakeSync(), failures).afterTurn(session(), finishedTurn)).toBeNull();
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
    expect(await assistant(runner, sync).afterTurn(session(), stoppedTurn)).toBeNull();
    expect(sync.calls).toEqual(["save"]);
    expect(runner.runs).toEqual([]);
  });

  test("the prompt gives the widget lines after the projects, fixed for the chat (#692)", async () => {
    addProject("2025-01-01-0900-website", "active", "# Website\n");
    let lines = ["- Habits: Habits live in Life/Habits."];
    const preparer = assistant(silentRunner, new FakeSync(), [], { widgetLines: () => lines });
    const first = (await preparer.prepare(session())).appendSystemPrompt ?? "";
    expect(first).toContain("# The person's projects");
    expect(first).toEndWith(
      "\n# The person's widgets\n\n" + widgetsIntro + "\n\n- Habits: Habits live in Life/Habits.\n",
    );
    lines = ["- Training: Training data lives in Life/Training."];
    expect((await preparer.prepare(session())).appendSystemPrompt).toBe(first);
    const widgetsPart = async (id: string): Promise<string | null | undefined> =>
      (await preparer.describe(session({ id }))).parts.find((part) => part.title === "Your widgets")?.text;
    expect(await widgetsPart("s1")).toContain("Habits");
    expect(await widgetsPart("s2")).toContain("Training");
    expect((await preparer.prepare(session({ id: "s2" }))).appendSystemPrompt).toContain("Life/Training");
    lines = [];
    expect((await preparer.describe(session({ id: "s3" }))).parts.map((part) => part.title)).not.toContain(
      "Your widgets",
    );
  });

  test("after a turn that breaks a widget's format, the agent gets the problems, then the chat gets a note (#692)", async () => {
    const sync = new FakeSync();
    sync.changed = ["Life/Habits/walk.json"];
    const checked: (readonly string[])[] = [];
    const problems = ['Life/Habits/walk.json does not fit the format of Habits: the field "name" is missing.'];
    const preparer = assistant(silentRunner, sync, [], {
      checkWidgetData: (paths) => {
        checked.push(paths);
        return problems;
      },
    });
    const notes: string[] = [];
    const outcome: TurnOutcome = { finished: true, addNote: (text) => notes.push(text) };
    await preparer.prepare(session());
    const followUp = await preparer.afterTurn(session(), outcome);
    expect(sync.asked).toEqual(["refs/eva/turns/s1/0/before refs/eva/turns/s1/0/after"]);
    expect(checked).toEqual([["Life/Habits/walk.json"]]);
    expect(followUp).toContain(problems[0] ?? "");
    expect(followUp).toContain("DATA_FORMAT.md");
    expect(notes).toEqual([]);
    // The fix turn still breaks the format: Eva says so in the chat, and asks the agent nothing more.
    await preparer.prepare(session());
    expect(await preparer.afterTurn(session(), outcome)).toBeNull();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(problems[0] ?? "");
    // A fixed file ends the fix.
    sync.changed = [];
    problems.length = 0;
    await preparer.prepare(session());
    expect(await preparer.afterTurn(session(), outcome)).toBeNull();
    expect(notes).toHaveLength(1);
  });

  test("a stopped turn that breaks a widget's format gets a note, and no follow-up (#692)", async () => {
    const sync = new FakeSync();
    sync.changed = ["Life/Habits/walk.json"];
    const notes: string[] = [];
    const preparer = assistant(silentRunner, sync, [], { checkWidgetData: () => ["walk.json is not valid JSON."] });
    await preparer.prepare(session());
    expect(await preparer.afterTurn(session(), { finished: false, addNote: (text) => notes.push(text) })).toBeNull();
    expect(notes).toHaveLength(1);
  });

  test("a turn with a failed snapshot, or no start, skips the check of widget data", async () => {
    const sync = new FakeSync();
    let checks = 0;
    const preparer = assistant(silentRunner, sync, [], {
      checkWidgetData: () => {
        checks += 1;
        return ["broken"];
      },
    });
    expect(await preparer.afterTurn(session(), finishedTurn)).toBeNull();
    await preparer.prepare(session());
    expect(await preparer.afterTurn(session(), finishedTurn)).toBeNull();
    expect(checks).toBe(0);
  });

  test("a check of widget data that throws never fails the turn", async () => {
    const sync = new FakeSync();
    sync.changed = ["Life/Habits/walk.json"];
    const logged: string[] = [];
    const preparer = assistant(silentRunner, sync, logged, {
      checkWidgetData: () => {
        throw new Error("The disk is gone.");
      },
    });
    await preparer.prepare(session());
    expect(await preparer.afterTurn(session(), finishedTurn)).toBeNull();
    expect(logged[0]).toContain("The disk is gone.");
  });

  test("a vault with no pskill runs no check", async () => {
    const runner = new FakeRunner(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    await assistant(runner).afterTurn(session(), finishedTurn);
    expect(runner.runs).toEqual([]);
  });
});

describe("Specialist mode (#703)", () => {
  const coachId = "2025-03-02-1015-coach";

  function specialist(sync = new FakeSync()): SpecialistPreparer {
    return new SpecialistPreparer({ vaultSync: sync, environment: { PATH: "/bin" } });
  }

  test("a specialist's wall closes the vault and each extra project root (#711)", async () => {
    const preparer = new SpecialistPreparer({
      vaultSync: new FakeSync(),
      environment: {},
      closedRoots: () => [vault, "/srv/projects"],
    });
    const folder = join(vault, "Projects", coachId);
    const chat = session({ mode: "project", startFolder: folder, projectId: coachId, clone: null });
    expect((await preparer.prepare(chat)).fileWall).toEqual({ area: folder, closed: [vault, "/srv/projects"] });
  });

  function coachSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
    const folder = join(vault, "Projects", coachId);
    return session({ mode: "project", startFolder: folder, projectId: coachId, clone: null, ...overrides });
  }

  test("the project folder as start folder, with no Eva prompt, no hooks and no harness memory", async () => {
    const sync = new FakeSync();
    const folder = join(vault, "Projects", coachId);
    const prepared = await specialist(sync).prepare(coachSession());
    expect(prepared).toEqual({
      startFolder: folder,
      // The engine hides each instruction file above the specialist, such as the vault's map (#702).
      projectFolder: folder,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: true,
      harnessMemory: false,
      folderHooks: false,
      // The specialist reads and writes its own folder only (#711).
      fileWall: { area: folder, closed: [] },
      // Git stops above the specialist, so a git command there never finds the vault's repository.
      environment: { PATH: "/bin", GIT_CEILING_DIRECTORIES: join(vault, "Projects") },
    });
  });

  test("syncs the vault around each turn, as Assistant mode does", async () => {
    const sync = new FakeSync();
    const preparer = specialist(sync);
    await preparer.prepare(coachSession());
    expect(sync.calls).toEqual(["pull", "snapshot refs/eva/turns/s1/0/before"]);
    expect(await preparer.afterTurn(coachSession(), finishedTurn)).toBeNull();
    expect(sync.calls.slice(2)).toEqual(["snapshot refs/eva/turns/s1/0/after", "save"]);
  });

  test("a chat whose project is no specialist any more takes no message, and touches no file", async () => {
    const sync = new FakeSync();
    const preparer = new SpecialistPreparer({
      vaultSync: sync,
      environment: { PATH: "/bin" },
      isSpecialist: () => false,
    });
    const caught = await preparer.prepare(coachSession()).catch((error: unknown) => error);
    expect(isEvaError(caught, "project_invalid")).toBe(true);
    expect(sync.calls).toEqual([]);
  });

  test("describes no part of Eva's, and changes nothing", async () => {
    const sync = new FakeSync();
    const folder = join(vault, "Projects", coachId);
    expect(await specialist(sync).describe(coachSession())).toEqual({
      parts: [],
      engine: {
        mode: "project",
        startFolder: folder,
        projectFolder: folder,
        trusted: true,
        pluginFolders: [],
        environment: { PATH: "/bin" },
      },
    });
    expect(sync.calls).toEqual([]);
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

  test("a chat in a clone gets a copy of each mentioned vault file, and no vault path (#706)", () => {
    writeFileSync(join(vault, "Plan.md"), "The plan.");
    const preparer = new ProjectPreparer({
      trustStore: new TrustStore(join(sandbox.root, "trust.json")),
      cloneOrigins: origins,
      trustedOwners: () => [],
      environment: {},
      readRemote: () => Promise.resolve(null),
      vaultPath: () => vault,
    });
    const chat = session({ mode: "project", startFolder: cloneFolder, clone: "clone-0" });
    const text = preparer.engineMessage(chat, "Read @file:Plan.md");
    expect(text).toMatch(
      /^Read @file:Plan-[0-9a-f]{12}\.md\n\n\[@file:Plan-[0-9a-f]{12}\.md is the file \.mentions\/Plan-[0-9a-f]{12}\.md\]$/,
    );
    expect(readdirSync(join(cloneFolder, ".mentions"))).toHaveLength(1);
    // A chat with no clone, such as a specialist chat of #703, keeps its text.
    expect(
      preparer.engineMessage(session({ mode: "project", startFolder: vault, clone: null }), "Read @file:Plan.md"),
    ).toBe("Read @file:Plan.md");
  });

  test("the file wall closes the vault and each extra project root, read at each turn (#711)", async () => {
    let roots = [vault];
    const preparer = new ProjectPreparer({
      trustStore: new TrustStore(join(sandbox.root, "trust.json")),
      cloneOrigins: origins,
      trustedOwners: () => ["owner"],
      environment: {},
      readRemote: () => Promise.resolve(null),
      closedRoots: () => roots,
    });
    const chat = session({ mode: "project", startFolder: cloneFolder, clone: "clone-0" });
    expect((await preparer.prepare(chat, deny)).fileWall).toEqual({ area: cloneFolder, closed: [vault] });
    roots = [vault, "/srv/projects"];
    expect((await preparer.prepare(chat, deny)).fileWall?.closed).toEqual([vault, "/srv/projects"]);
  });

  test("no Eva prompt, no plugins, the clone as start folder", async () => {
    const prepared = await project(["owner"]).prepare(
      session({ mode: "project", startFolder: cloneFolder, clone: "clone-0" }),
      deny,
    );
    expect(prepared).toEqual({
      startFolder: cloneFolder,
      // The engine hides each instruction file above this folder (#702).
      projectFolder: dirname(sandbox.root),
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: true,
      harnessMemory: true,
      folderHooks: true,
      // A chat in a clone reads and writes its clone only (#711).
      fileWall: { area: cloneFolder, closed: [] },
      // Git stops at the folder of the clones, so a git command in the clone folder never reads the vault.
      environment: { PATH: "/bin", GIT_CEILING_DIRECTORIES: sandbox.root },
    });
  });

  test("describes no part of Eva's, and the trust of the clone without a question", async () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    const cloneSession = session({ mode: "project", startFolder: cloneFolder, clone: "clone-0" });
    expect(await project(["owner"], store).describe(cloneSession)).toEqual({
      parts: [],
      engine: {
        mode: "project",
        startFolder: cloneFolder,
        projectFolder: dirname(sandbox.root),
        trusted: true,
        pluginFolders: [],
        environment: { PATH: "/bin" },
      },
    });
    // A stranger's repository with no answer counts as untrusted, and no answer is kept.
    expect((await project([], store).describe(cloneSession)).engine.trusted).toBe(false);
    expect(store.decision(originalUrl)).toBe("unknown");
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
    expect(await project(["owner"]).afterTurn(session({ mode: "project" }), finishedTurn)).toBeNull();
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

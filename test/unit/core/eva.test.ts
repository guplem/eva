import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Alert } from "../../../src/core/alerts/alert-center.ts";
import { Eva, type EvaOptions } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths, type EvaConfig } from "../../../src/core/settings/home.ts";
import { projectWallRoots } from "../../../src/core/instance/child-environments.ts";
import { templateParts } from "../../../src/core/vault/vault-template.ts";
import { turnSnapshotRef } from "../../../src/core/vault/vault-snapshots.ts";
import type { SessionRecord } from "../../../src/core/sessions/session-store.ts";
import type { SessionEvent } from "../../../src/shared/events.ts";
import { isEvaError } from "../../../src/shared/errors.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../src/shared/process-runner.ts";
import type { TurnRequest } from "../../../src/shared/engine-port.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { fakeGh } from "../../support/fake-gh.ts";
import { fakeGithub, fakeGithubWrite } from "../../support/fake-github.ts";
import { widgetTemplate } from "../../../src/core/widgets/widget-template.ts";
import { ghInstallRunner, serveGhRelease } from "../../support/fake-gh-release.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../support/git-sandbox.ts";
import { testVaultKeyText } from "../../support/vault-key.ts";

let sandbox: GitSandbox;
let vault: string;
let home: string;
let eva: Eva | null;
let clock: Date;

// The turn sync runs git many times, and git is slow on Windows (#203). A test of the sync turns it on.
const syncOff = { ...defaultConfig.sync, enabled: false };
const syncOn = { ...defaultConfig.sync, enabled: true };

function config(overrides: Partial<EvaConfig> = {}): EvaConfig {
  return { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid", sync: syncOff, ...overrides };
}

function start(engine: FakeEngine, overrides: Partial<EvaConfig> = {}, options: Partial<EvaOptions> = {}): Eva {
  eva = new Eva({
    ...options,
    paths: homePaths(home),
    config: config(overrides),
    secrets: options.secrets ?? { claudeOauthToken: "oauth-token-value-for-tests" },
    engines: [engine],
    // A real gh asks GitHub about the local test remote. On a slow runner, the project work report
    // waited up to its 20-second timeout, so the test that waits for the report failed.
    runner: options.runner ?? fakeGh(systemProcessRunner),
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
  // A clone of a local test remote is unknown to the trust store: answer its trust question with no.
  const instance = eva;
  instance.sessions.subscribe((event) => {
    if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
  });
  return instance;
}

/** An engine whose chats answer "ok", and whose model calls say that every chat has finished. */
function finishingEngine(): FakeEngine {
  return new FakeEngine((request) => FakeEngine.answer(request, request.mode === "model-call" ? "FINISHED" : "ok"));
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
  sandbox.write(vault, ".eva/vault-key.json", testVaultKeyText);
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "eva files");
  sandbox.git(vault, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-home-"));
  eva = null;
  clock = new Date("2026-10-14T10:30:00Z");
}, gitHookTimeoutMs);
afterEach(async () => {
  await eva?.idle();
  eva?.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("Eva", () => {
  test("a schedule fires in a fresh Assistant chat named after it, and starts with the background work", async () => {
    const engine = new FakeEngine();
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(engine);
    instance.startBackgroundWork();
    instance.startBackgroundWork();
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    await instance.idle();
    const [session] = instance.sessions.list();
    expect(session).toMatchObject({ title: "Lunch", source: "schedule", mode: "assistant" });
    expect(engine.requests[0]?.prompt).toEndWith("Lunch ideas?");
  });

  test("with no vault there is no scheduler", () => {
    expect(start(new FakeEngine(), { vaultPath: null }).schedules).toBeNull();
  });

  test("an Assistant chat runs at the vault root and saves what the turn wrote", async () => {
    const engine = new FakeEngine((request) => {
      writeFileSync(join(request.startFolder, "Methods", "New.md"), "A new note.\n");
      return FakeEngine.answer(request, "Stored it.");
    });
    mkdirSync(join(vault, "Methods"));
    const instance = start(engine, { sync: syncOn });
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "Store a note.");

    expect(engine.requests[0]?.startFolder).toBe(vault);
    expect(engine.requests[0]?.prompt).toBe("[Local time: 2026-10-14 12:30, Europe/Madrid]\n\nStore a note.");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
    expect(instance.status().vaultSync.status).toBe("ok");
    expect(instance.status().vaultAutoSync).toBe(true);
  });

  test("an Assistant chat knows the projects that the person develops and uses, also in an extra root (#690)", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-recipes/AGENTS.md",
      "---\ncreated: 2025-03-02T10:15\nstatus: in-use\n---\n# Recipes\n\nThe menus of each week.\n",
    );
    const extraRoot = join(sandbox.root, "extra-projects");
    mkdirSync(join(extraRoot, "2025-04-01-0900-website"), { recursive: true });
    writeFileSync(
      join(extraRoot, "2025-04-01-0900-website", "AGENTS.md"),
      "---\ncreated: 2025-04-01T09:00\nstatus: active\n---\n# Website\n",
    );
    const engine = new FakeEngine();
    const instance = start(engine, { projectRoots: [extraRoot] });
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "What should I cook?");
    const prompt = engine.requests[0]?.appendSystemPrompt ?? "";
    expect(prompt).toContain("- Recipes (`2025-03-02-1015-recipes`): The menus of each week.");
    expect(prompt).toContain(
      `- Website (\`2025-04-01-0900-website\`, in \`${join(extraRoot, "2025-04-01-0900-website")}\`)`,
    );
  });

  test("a retry with undo restores the files of the retried answers and pushes the undo (#525)", async () => {
    // Only the first two answers write: the new answer of the retry writes nothing.
    const engine = new FakeEngine((request, turnNumber) => {
      if (turnNumber <= 2) writeFileSync(join(request.startFolder, "Plan.md"), `Plan ${String(turnNumber)}.\n`);
      return FakeEngine.answer(request, "Done.");
    });
    const instance = start(engine, { sync: syncOn });
    const session = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(session.id, "Write a plan.");
    await instance.sessions.send(session.id, "Change the plan.");

    expect(await instance.retryUndoPreview(session.id, 1)).toEqual({
      restore: ["Plan.md"],
      changed: [],
      notKept: [],
      answers: 1,
    });
    expect(await instance.retryUndoPreview(session.id, 0)).toEqual({
      restore: ["Plan.md"],
      changed: [],
      notKept: [],
      answers: 2,
    });

    const branch = await instance.retryTurn(session.id, 0, true);
    await instance.idle();
    expect(existsSync(join(vault, "Plan.md"))).toBe(false);
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).not.toContain("Plan.md");
    expect(instance.sessions.get(branch.id).turns).toHaveLength(1);

    // A delete of the chats takes their snapshots with them.
    instance.sessions.delete(branch.id);
    instance.sessions.delete(session.id);
    await waitFor(() => sandbox.git(vault, "for-each-ref", "refs/eva") === "");
  });

  test("a retry without undo keeps the files (#525)", async () => {
    const engine = new FakeEngine((request, turnNumber) => {
      if (turnNumber <= 1) writeFileSync(join(request.startFolder, "Plan.md"), "Plan.\n");
      return FakeEngine.answer(request, "Done.");
    });
    const instance = start(engine, { sync: syncOn });
    const session = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(session.id, "Write a plan.");
    await instance.retryTurn(session.id, 0, false);
    await instance.idle();
    expect(readFileSync(join(vault, "Plan.md"), "utf-8")).toBe("Plan.\n");
  });

  test("with sync off, an Assistant turn neither pulls nor pushes the vault, but Sync now still works", async () => {
    const engine = new FakeEngine((request) => {
      writeFileSync(join(request.startFolder, "Methods", "New.md"), "A new note.\n");
      return FakeEngine.answer(request, "Stored it.");
    });
    mkdirSync(join(vault, "Methods"));
    const other = sandbox.clone("other");
    sandbox.write(other, "Remote.md", "From another machine.\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "remote note");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(engine, { sync: syncOff });
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "Store a note.");

    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).not.toContain("Methods/New.md");
    expect(existsSync(join(vault, "Remote.md"))).toBe(false);
    // The old "ok" of the pull at start is not the whole truth, so the status says that sync is off (#215).
    expect(instance.status().vaultAutoSync).toBe(false);
    // A request from the person still syncs: the setting stops only the automatic steps.
    expect((await instance.syncVault()).status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
    expect(existsSync(join(vault, "Remote.md"))).toBe(true);
  });

  test("a saved change of sync.enabled waits for a restart", async () => {
    const engine = new FakeEngine((request) => {
      writeFileSync(join(request.startFolder, "Methods", "New.md"), "A new note.\n");
      return FakeEngine.answer(request, "Stored it.");
    });
    mkdirSync(join(vault, "Methods"));
    const instance = start(engine, { sync: syncOn });
    expect(instance.updateSettings({ sync: { enabled: false } }).restartNeeded).toBe(true);
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "Store a note.");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
  });

  test("a saved change of sync.enabled does not start the timed pull before a restart", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, "Remote.md", "From another machine.\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "remote note");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(new FakeEngine(), { sync: syncOff });
    instance.updateSettings({ sync: { enabled: true } });
    clock = new Date(clock.getTime() + 60 * 60_000);
    await instance.backgroundTick();
    expect(existsSync(join(vault, "Remote.md"))).toBe(false);
  });

  test("the engine gets an allowlisted environment with the Claude token, and no other secret (lesson 96)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "hi");
    const environment = engine.requests[0]?.environment ?? {};
    expect(environment["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("oauth-token-value-for-tests");
    expect(Object.keys(environment).some((name) => name.startsWith("GIT_AUTHOR"))).toBe(false);
  });

  test("each instance gets its own Claude, pi and gh config folders (lesson 111)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    await instance.sessions.send(instance.createAssistantSession({ source: "cli" }).id, "hi");
    expect(engine.requests[0]?.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
    expect(engine.requests[0]?.environment["PI_CODING_AGENT_DIR"]).toBe(join(home, "engines", "pi-agent"));
    expect(engine.requests[0]?.environment["GH_CONFIG_DIR"]).toBe(join(home, "engines", "gh"));
  });

  test("the agent's git gets the instance's own global config, so a push uses the instance's gh login", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    await instance.sessions.send(instance.createAssistantSession({ source: "cli" }).id, "hi");
    const gitConfig = join(home, "engines", "git", "gitconfig");
    expect(engine.requests[0]?.environment["GIT_CONFIG_GLOBAL"]).toBe(gitConfig);
    expect(readFileSync(gitConfig, "utf-8")).toContain("helper = !gh auth git-credential");
  });

  test("Eva's own gh calls use the instance's gh folder, not another person's login", async () => {
    const ghEnvironments: Record<string, string>[] = [];
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner: {
        run: (command, options) => {
          if (command[0] === "gh") ghEnvironments.push({ ...options.environment });
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        },
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
    });
    await eva.runCheck("github");
    expect(ghEnvironments[0]?.["GH_CONFIG_DIR"]).toBe(join(home, "engines", "gh"));
    // Only gh needs its folder; git and the Google tools get no engine folder.
    expect(ghEnvironments[0]?.["CLAUDE_CONFIG_DIR"]).toBeUndefined();
  });

  test("a Project chat runs in a clone, which Eva creates when the project has none", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine();
    const instance = start(engine, { trust: { trustedRepositoryOwners: [] } });
    const session = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
    });
    expect(session.clone).toBe("clone-0");
    await instance.sessions.send(session.id, "fix it");
    expect(engine.requests[0]).toMatchObject({
      mode: "project",
      startFolder: join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "clone-0"),
      appendSystemPrompt: null,
      trusted: false,
    });
  });

  test("a clone that Eva made keeps the trust of the URL she cloned, after its origin changes", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine();
    const instance = start(engine, { trust: { trustedRepositoryOwners: ["trusted"] } });
    const questions: string[] = [];
    instance.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") questions.push(event.summary);
    });
    const session = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
    });
    sandbox.git(join(session.startFolder, "remote"), "remote", "set-url", "origin", "https://github.com/trusted/x.git");
    await instance.sessions.send(session.id, "fix it");
    expect(engine.requests[0]?.trusted).toBe(false);
    expect(questions.join("\n")).toContain(sandbox.remote);
    expect(questions.join("\n")).not.toContain("trusted/x");
  });

  test("a free clone that Eva has a record of goes first, so work does not wait on a trust question", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const repos = join(vault, "Projects", "2025-03-02-1015-example-app", "repos");
    mkdirSync(repos, { recursive: true });
    // A clone made by hand, or by Eva before she kept records.
    sandbox.git(repos, "clone", "-q", sandbox.remote, join("clone-0", "remote"));
    const instance = start(new FakeEngine());
    expect((await instance.newClone("2025-03-02-1015-example-app")).name).toBe("clone-1");
    const session = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
    });
    expect(session.clone).toBe("clone-1");
  });

  test("the assistant gives work to a project, and the result comes back to its chat", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "project" ? "Fixed the login bug." : "Noted."),
    );
    const instance = start(engine);
    const events: SessionEvent[] = [];
    instance.sessions.subscribe((event) => events.push(event));
    const assistantChat = instance.createAssistantSession({ source: "telegram" });
    const work = await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix the login bug.",
      reportToSessionId: assistantChat.id,
    });
    // The record says that Eva made the chat for another chat, so the web app never lists it as unread (#614).
    expect(work).toMatchObject({ mode: "project", clone: "clone-0", reportsTo: assistantChat.id });
    // The asking chat learns of the Project chat before its first message, so a front end can show both.
    expect(events).toMatchObject([
      {
        kind: "project_work_started",
        sessionId: assistantChat.id,
        projectId: "2025-03-02-1015-example-app",
        projectSessionId: work.id,
        request: "Fix the login bug.",
      },
    ]);
    await waitFor(() => instance.sessions.get(assistantChat.id).turns.length === 1, 20_000);
    await instance.idle();
    expect(engine.requests.map((request) => request.mode)).toEqual(["project", "assistant"]);
    expect(engine.requests[1]?.prompt).toContain(`[Project work finished: 2025-03-02-1015-example-app, clone clone-0`);
    expect(engine.requests[1]?.prompt).toContain("Fixed the login bug.");
    // Eva sent the result, so the web app does not show it as the person's message.
    expect(instance.sessions.get(assistantChat.id).turns[0]?.fromEva).toBe(true);
    // The facts of the work, so the web app shows a card instead of the raw message.
    expect(instance.sessions.get(assistantChat.id).turns[0]?.projectReports).toMatchObject([
      {
        projectId: "2025-03-02-1015-example-app",
        projectTitle: "Example app",
        projectSessionId: work.id,
        request: "Fix the login bug.",
        clone: "clone-0",
        failed: false,
        result: "Fixed the login bug.",
        resultCut: false,
      },
    ]);
    const missing = await instance
      .startProjectWork({ projectId: "missing", request: "x", reportToSessionId: null })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(String(missing)).toContain("No project missing");
  });

  test("a project work whose asking chat was deleted keeps its result in the Project chat only", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    let finishWork: () => void = () => undefined;
    const workMayEnd = new Promise<void>((resolve) => (finishWork = resolve));
    const engine = new FakeEngine(async function* (request) {
      if (request.mode === "project") await workMayEnd;
      yield* FakeEngine.answer(request, "Fixed it.");
    });
    const lines: string[] = [];
    const instance = start(engine, {}, { logger: { log: (level, message) => lines.push(`${level} ${message}`) } });
    instance.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
    });
    const asking = instance.createAssistantSession({ source: "web" });
    const work = await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: asking.id,
    });
    instance.sessions.delete(asking.id);
    finishWork();
    await waitFor(() => lines.some((line) => line.includes("asking chat is gone")), 20_000);
    expect(lines.filter((line) => line.startsWith("error"))).toEqual([]);
    expect(instance.sessions.list().map((session) => session.id)).toEqual([work.id]);
  });

  test("a project work whose asking branch was deleted reports to the fork that took its place (issue 647)", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    let finishWork: () => void = () => undefined;
    const workMayEnd = new Promise<void>((resolve) => (finishWork = resolve));
    const engine = new FakeEngine(async function* (request) {
      if (request.mode === "project") await workMayEnd;
      yield* FakeEngine.answer(request, "Fixed it.");
    });
    const instance = start(engine);
    instance.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
    });
    const asking = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(asking.id, "Hello.");
    const fork = instance.sessions.fork(asking.id, instance.sessions.get(asking.id).turns[0]!.lastMessageId!);
    await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: asking.id,
    });
    instance.sessions.deleteBranch(asking.id);
    finishWork();
    await waitFor(() => instance.sessions.get(fork.id).turns.length === 2, 20_000);
    await instance.idle();
    expect(instance.sessions.get(fork.id).turns[1]?.fromEva).toBe(true);
  });

  test("two project works at once get two different clones", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const instance = start(finishingEngine());
    const input = { projectId: "2025-03-02-1015-example-app", request: "Fix it.", reportToSessionId: null };
    const works = await Promise.all([instance.startProjectWork(input), instance.startProjectWork(input)]);
    expect(works.map((work) => work.clone).sort()).toEqual(["clone-0", "clone-1"]);
    // A work from a terminal reports to no chat: the person asked for it.
    expect(works.map((work) => work.reportsTo)).toEqual([null, null]);
    await instance.idle();
    const third = await instance.startProjectWork(input);
    expect(third.clone).toBe("clone-0");
  });

  test("two new clones at once get two different folders", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const instance = start(new FakeEngine());
    const clones = await Promise.all([
      instance.newClone("2025-03-02-1015-example-app"),
      instance.newClone("2025-03-02-1015-example-app"),
    ]);
    expect(clones.map((clone) => clone.name).sort()).toEqual(["clone-0", "clone-1"]);
  });

  test("the person deletes a clone, and its chats and their forks go with it", async () => {
    const projectId = "2025-03-02-1015-example-app";
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const instance = start(new FakeEngine());
    const chat = await instance.createProjectSession({ projectId, source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    const fork = instance.sessions.fork(chat.id, instance.sessions.get(chat.id).turns[0]?.lastMessageId ?? "");
    await instance.newClone(projectId);
    const other = await instance.createProjectSession({
      projectId,
      cloneName: "clone-1",
      source: "cli",
    });

    expect(await instance.deleteClone(projectId, "clone-0")).toEqual({ deletedChats: [chat.id, fork.id] });
    expect(existsSync(chat.startFolder)).toBe(false);
    expect(instance.sessions.list().map((session) => session.id)).toEqual([other.id]);
    expect((await instance.clones(projectId)).map((clone) => clone.name)).toEqual(["clone-1"]);
    expect((await instance.newClone(projectId)).name).toBe("clone-0");
  });

  test("a clone where Eva works now, or that does not exist, stays", async () => {
    const projectId = "2025-03-02-1015-example-app";
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
    );
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const chat = await instance.createProjectSession({ projectId, source: "cli" });
    const running = instance.sessions.send(chat.id, "long task");
    await waitFor(() => engine.requests.length >= 1);
    expect(await instance.deleteClone(projectId, "clone-0").catch((caught: unknown) => caught)).toMatchObject({
      code: "session_busy",
    });
    expect(existsSync(chat.startFolder)).toBe(true);
    expect(instance.sessions.list().map((session) => session.id)).toEqual([chat.id]);
    release();
    await running;
    expect(await instance.deleteClone(projectId, "clone-9").catch((caught: unknown) => caught)).toMatchObject({
      code: "project_not_found",
    });
    expect(await instance.deleteClone(projectId, "../clone-0").catch((caught: unknown) => caught)).toMatchObject({
      code: "project_not_found",
    });
  });

  test("a clone that Eva pulls now stays", async () => {
    const projectId = "2025-03-02-1015-example-app";
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
    );
    let pullStarted = false;
    let release: () => void = () => undefined;
    const runner: ProcessRunner = {
      run: async (command, options) => {
        if (command.includes("pull")) {
          pullStarted = true;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return systemProcessRunner.run(command, options);
      },
    };
    const instance = start(new FakeEngine(), {}, { runner });
    const clone = await instance.newClone(projectId);
    const pulling = instance.pullClone(projectId, clone.name, "remote");
    await waitFor(() => pullStarted);
    expect(await instance.deleteClone(projectId, clone.name).catch((caught: unknown) => caught)).toMatchObject({
      code: "session_busy",
    });
    expect(existsSync(clone.path)).toBe(true);
    release();
    await pulling;
  });

  test("the person changes a project's details and its whole file, and the sweep commits them", async () => {
    const projectId = "2025-03-02-1015-example-app";
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n",
    );
    const instance = start(new FakeEngine());
    const read = instance.projectFile(projectId);
    expect(read.text).toBe("---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n");

    const saved = instance.saveProjectDetails(projectId, read.version, {
      title: "Better app",
      status: "paused",
      tags: ["work"],
      repos: [],
    });
    expect(saved.text).toBe("---\ncreated: 2025-03-02T10:15\nstatus: paused\ntags:\n  - work\n---\n# Better app\n");
    expect(instance.projects()[0]).toMatchObject({ title: "Better app", frontMatter: { status: "paused" } });

    const written = instance.saveProjectFile(projectId, saved.version, `${saved.text}\nMore notes.\n`);
    expect(readFileSync(join(vault, "Projects", projectId, "AGENTS.md"), "utf-8")).toEndWith("More notes.\n");
    expect(written.version).not.toBe(saved.version);

    await instance.sweep();
    expect(sandbox.git(sandbox.remote, "show", `main:Projects/${projectId}/AGENTS.md`)).toContain("More notes.");
  });

  test("the person creates a project, named after the time of the configured time zone, with a public standard repository", async () => {
    const created: unknown[] = [];
    const writes: string[] = [];
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        created.push(await request.json());
        return Response.json({ full_name: "you/example-app", clone_url: "https://github.com/you/example-app.git" });
      },
    });
    try {
      const instance = start(
        new FakeEngine(),
        {},
        {
          secrets: { claudeOauthToken: "oauth-token-value-for-tests", githubToken: "github-token-value" },
          githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
          githubRequest: fakeGithub({
            "you/example-app": {
              files: { "README.md": "# Example App\n" },
              labels: ["bug"],
              security: { hasVulnerabilityAlertsEnabled: false, isSecurityPolicyEnabled: false },
            },
          }),
          githubWrite: (method, path) => {
            writes.push(`${method} ${path}`);
            return Promise.resolve({ status: 204, body: "" });
          },
        },
      );

      const result = await instance.createProject({
        name: "Example App",
        description: "A small app.",
        status: "idea",
        tags: [],
        repository: { type: "standard", visibility: "public" },
        drive: true,
        type: "software",
      });

      // 10:30 UTC is 12:30 in Madrid.
      expect(result.projectId).toBe("2026-10-14-1230-example-app");
      expect(result.github).toEqual({ url: "https://github.com/you/example-app" });
      expect(result.drive).toEqual({ problem: expect.stringContaining("Read and change") as string });
      expect(created).toEqual([{ name: "example-app", description: "A small app.", private: false, auto_init: true }]);
      expect(instance.projects()[0]).toMatchObject({
        id: "2026-10-14-1230-example-app",
        frontMatter: {
          created: "2026-10-14T12:30",
          status: "idea",
          repos: ["https://github.com/you/example-app"],
          repoTypes: { "https://github.com/you/example-app": "standard" },
        },
      });
      // Each basic item that GitHub offers is on, so nothing needs a chat.
      expect(writes).toEqual(["PUT repos/you/example-app/vulnerability-alerts"]);
      expect(result.setup).toEqual({ sessionId: null, problems: [] });
    } finally {
      await github.stop(true);
    }
  });

  test("a new project's GitHub step without a GitHub login says how to fix it", async () => {
    const instance = start(new FakeEngine());

    const result = await instance.createProject({
      name: "Example App",
      description: "",
      status: "active",
      tags: [],
      repository: { type: "standard", visibility: "private" },
      drive: false,
      type: "software",
    });

    expect(result.github).toEqual({ problem: expect.stringContaining("Log in to GitHub") as string });
    expect(result.drive).toBeNull();
  });

  test("a new vibe-coded repository gets the direct fixes, then a Project chat for the rest", async () => {
    const url = "https://github.com/you/example-app";
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ full_name: "you/example-app", clone_url: `${url}.git` }),
    });
    const writes: string[] = [];
    // The new repository is a local remote here, so the chat's clone never reaches GitHub.
    const runner: ProcessRunner = {
      run: (command, options) =>
        fakeGh(systemProcessRunner).run(
          command.map((part) => (part === url ? sandbox.remote : part)),
          options,
        ),
    };
    try {
      const engine = new FakeEngine();
      const instance = start(
        engine,
        {},
        {
          runner,
          secrets: { claudeOauthToken: "oauth-token-value-for-tests", githubToken: "github-token-value" },
          githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
          githubRequest: fakeGithub({
            "guplem/eva": {
              files: { "AGENTS.md": "# Rules\n", ".claude/settings.json": '{"permissions":{"allow":["Read"]}}' },
              labels: ["auto-developing"],
            },
            "you/example-app": { files: { "README.md": "# Example App\n" }, labels: ["bug"] },
          }),
          githubWrite: (method, path) => {
            writes.push(`${method} ${path}`);
            return Promise.resolve({ status: 200, body: "[]" });
          },
        },
      );

      const result = await instance.createProject({
        name: "Example App",
        description: "",
        status: "active",
        tags: [],
        repository: { type: "vibe-coded", visibility: "private" },
        drive: false,
        type: "software",
      });

      expect(result.setup?.problems).toEqual([]);
      expect(writes).toContain("POST repos/you/example-app/labels");
      expect(writes).toContain("DELETE repos/you/example-app/labels/bug");
      const sessionId = result.setup?.sessionId ?? "";
      expect(instance.sessions.get(sessionId)).toMatchObject({ mode: "project", projectId: result.projectId });
      await waitFor(() => engine.requests.length > 0);
      const request = JSON.stringify(engine.requests[0]);
      expect(request).toContain("AGENTS.md");
      expect(request).toContain("Turn on auto-merge for the pull request");
      expect(request).not.toContain("gh label clone");
    } finally {
      await github.stop(true);
    }
  });

  test("a new widget gets the template, Pages and its first deploy, then the chat where the person describes it", async () => {
    const url = "https://github.com/you/example-widget";
    const created: unknown[] = [];
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        created.push(await request.json());
        return Response.json({ full_name: "you/example-widget", clone_url: `${url}.git` });
      },
    });
    const writes: string[] = [];
    const takeEveryFix = fakeGithubWrite();
    const runner: ProcessRunner = {
      run: (command, options) =>
        fakeGh(systemProcessRunner).run(
          command.map((part) => (part === url ? sandbox.remote : part)),
          options,
        ),
    };
    try {
      const engine = new FakeEngine();
      const instance = start(
        engine,
        {},
        {
          runner,
          secrets: { claudeOauthToken: "oauth-token-value-for-tests", githubToken: "github-token-value" },
          githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
          githubRequest: fakeGithub({
            "guplem/eva": {
              files: { "AGENTS.md": "# Rules\n", ".claude/settings.json": '{"permissions":{"allow":["Read"]}}' },
              labels: [],
            },
            // GitHub shows the files of the template once Eva pushed them.
            "you/example-widget": {
              files: widgetTemplate({ owner: "you", repository: "example-widget", title: "Example Widget" }),
              labels: [],
            },
          }),
          githubWrite: (method, path, body) => {
            writes.push(`${method} ${path}`);
            return takeEveryFix(method, path, body);
          },
        },
      );

      const result = await instance.createProject({
        name: "Example Widget",
        description: "",
        status: "active",
        tags: [],
        repository: { type: "widget", visibility: "public" },
        drive: false,
        type: "software",
      });

      expect(created).toEqual([{ name: "example-widget", private: false, auto_init: true }]);
      expect(result.setup?.problems).toEqual([]);
      const tree = writes.indexOf("POST repos/you/example-widget/git/trees");
      const pages = writes.indexOf("POST repos/you/example-widget/pages");
      const deploy = writes.indexOf("POST repos/you/example-widget/actions/workflows/pages.yml/dispatches");
      expect(tree).toBeGreaterThanOrEqual(0);
      expect(pages).toBeGreaterThan(tree);
      expect(deploy).toBeGreaterThan(pages);
      expect(readFileSync(join(vault, "Projects", result.projectId, "AGENTS.md"), "utf-8")).toContain(
        "read `example-widget/AGENTS.md` in the clone",
      );
      const sessionId = result.setup?.sessionId ?? "";
      expect(instance.sessions.get(sessionId)).toMatchObject({ mode: "project", projectId: result.projectId });
      await waitFor(() => engine.requests.length > 0);
      const request = JSON.stringify(engine.requests[0]);
      expect(request).toContain("ask the person what the widget must do");
      expect(request).not.toContain("The setup also left these items");
    } finally {
      await github.stop(true);
    }
  });

  test("a project save refuses a stale version, a bad file and an unknown project", () => {
    const projectId = "2025-03-02-1015-example-app";
    const path = join(vault, "Projects", projectId, "AGENTS.md");
    sandbox.write(vault, `Projects/${projectId}/AGENTS.md`, "---\nstatus: active\n---\n# Example app\n");
    const instance = start(new FakeEngine());
    const { version } = instance.projectFile(projectId);
    writeFileSync(path, "---\nstatus: idea\n---\n# Changed elsewhere\n");
    const details = { title: "Mine", status: "closed" as const, tags: [], repos: [] };

    const codeOf = (action: () => unknown): string | undefined => {
      try {
        action();
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(codeOf(() => instance.saveProjectDetails(projectId, version, details))).toBe("project_changed");
    expect(codeOf(() => instance.saveProjectFile(projectId, version, "---\nstatus: idea\n---\n"))).toBe(
      "project_changed",
    );
    const fresh = instance.projectFile(projectId).version;
    expect(codeOf(() => instance.saveProjectFile(projectId, fresh, "no front matter\n"))).toBe("project_invalid");
    expect(readFileSync(path, "utf-8")).toBe("---\nstatus: idea\n---\n# Changed elsewhere\n");
    expect(codeOf(() => instance.projectFile("2025-01-01-0000-missing"))).toBe("project_not_found");
  });

  test("a whole-file save from a browser keeps the file's Windows line endings", () => {
    const projectId = "2025-03-02-1015-example-app";
    const path = join(vault, "Projects", projectId, "AGENTS.md");
    sandbox.write(vault, `Projects/${projectId}/AGENTS.md`, "---\r\nstatus: active\r\n---\r\n# Example app\r\n");
    const instance = start(new FakeEngine());
    const { version } = instance.projectFile(projectId);
    instance.saveProjectFile(projectId, version, "---\nstatus: idea\n---\n# Example app\n");
    expect(readFileSync(path, "utf-8")).toBe("---\r\nstatus: idea\r\n---\r\n# Example app\r\n");
  });

  test("the report names the clone's branch and pull request, and keeps only the end of a long answer", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const longAnswer = `START${"x".repeat(5_000)}END`;
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "project" ? longAnswer : "Noted."),
    );
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      // gh is faked: the test remote is not on GitHub.
      runner: {
        run: (command, options) =>
          command[0] === "gh"
            ? Promise.resolve({ exitCode: 0, stdout: "42\n", stderr: "" })
            : systemProcessRunner.run(command, options),
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
    });
    const instance = eva;
    instance.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
    });
    const assistantChat = instance.createAssistantSession({ source: "telegram" });
    await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: assistantChat.id,
    });
    await waitFor(() => engine.requests.length === 2, 20_000);
    await instance.idle();
    const report = engine.requests[1]?.prompt ?? "";
    expect(report).toContain("clone clone-0; remote on branch main with pull request #42");
    expect(report).toContain("The full answer is in the project chat.");
    expect(report).toEndWith("END");
    expect(report).not.toContain("START");
  });

  test("a failed project turn is reported as a failure", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine((request) =>
      request.mode === "project" ? [{ kind: "turn_failed", reason: "no login" }] : FakeEngine.answer(request, "ok"),
    );
    const instance = start(engine);
    const assistantChat = instance.createAssistantSession({ source: "cli" });
    await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: assistantChat.id,
    });
    await waitFor(() => engine.requests.length === 2, 20_000);
    await instance.idle();
    expect(engine.requests[1]?.prompt).toContain("It failed: no login");
  });

  test("Eva's own git commands get the GitHub token, and an agent never does (lesson 96)", async () => {
    const environments: Record<string, string>[] = [];
    const engine = new FakeEngine();
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: { githubToken: "github-token-for-tests" },
      engines: [engine],
      runner: {
        run: (command, options) => {
          environments.push({ ...options.environment });
          return systemProcessRunner.run(command, options);
        },
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
    });
    await eva.sweep();
    expect(environments.some((environment) => environment["EVA_GITHUB_TOKEN"] === "github-token-for-tests")).toBe(true);
    const session = eva.createAssistantSession({ source: "cli" });
    await eva.sessions.send(session.id, "hi");
    expect(engine.requests[0]?.environment["EVA_GITHUB_TOKEN"]).toBeUndefined();
  });

  test("the Google MCP server never gets the GitHub token (lesson 96)", async () => {
    const engine = new FakeEngine();
    eva = new Eva({
      paths: homePaths(home),
      config: config({ google: { ...defaultConfig.google, email: "person@example.com", services: ["calendar"] } }),
      secrets: {
        githubToken: "github-token-for-tests",
        googleOauthClientId: "123456789012-clientid.apps.googleusercontent.com",
        googleOauthClientSecret: "google-client-secret-for-tests",
      },
      engines: [engine],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
    });
    const session = eva.createAssistantSession({ source: "cli" });
    await eva.sessions.send(session.id, "hi");
    const google = engine.requests[0]?.mcpServers["google"];
    expect(google?.environment["GOOGLE_OAUTH_CLIENT_ID"]).toBe("123456789012-clientid.apps.googleusercontent.com");
    expect(google?.environment["EVA_GITHUB_TOKEN"]).toBeUndefined();
    expect(Object.values(google?.environment ?? {})).not.toContain("github-token-for-tests");
  });

  test("an agent finds an `eva` command for this instance, and the chat id of its turn", async () => {
    const engine = new FakeEngine();
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      runner: systemProcessRunner,
      processEnvironment: { ...gitEnvironment, PATH: "/usr/bin" },
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      evaCommand: ["/opt/bun", "/opt/eva/src/main.ts"],
    });
    const session = eva.createAssistantSession({ source: "cli" });
    await eva.sessions.send(session.id, "hi");
    const environment = engine.requests[0]?.environment ?? {};
    expect(environment["EVA_HOME"]).toBe(home);
    expect(environment["EVA_INSTANCE"]).toBe(basename(home).slice("eva-".length));
    expect(environment["EVA_SESSION_ID"]).toBe(session.id);
    expect(environment["PATH"]?.startsWith(join(home, "bin"))).toBe(true);
    expect(readFileSync(join(home, "bin", "eva"), "utf8")).toBe(
      "#!/bin/sh\nexec '/opt/bun' '/opt/eva/src/main.ts' \"$@\"\n",
    );
    expect(readFileSync(join(home, "bin", "eva.cmd"), "utf8")).toBe('@"/opt/bun" "/opt/eva/src/main.ts" %*\r\n');
  });

  describe("clone reuse (issue 521)", () => {
    // Not the call that names a chat, which reads its first message too.
    const isFinishedCheck = (request: TurnRequest): boolean =>
      request.mode === "model-call" && (request.appendSystemPrompt ?? "").includes("has finished");
    const projectId = "2025-03-02-1015-example-app";
    const projectFile = (repositories: readonly string[]): string =>
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n${repositories.map((url) => `  - ${url}\n`).join("")}---\n`;
    const newChat = (instance: Eva): Promise<SessionRecord> =>
      instance.createProjectSession({ projectId, source: "cli" });

    beforeEach(() => {
      sandbox.write(vault, `Projects/${projectId}/AGENTS.md`, projectFile([sandbox.remote]));
    });

    test("a chat in a project with two repositories starts above both, and can read each one", async () => {
      sandbox.git(sandbox.root, "clone", "-q", "--bare", sandbox.remote, "example-api.git");
      const api = join(sandbox.root, "example-api.git");
      sandbox.write(vault, `Projects/${projectId}/AGENTS.md`, projectFile([sandbox.remote, api]));
      const engine = new FakeEngine();
      const instance = start(engine);
      const chat = await newChat(instance);
      await instance.sessions.send(chat.id, "fix it");
      const folder = join(vault, "Projects", projectId, "repos", "clone-0");
      expect(engine.requests[0]?.startFolder).toBe(folder);
      for (const repository of ["remote", "example-api"])
        // Git on Windows can turn the line ends of a clone into CRLF, so the test compares the lines only.
        expect(readFileSync(join(folder, repository, "AGENTS.md"), "utf8").split(/\r?\n/)[0]).toBe("# Vault");
      const [clone] = await instance.clones(projectId);
      expect(clone?.repositories.map((repository) => [repository.name, repository.branch])).toEqual([
        ["example-api", "main"],
        ["remote", "main"],
      ]);
    });

    test("a running turn keeps the clone, and a finished chat gives it back: Eva closes the chat", async () => {
      let release: () => void = () => undefined;
      const engine = new FakeEngine(async function* (request) {
        if (request.mode === "project" && request.prompt === "long task")
          await new Promise<void>((resolve) => (release = resolve));
        yield* FakeEngine.answer(request, request.mode === "model-call" ? "FINISHED" : "ok");
      });
      const instance = start(engine);
      const first = await newChat(instance);
      const running = instance.sessions.send(first.id, "long task");
      await waitFor(() => engine.requests.some((request) => request.prompt === "long task"));
      const second = await newChat(instance);
      expect([first.clone, second.clone]).toEqual(["clone-0", "clone-1"]);
      release();
      await running;
      // The second chat has no turn yet: the person may be about to write, so its clone stays with it.
      const third = await newChat(instance);
      expect(third.clone).toBe("clone-0");
      expect(instance.sessions.get(first.id).closed).toBe(true);
      expect(instance.sessions.get(second.id).closed).toBe(false);
      expect(() => instance.sessions.send(first.id, "go on")).toThrow(/closed/);
      const call = engine.requests.find((request) => isFinishedCheck(request) && request.prompt.includes("long task"));
      expect(call?.model).toBe("haiku");
    });

    test("a chat that has not finished keeps its clone, and the model is asked once while it does not change", async () => {
      const engine = new FakeEngine((request) =>
        FakeEngine.answer(request, request.mode === "model-call" ? "NOT FINISHED" : "ok"),
      );
      const instance = start(engine);
      const first = await newChat(instance);
      await instance.sessions.send(first.id, "fix it");
      expect((await newChat(instance)).clone).toBe("clone-1");
      expect((await newChat(instance)).clone).toBe("clone-2");
      const checks = engine.requests.filter((request) => isFinishedCheck(request) && request.prompt.includes("fix it"));
      expect(checks).toHaveLength(1);
      expect(instance.sessions.get(first.id).closed).toBe(false);
    });

    test("work that is not on GitHub keeps the clone, whatever the model says", async () => {
      const instance = start(finishingEngine());
      const first = await newChat(instance);
      await instance.sessions.send(first.id, "fix it");
      const repository = join(first.startFolder, "remote");
      sandbox.write(repository, "draft.txt", "draft\n");
      expect((await newChat(instance)).clone).toBe("clone-1");
      rmSync(join(repository, "draft.txt"));
      sandbox.git(repository, "checkout", "-q", "-b", "feature");
      sandbox.write(repository, "feature.txt", "feature\n");
      sandbox.git(repository, "add", "-A");
      sandbox.git(repository, "commit", "-q", "-m", "feature");
      expect((await newChat(instance)).clone).toBe("clone-2");
      // A file in the clone folder itself is in no repository.
      sandbox.git(repository, "push", "-q", "origin", "feature");
      sandbox.write(first.startFolder, "notes.txt", "notes\n");
      expect((await newChat(instance)).clone).toBe("clone-3");
      expect(instance.sessions.get(first.id).closed).toBe(false);
    });

    test("a reused clone is on the default branch, up to date, keeps ignored files, and gets a new repository", async () => {
      const instance = start(finishingEngine());
      const first = await newChat(instance);
      await instance.sessions.send(first.id, "fix it");
      const repository = join(first.startFolder, "remote");
      // The work of the old chat: a pushed branch, and dependencies that git ignores.
      sandbox.git(repository, "checkout", "-q", "-b", "feature");
      sandbox.write(repository, "feature.txt", "feature\n");
      sandbox.git(repository, "add", "-A");
      sandbox.git(repository, "commit", "-q", "-m", "feature");
      sandbox.git(repository, "push", "-q", "-u", "origin", "feature");
      sandbox.write(repository, ".git/info/exclude", "node_modules/\n");
      sandbox.write(repository, "node_modules/kept.js", "kept\n");
      const other = sandbox.clone("elsewhere");
      sandbox.write(other, "remote.txt", "from elsewhere\n");
      sandbox.git(other, "add", "-A");
      sandbox.git(other, "commit", "-q", "-m", "add remote.txt");
      sandbox.git(other, "push", "-q", "origin", "main");
      sandbox.git(sandbox.root, "clone", "-q", "--bare", sandbox.remote, "example-api.git");
      sandbox.write(
        vault,
        `Projects/${projectId}/AGENTS.md`,
        projectFile([sandbox.remote, join(sandbox.root, "example-api.git")]),
      );
      const next = await newChat(instance);
      expect(next.clone).toBe("clone-0");
      expect(sandbox.git(repository, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
      expect(sandbox.git(repository, "log", "-1", "--format=%s")).toBe("add remote.txt");
      expect(existsSync(join(repository, "feature.txt"))).toBe(false);
      expect(existsSync(join(repository, "node_modules", "kept.js"))).toBe(true);
      expect(existsSync(join(first.startFolder, "example-api", "AGENTS.md"))).toBe(true);
      expect(instance.sessions.get(first.id).closed).toBe(true);
    });

    test("a fetch that fails keeps the chat open, and the new chat gets a new clone", async () => {
      const instance = start(finishingEngine());
      const first = await newChat(instance);
      await instance.sessions.send(first.id, "fix it");
      sandbox.git(join(first.startFolder, "remote"), "remote", "set-url", "origin", join(sandbox.root, "gone.git"));
      expect((await newChat(instance)).clone).toBe("clone-1");
      expect(instance.sessions.get(first.id).closed).toBe(false);
    });

    test("a named clone with an open chat is refused, and one with a closed chat is not", async () => {
      const instance = start(finishingEngine());
      const first = await newChat(instance);
      const named = (): Promise<unknown> =>
        instance
          .createProjectSession({ projectId, cloneName: "clone-0", source: "cli" })
          .catch((caught: unknown) => caught);
      expect(await named()).toMatchObject({ code: "session_busy" });
      await instance.sessions.send(first.id, "fix it");
      instance.sessions.close(first.id);
      // A reset that failed after the close left the clone on the old branch: the named chat resets it too.
      const repository = join(first.startFolder, "remote");
      sandbox.git(repository, "checkout", "-q", "-b", "feature");
      sandbox.git(repository, "push", "-q", "-u", "origin", "feature");
      expect(await named()).toMatchObject({ clone: "clone-0" });
      expect(sandbox.git(repository, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    });
  });

  describe("specialists (#703)", () => {
    const coachId = "2025-03-02-1015-coach";
    const coachFolder = (): string => join(vault, "Projects", coachId);

    beforeEach(() => {
      sandbox.write(
        vault,
        `Projects/${coachId}/AGENTS.md`,
        "---\ncreated: 2025-03-02T10:15\nstatus: active\ntype: specialist\n---\n# Coach\n\nAsk about the training.\n",
      );
    });

    test("a chat starts in the project folder, with no clone, and its file reaches the vault's remote", async () => {
      const engine = new FakeEngine((request) => {
        if (request.mode === "project") writeFileSync(join(request.startFolder, "log.md"), "Monday: legs.\n");
        return FakeEngine.answer(request, "Noted.");
      });
      const instance = start(engine, { sync: syncOn });
      const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
      expect(chat).toMatchObject({ mode: "project", clone: null, startFolder: coachFolder(), projectId: coachId });
      await instance.sessions.send(chat.id, "I trained legs.");
      expect(engine.requests[0]).toMatchObject({
        mode: "project",
        startFolder: coachFolder(),
        projectFolder: coachFolder(),
        appendSystemPrompt: null,
        pluginFolders: [],
        trusted: true,
        harnessMemory: false,
        folderHooks: false,
        fileWall: { area: coachFolder(), ...projectWallRoots(homePaths(home), vault, []) },
      });
      expect(sandbox.git(sandbox.remote, "show", `main:Projects/${coachId}/log.md`)).toBe("Monday: legs.");
    });

    test("a specialist has no clones: a named clone, a fork or a retry in a new clone are refused", async () => {
      const instance = start(new FakeEngine());
      const named = await instance
        .createProjectSession({ projectId: coachId, source: "web", cloneName: "clone-0" })
        .catch((error: unknown) => error);
      expect(isEvaError(named, "project_invalid")).toBe(true);
      const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
      await instance.sessions.send(chat.id, "first");
      const messageId = instance.sessions.get(chat.id).turns[0]!.lastMessageId!;
      const fork = await instance.forkChat(chat.id, messageId, "clean-clone").catch((error: unknown) => error);
      expect(isEvaError(fork, "project_invalid")).toBe(true);
      const retry = await instance.retryChat(chat.id, 0, "new-clone").catch((error: unknown) => error);
      expect(isEvaError(retry, "project_invalid")).toBe(true);
      // A fork in the same place is a branch of the chat, as for an Assistant chat.
      expect((await instance.forkChat(chat.id, messageId)).session).toMatchObject({ clone: null, parentId: chat.id });
      // Every other way to a clone or a repository is refused too, such as a cached page's New clone.
      const steps: (() => Promise<unknown>)[] = [
        () => instance.newClone(coachId),
        () => instance.repositorySetup(coachId),
        () => instance.fixRepository(coachId, sandbox.remote, null),
      ];
      for (const step of steps) {
        const caught = await Promise.resolve()
          .then(step)
          .catch((error: unknown) => error);
        expect(isEvaError(caught, "project_invalid")).toBe(true);
      }
      expect(existsSync(join(coachFolder(), "repos"))).toBe(false);
    });

    test("a specialist outside the vault gets no chat, since the vault sync cannot reach it", async () => {
      const extra = join(home, "elsewhere");
      mkdirSync(join(extra, "2026-01-01-0000-outside"), { recursive: true });
      writeFileSync(
        join(extra, "2026-01-01-0000-outside", "AGENTS.md"),
        "---\ncreated: 2026-01-01T00:00\nstatus: active\ntype: specialist\n---\n# Outside\n",
      );
      const instance = start(new FakeEngine(), { projectRoots: [extra] });
      const caught = await instance
        .createProjectSession({ projectId: "2026-01-01-0000-outside", source: "web" })
        .catch((error: unknown) => error);
      expect(isEvaError(caught, "project_invalid")).toBe(true);
    });

    test("a retry with undo takes back the files that the chat changed, through the vault", async () => {
      const engine = new FakeEngine((request, turnNumber) => {
        if (turnNumber === 1) writeFileSync(join(request.startFolder, "plan.md"), "Week 1.\n");
        return FakeEngine.answer(request, "Done.");
      });
      const instance = start(engine, { sync: syncOn });
      const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
      await instance.sessions.send(chat.id, "Write a plan.");
      expect(await instance.retryUndoPreview(chat.id, 0)).toMatchObject({ restore: [`Projects/${coachId}/plan.md`] });
      // A file that the chat did not change stays.
      sandbox.write(vault, "Notes/other.md", "Kept.\n");
      await instance.retryChat(chat.id, 0, "undo");
      await instance.idle();
      expect(existsSync(join(coachFolder(), "plan.md"))).toBe(false);
      expect(readFileSync(join(vault, "Notes", "other.md"), "utf8")).toBe("Kept.\n");
    });

    test("a chat goes on from a summary in a new chat of the same specialist, with no git state", async () => {
      const engine = new FakeEngine((request) =>
        FakeEngine.answer(request, request.mode === "model-call" ? "Goal: plan the week." : "ok"),
      );
      const instance = start(engine);
      const old = await instance.createProjectSession({ projectId: coachId, source: "web" });
      await instance.sessions.send(old.id, "Plan my week.");
      const { session } = await instance.continueFromSummary(old.id, "web");
      expect(session).toMatchObject({ clone: null, startFolder: coachFolder(), continuedFrom: old.id });
      const call = engine.requests.find((request) => request.mode === "model-call");
      expect(call?.prompt).not.toContain("<git-state>");
    });

    test("project work on a specialist runs a specialist chat, and its result names the specialist", async () => {
      const engine = new FakeEngine((request) =>
        FakeEngine.answer(request, request.mode === "project" ? "The week is planned." : "Noted."),
      );
      const instance = start(engine);
      const asking = instance.createAssistantSession({ source: "web" });
      const work = await instance.startProjectWork({
        projectId: coachId,
        request: "Plan the week.",
        reportToSessionId: asking.id,
      });
      expect(work).toMatchObject({ clone: null, startFolder: coachFolder(), reportsTo: asking.id });
      await waitFor(() => instance.sessions.get(asking.id).turns.length === 1, 20_000);
      await instance.idle();
      expect(engine.requests[1]?.prompt).toContain(`[Project work finished: ${coachId}, specialist, chat ${work.id}]`);
      expect(instance.sessions.get(asking.id).turns[0]?.projectReports).toMatchObject([
        { projectId: coachId, clone: null, repositories: [], result: "The week is planned." },
      ]);
    });

    test("the type changes only while the project has no chat and no clone, so no chat changes its kind", async () => {
      const instance = start(new FakeEngine());
      const details = { title: "Coach", status: "active" as const, tags: [], repos: [] };
      const asSoftware = instance.saveProjectDetails(coachId, instance.projectFile(coachId).version, {
        ...details,
        type: "software",
      });
      expect(asSoftware.details?.type).toBe("software");
      const back = instance.saveProjectDetails(coachId, asSoftware.version, { ...details, type: "specialist" });
      await instance.createProjectSession({ projectId: coachId, source: "web" });
      const caught = (() => {
        try {
          return instance.saveProjectDetails(coachId, back.version, { ...details, type: "software" });
        } catch (error) {
          return error;
        }
      })();
      expect(isEvaError(caught, "project_invalid")).toBe(true);
      // The whole-file editor follows the same rule.
      const edited = back.text.replace("type: specialist\n", "");
      expect(() => instance.saveProjectFile(coachId, back.version, edited)).toThrow("has chats");
    });

    test("a type changed by hand stops a specialist chat, so it never runs at the root of a software project", async () => {
      const engine = new FakeEngine();
      const instance = start(engine);
      const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
      writeFileSync(join(coachFolder(), "AGENTS.md"), "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Coach\n");
      await instance.sessions.send(chat.id, "hi");
      expect(engine.requests).toEqual([]);
      expect(instance.sessions.get(chat.id).turns[0]?.failure).toContain("no specialist any more");
    });

    test("project work on a specialist waits for the asking turn, so two vault turns never overlap", async () => {
      let release: () => void = () => undefined;
      const engine = new FakeEngine(async function* (request) {
        if (request.mode === "assistant" && request.prompt.endsWith("plan it"))
          await new Promise<void>((resolve) => (release = resolve));
        yield* FakeEngine.answer(request, "ok");
      });
      const instance = start(engine);
      const asking = instance.createAssistantSession({ source: "web" });
      const turn = instance.sessions.send(asking.id, "plan it");
      await waitFor(() => engine.requests.length === 1);
      // The Assistant runs `eva work` inside its own turn, which goes on after the command returns.
      const work = await instance.startProjectWork({
        projectId: coachId,
        request: "Plan the week.",
        reportToSessionId: asking.id,
      });
      await Bun.sleep(50);
      expect(engine.requests.map((request) => request.mode)).toEqual(["assistant"]);
      // The waiting chat holds its request, so a delete cannot lose the work or its report.
      expect(instance.sessions.isActive(work.id)).toBe(true);
      expect(() => instance.sessions.delete(work.id)).toThrow();
      release();
      await turn;
      await waitFor(() => engine.requests.some((request) => request.mode === "project"));
      await instance.idle();
    });

    test("a new specialist from the form gets its first chat in its folder", async () => {
      const instance = start(new FakeEngine());
      const result = await instance.createProject({
        name: "Trainer",
        description: "",
        status: "active",
        tags: [],
        repository: null,
        drive: false,
        type: "specialist",
      });
      const chat = result.chat !== null && "sessionId" in result.chat ? result.chat.sessionId : "missing";
      expect(instance.sessions.get(chat)).toMatchObject({
        mode: "project",
        clone: null,
        projectId: result.projectId,
        startFolder: join(vault, "Projects", result.projectId),
      });
    });

    test("a specialist chat takes no file, so it never learns a vault path", async () => {
      const instance = start(new FakeEngine());
      const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
      const caught = await Promise.resolve()
        .then(() => instance.receiveFile("plan.pdf", new Uint8Array([1, 2, 3]), chat.id))
        .catch((error: unknown) => error);
      expect(isEvaError(caught, "file_not_writable")).toBe(true);
      expect((caught as Error).message).toBe("This chat takes no files.");
      expect(existsSync(join(vault, "Scratch", "received"))).toBe(false);
    });
  });

  describe("forks and retries in other clones (issue 523)", () => {
    const projectId = "2025-03-02-1015-example-app";
    const repository = (_instance: Eva, clone: string): string =>
      join(vault, "Projects", projectId, "repos", clone, "remote");
    // Git on Windows can write a restored file with CRLF line ends, so the tests compare LF text.
    const read = (path: string): string | null =>
      existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null;
    const refs = (folder: string): string => sandbox.git(folder, "for-each-ref", "--format=%(refname)", "refs/eva/");

    /** Each Project turn writes `<message>.txt` with its turn number, as an agent edits files. */
    function writingEngine(options: { summary?: string } = {}): FakeEngine {
      let turn = 0;
      return new FakeEngine((request) => {
        if (request.mode === "project") {
          turn += 1;
          // A prompt with a mention holds `:` and new lines, which Windows refuses in a file name.
          const name = request.prompt.replace(/[^\w]+/g, "-");
          writeFileSync(join(request.startFolder, "remote", `${name}.txt`), `turn ${String(turn)}\n`);
        }
        const text = request.mode === "model-call" ? (options.summary ?? "A name") : "ok";
        return FakeEngine.answer(request, text);
      });
    }

    beforeEach(() => {
      sandbox.write(
        vault,
        `Projects/${projectId}/AGENTS.md`,
        `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
      );
    });

    async function chatWithTwoTurns(instance: Eva): Promise<SessionRecord> {
      const chat = await instance.createProjectSession({ projectId, source: "web" });
      await instance.sessions.send(chat.id, "first", "api");
      await instance.sessions.send(chat.id, "second", "api");
      return instance.sessions.get(chat.id);
    }

    test("a fork in a new clone has the files of its answer, and goes on from it", async () => {
      const engine = writingEngine();
      const instance = start(engine);
      const chat = await chatWithTwoTurns(instance);
      const atMessageId = chat.turns[0]!.lastMessageId!;

      const { session, notice } = await instance.forkChat(chat.id, atMessageId, "snapshot-clone");
      expect(notice).toBeNull();
      expect(session).toMatchObject({
        clone: "clone-1",
        parentId: null,
        forkedFrom: { sessionId: chat.id, clone: "clone-0", engineSessionId: chat.engineSessionId, atMessageId },
      });
      expect(read(join(repository(instance, "clone-1"), "first.txt"))).toBe("turn 1\n");
      expect(read(join(repository(instance, "clone-1"), "second.txt"))).toBeNull();
      // The parent keeps its own files.
      expect(read(join(repository(instance, "clone-0"), "second.txt"))).toBe("turn 2\n");

      await instance.sessions.send(session.id, "third");
      const request = engine.requests.findLast((candidate) => candidate.mode === "project");
      expect(request?.startFolder).toBe(join(vault, "Projects", projectId, "repos", "clone-1"));
      expect(request?.history).toEqual({ kind: "fork", fromEngineSessionId: chat.engineSessionId, atMessageId });
    });

    test("a fork in a clean clone starts on the default branch, and leaves the parent's clone alone", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const { session } = await instance.forkChat(chat.id, chat.turns[1]!.lastMessageId!, "clean-clone");
      expect(session.clone).toBe("clone-1");
      expect(read(join(repository(instance, "clone-1"), "first.txt"))).toBeNull();
      expect(instance.sessions.get(chat.id).closed).toBe(false);
    });

    test("a fork in the same clone is a branch of its chat", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const { session } = await instance.forkChat(chat.id, chat.turns[0]!.lastMessageId!, "same-clone");
      expect(session).toMatchObject({ parentId: chat.id, clone: "clone-0" });
    });

    test("a fork at an answer that the chat does not hold is refused", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const error: unknown = await instance
        .forkChat(chat.id, "elsewhere", "clean-clone")
        .catch((caught: unknown) => caught);
      expect(isEvaError(error, "session_not_found")).toBe(true);
    });

    test("an undo retry brings back the files from before the answer, and undoes every later answer", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const { session } = await instance.retryChat(chat.id, 0, "undo");
      await waitFor(() => !instance.sessions.isActive(session.id), 20_000);
      expect(read(join(repository(instance, "clone-0"), "second.txt"))).toBeNull();
      expect(read(join(repository(instance, "clone-0"), "first.txt"))).toBe("turn 3\n");
    });

    test("a retry in a new clone has the files from before the answer, and sends the message again", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const { session } = await instance.retryChat(chat.id, 1, "new-clone");
      await waitFor(() => !instance.sessions.isActive(session.id), 20_000);
      // The person wrote the message, so the retry keeps it theirs.
      expect(instance.sessions.get(session.id).turns[0]).toMatchObject({ userText: "second", fromEva: false });
      expect(read(join(repository(instance, "clone-1"), "first.txt"))).toBe("turn 1\n");
      expect(read(join(repository(instance, "clone-1"), "second.txt"))).toBe("turn 3\n");
      expect(read(join(repository(instance, "clone-0"), "second.txt"))).toBe("turn 2\n");
    });

    test("when the engine cannot take the history along, the new chat starts from a summary", async () => {
      const engine = Object.assign(writingEngine({ summary: "Goal: the fix." }), { carryHistory: () => false });
      const instance = start(engine);
      const chat = await chatWithTwoTurns(instance);
      const before = engine.requests.length;
      const { session, notice } = await instance.retryChat(chat.id, 1, "new-clone");
      expect(notice).toContain("starts from a summary");
      expect(session).toMatchObject({ continuedFrom: chat.id, turns: [], forkFromEngineSessionId: null });
      expect(session.firstMessageDraft).toContain("Goal: the fix.");
      expect(session.firstMessageDraft).toEndWith("second");
      // Only the summary call ran: the person reads the draft before it goes.
      expect(engine.requests.slice(before).every((request) => request.mode === "model-call")).toBe(true);
    });

    test("a fork into another clone keeps the files that the chat was given (#706)", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const given = join(vault, "Projects", projectId, "repos", "clone-0", ".mentions", "Plan-0123456789ab.md");
      mkdirSync(dirname(given), { recursive: true });
      writeFileSync(given, "The plan.");
      for (const files of ["snapshot-clone", "clean-clone"] as const) {
        const { session } = await instance.forkChat(chat.id, chat.turns[0]!.lastMessageId!, files);
        expect(read(join(session.startFolder, ".mentions", "Plan-0123456789ab.md"))).toBe("The plan.");
      }
    });

    test("a reuse counts no given file as work, and removes the given files (#706)", async () => {
      const instance = start(finishingEngine());
      const chat = await instance.createProjectSession({ projectId, source: "web" });
      await instance.sessions.send(chat.id, "done");
      const mentions = join(chat.startFolder, ".mentions");
      mkdirSync(mentions, { recursive: true });
      writeFileSync(join(mentions, "Plan-0123456789ab.md"), "The plan.");
      const next = await instance.createProjectSession({ projectId, source: "web" });
      expect(next.clone).toBe("clone-0");
      expect(existsSync(mentions)).toBe(false);
    });

    test("a summary of a chat in a clone names no vault folder (#706)", async () => {
      const engine = Object.assign(writingEngine({ summary: "Goal: the fix." }), { carryHistory: () => false });
      const instance = start(engine);
      const chat = await instance.createProjectSession({ projectId, source: "web" });
      // The summary covers the turns before the retried one, so the mention goes in the first.
      await instance.sessions.send(chat.id, "first @file:Notes/Plan.md", "api");
      await instance.sessions.send(chat.id, "second", "api");
      expect(instance.sessions.get(chat.id).turns.map((turn) => turn.failure)).toEqual([null, null]);
      const before = engine.requests.length;
      await instance.retryChat(chat.id, 1, "new-clone");
      const summaryCall = engine.requests.slice(before).find((request) => request.mode === "model-call");
      expect(summaryCall?.prompt).toContain("@file:Plan.md");
      expect(summaryCall?.prompt).not.toContain("Notes/");
    });

    test("a reuse of a clone deletes every snapshot in it", async () => {
      const instance = start(finishingEngine());
      const chat = await instance.createProjectSession({ projectId, source: "web" });
      await instance.sessions.send(chat.id, "done");
      const folder = repository(instance, "clone-0");
      expect(refs(folder)).not.toBe("");
      const next = await instance.createProjectSession({ projectId, source: "web" });
      expect(next.clone).toBe("clone-0");
      expect(refs(folder)).toBe("");
    });

    test("a deleted chat takes the snapshots of its turns along", async () => {
      const instance = start(writingEngine());
      const chat = await chatWithTwoTurns(instance);
      const folder = repository(instance, "clone-0");
      expect(refs(folder).split("\n")).toHaveLength(4);
      const { session } = await instance.forkChat(chat.id, chat.turns[0]!.lastMessageId!, "same-clone");
      await instance.sessions.send(session.id, "other");
      instance.sessions.delete(session.id);
      await waitFor(() => refs(folder).split("\n").length === 4);
      instance.sessions.delete(chat.id);
      await waitFor(() => refs(folder) === "");
    });
  });

  test("an Assistant chat goes on in a new Assistant chat that starts from a summary (#522)", async () => {
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "model-call" ? "Goal: plan a trip." : "Rome is lovely."),
    );
    const instance = start(engine);
    const old = instance.createAssistantSession({ source: "web", model: "opus", effort: "high" });
    await instance.sessions.send(old.id, "Plan a trip to Rome", "api");
    const { session, summaryFailure } = await instance.continueFromSummary(old.id, "web");
    expect(summaryFailure).toBeNull();
    expect(session).toMatchObject({
      mode: "assistant",
      engine: "claude-code",
      modelAlias: "opus",
      effort: "high",
      startFolder: vault,
      continuedFrom: old.id,
      turns: [],
    });
    expect(session.firstMessageDraft).toContain("Goal: plan a trip.");
    const call = engine.requests.find((request) => request.mode === "model-call");
    expect(call?.prompt).toContain("Person: Plan a trip to Rome\n\nAgent: Rome is lovely.");
    expect(call?.prompt).not.toContain("<git-state>");
  });

  test("a Project chat goes on in another clone, with the git state in the summary call (#522)", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
    );
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "model-call" ? "Goal: fix login." : "Fixed."),
    );
    const instance = start(engine);
    const old = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "web",
    });
    await instance.sessions.send(old.id, "fix login, see @file:Notes/Login.md");
    const { session } = await instance.continueFromSummary(old.id, "web");
    expect(session).toMatchObject({
      mode: "project",
      projectId: "2025-03-02-1015-example-app",
      clone: "clone-1",
      continuedFrom: old.id,
    });
    const call = engine.requests.find((request) => request.mode === "model-call");
    expect(call?.prompt).toContain("<git-state>\nRepository remote:\n## main...origin/main");
    // The summary starts a chat in a clone, so it names no vault folder (#706).
    expect(call?.prompt).toContain("@file:Login.md");
    expect(call?.prompt).not.toContain("Notes/");
  });

  test("a chat deleted while its summary is written opens no new chat (#522)", async () => {
    let oldId = "";
    const engine = new FakeEngine((request) => {
      if (request.mode === "model-call") eva?.sessions.delete(oldId);
      return FakeEngine.answer(request, "Goal: something.");
    });
    const instance = start(engine);
    oldId = instance.createAssistantSession({ source: "web" }).id;
    await instance.sessions.send(oldId, "Hello");
    const error: unknown = await instance.continueFromSummary(oldId, "web").catch((caught: unknown) => caught);
    expect(isEvaError(error, "session_not_found")).toBe(true);
    expect(instance.sessions.list()).toHaveLength(0);
  });

  test("a failed summary still opens the new chat, with the link, no draft and the reason (#522)", async () => {
    const engine = new FakeEngine((request) =>
      request.mode === "model-call"
        ? [{ kind: "turn_failed", reason: "Rate limited." }]
        : FakeEngine.answer(request, "Sure."),
    );
    const instance = start(engine);
    const old = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(old.id, "Hello");
    const { session, summaryFailure } = await instance.continueFromSummary(old.id, "web");
    expect(summaryFailure).toBe("Rate limited.");
    expect(session).toMatchObject({ continuedFrom: old.id, firstMessageDraft: null });
  });

  test("an unknown project is an EvaError", async () => {
    const instance = start(new FakeEngine());
    const error: unknown = await instance
      .createProjectSession({ projectId: "2020-01-01-0000-missing", source: "cli" })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("2020-01-01-0000-missing");
  });

  test("lists and searches the vault's projects", () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n",
    );
    const instance = start(new FakeEngine());
    expect(instance.projects({ text: "example" }).map((project) => project.id)).toEqual([
      "2025-03-02-1015-example-app",
    ]);
  });

  test("the idle sweep saves a change made outside a turn", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/Diary/2026-10-14.md", "Written by hand.\n");
    await instance.sweep();
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Life/Diary/2026-10-14.md");
  });

  test("each turn end goes to the log, with the cache counts of a finished turn (lesson 120)", async () => {
    const lines: string[] = [];
    const instance = start(
      new FakeEngine((request, turnNumber) => {
        if (turnNumber === 1) return FakeEngine.answer(request, "done");
        throw new Error("the engine broke");
      }),
      {},
      { logger: { log: (level, message, details) => lines.push(`${level} ${message} ${JSON.stringify(details)}`) } },
    );
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "hi");
    await instance.sessions.send(session.id, "again");
    const turnLines = lines.filter((line) => line.includes("A turn"));
    expect(turnLines[0]).toStartWith(`info A turn finished. {"sessionId":"${session.id}"`);
    expect(turnLines[0]).toContain("cacheReadTokens");
    expect(turnLines[1]).toStartWith(`warn A turn failed. {"sessionId":"${session.id}","reason":`);
  });
  test("a sync failure and a held-back secret file go to the log (lessons 16, 26)", async () => {
    const lines: string[] = [];
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      logger: { log: (level, message, details) => lines.push(`${level} ${message} ${JSON.stringify(details)}`) },
    });
    sandbox.write(vault, "Notes/keys.md", "token ghp_" + "a".repeat(36) + "\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain("held back files");
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    sandbox.write(vault, "Notes/other.md", "more\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain('warn Vault sync failed. {"status":"offline"');
  });

  test("the background tick removes old Scratch files and old logs once a day, also with sync off", async () => {
    sandbox.write(vault, "Scratch/old.pdf", "old");
    let logCleanups = 0;
    eva = new Eva({
      paths: homePaths(home),
      config: config({ sync: syncOff }),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      removeOldLogs: () => {
        logCleanups += 1;
      },
    });
    clock = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    await eva.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
    expect(logCleanups).toBe(1);
    await eva.backgroundTick();
    expect(logCleanups).toBe(1);
    clock = new Date(clock.getTime() + 24 * 60 * 60_000);
    await eva.backgroundTick();
    expect(logCleanups).toBe(2);
  });

  test("the Scratch cleanup waits while an Assistant turn runs (lessons 22, 30)", async () => {
    sandbox.write(vault, "Scratch/old.pdf", "old");
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine, { sync: syncOff });
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    clock = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    await instance.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(true);
    release();
    await turn;
    await instance.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
  });

  test("a second idle sweep never starts while one runs", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Notes/local.md", "local\n");
    const first = instance.sweep();
    expect(await instance.sweep()).toBe("skipped");
    expect(await first).toBe("ok");
  });

  test("a second background tick never starts while one runs", async () => {
    let checks = 0;
    eva = new Eva({
      paths: homePaths(home),
      config: config({ sync: syncOn }),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      updateChannel: {
        kind: "source",
        check: () => {
          checks += 1;
          return Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false, releases: null });
        },
        apply: () => Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false, releases: null }),
      },
    });
    // The first tick waits on its vault fetch; a second tick at that moment must do nothing.
    const first = eva.backgroundTick();
    await eva.backgroundTick();
    expect(checks).toBe(0);
    await first;
    expect(checks).toBe(1);
  });

  test("a stale check asks the update channel again at most once an hour, and after a failure every 10 minutes", async () => {
    let checks = 0;
    let offline = false;
    eva = new Eva({
      paths: homePaths(home),
      config: config({ sync: syncOn }),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      updateChannel: {
        kind: "executable",
        check: () => {
          checks += 1;
          if (offline) return Promise.reject(new Error("offline"));
          return Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: [] });
        },
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: [] }),
      },
    });
    // The frequency can be off, so the first look of a page asks the channel.
    expect((await eva.checkForUpdateIfStale())?.latest).toBe("0.2.0");
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(1);
    clock = new Date(clock.getTime() + 61 * 60_000);
    offline = true;
    expect((await eva.checkForUpdateIfStale())?.lastError).toBe("offline");
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(2);
    clock = new Date(clock.getTime() + 11 * 60_000);
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(3);
  });

  test("an update waits for a message that is still gathering, then installs (lesson 92)", async () => {
    const restarts: string[] = [];
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 50,
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    const session = eva.createAssistantSession({ source: "schedule" });
    const turn = eva.sessions.send(session.id, "Plan my day.");
    expect((await eva.updateNow())?.phase).toBe("waiting_for_idle");
    await turn;
    await eva.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("the engine update runs `claude update` with the engine's config folder and no token (lesson 96)", async () => {
    const claudeRuns: { command: string; environment: Readonly<Record<string, string>> }[] = [];
    let version = "2.1.0";
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        claudeRuns.push({ command: command.join(" "), environment: options.environment });
        if (command[1] === "update") version = "2.2.0";
        return Promise.resolve({ exitCode: 0, stdout: `${version} (Claude Code)\n`, stderr: "" });
      },
    };
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: { claudeOauthToken: "oauth-token-value-for-tests", githubToken: "github-token-value-for-tests" },
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
    });
    expect(eva.engineUpdateStatus()).toEqual({ phase: "idle", last: null });
    expect(eva.updateEngine()?.phase).toBe("updating");
    const instance = eva;
    await waitFor(() => instance.engineUpdateStatus()?.phase === "idle");
    expect(instance.engineUpdateStatus()?.last).toMatchObject({ outcome: "updated", after: "2.2.0" });
    expect(claudeRuns.map((run) => run.command)).toEqual([
      "/opt/claude --version",
      "/opt/claude update",
      "/opt/claude --version",
    ]);
    for (const run of claudeRuns) {
      expect(run.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
      expect(Object.values(run.environment)).not.toContain("github-token-value-for-tests");
      expect(Object.values(run.environment)).not.toContain("oauth-token-value-for-tests");
    }
  });

  test("the engine update waits for a running turn, and Eva's own update waits for the engine update", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const finishUpdateGate: { open: (() => void) | null } = { open: null };
    const runner: ProcessRunner = {
      run: async (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        if (command[1] === "update") await new Promise<void>((resolve) => (finishUpdateGate.open = resolve));
        return { exitCode: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
      },
    };
    const restarts: string[] = [];
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      claudeExecutable: "/opt/claude",
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    eva = instance;
    const turn = instance.sessions.send(instance.createAssistantSession({ source: "cli" }).id, "go");
    await waitFor(() => engine.requests.length >= 1);
    expect(instance.updateEngine()?.phase).toBe("waiting_for_idle");
    release();
    await turn;
    // The engine update runs apart, so the tick never waits for its download.
    await instance.backgroundTick();
    expect(instance.engineUpdateStatus()?.phase).toBe("updating");
    expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
    await waitFor(() => finishUpdateGate.open !== null);
    finishUpdateGate.open?.();
    await waitFor(() => instance.engineUpdateStatus()?.phase === "idle");
    expect(instance.engineUpdateStatus()?.last?.outcome).toBe("up_to_date");
    await instance.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("gives her own version and the version of each tool, from the claude program that she runs", async () => {
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] === "/opt/claude")
          return Promise.resolve({ exitCode: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" });
        // The other tools are missing, so the answer does not depend on this machine.
        if (command.length === 2 && ["--version", "-version", "--help", "version"].includes(command[1] ?? ""))
          return Promise.reject(new Error("not found"));
        return systemProcessRunner.run(command, options);
      },
    };
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
      toolPlaces: { platform: "linux", userHome: "/srv/person", standalone: true },
    });
    eva = instance;
    const versions = await instance.versions();
    expect(versions.eva).toBe(instance.status().version);
    expect(versions.tools.find((tool) => tool.program === "claude")?.version).toBe("2.1.300");
    expect(versions.tools.find((tool) => tool.program === "git")?.version).toBeNull();
    expect(versions.tools.some((tool) => tool.program === "bun")).toBe(false);
  });

  test("the latest tool versions come from the sources; a found one waits an hour, and a failure 10 minutes", async () => {
    const asked: string[] = [];
    let piAnswers = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const path = new URL(request.url).pathname;
        asked.push(path);
        if (path === "/@anthropic-ai/claude-code/latest") return Response.json({ version: "2.1.310" });
        if (path === "/repos/earendil-works/pi/releases/latest" && piAnswers)
          return Response.json({ tag_name: "v1.4.0" });
        return new Response("down", { status: 503 });
      },
    });
    const base = `http://127.0.0.1:${String(server.port)}`;
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolLatestSources: { npmBaseUrl: base, githubApiBaseUrl: base },
      });
      eva = instance;
      // Two reads at once share one lookup of each tool.
      const [first] = await Promise.all([instance.latestToolVersions(), instance.latestToolVersions()]);
      expect(first).toEqual([
        { program: "claude", latest: "2.1.310" },
        { program: "pi", latest: null },
        { program: "uv", latest: null },
        { program: "gh", latest: null },
      ]);
      expect(asked).toHaveLength(4);
      // A failure waits 10 minutes; a found version waits an hour.
      asked.length = 0;
      piAnswers = true;
      expect((await instance.latestToolVersions()).find((tool) => tool.program === "pi")?.latest).toBeNull();
      expect(asked).toHaveLength(0);
      clock = new Date(clock.getTime() + 11 * 60_000);
      const second = await instance.latestToolVersions();
      expect(second.find((tool) => tool.program === "pi")?.latest).toBe("1.4.0");
      expect(asked).not.toContain("/@anthropic-ai/claude-code/latest");
      asked.length = 0;
      clock = new Date(clock.getTime() + 61 * 60_000);
      await instance.latestToolVersions();
      expect(asked).toContain("/@anthropic-ai/claude-code/latest");
      expect(asked).toContain("/repos/earendil-works/pi/releases/latest");
      // Claude Code on the stable channel reads the stable tag.
      mkdirSync(join(home, "engines", "claude"), { recursive: true });
      writeFileSync(join(home, "engines", "claude", "settings.json"), JSON.stringify({ autoUpdatesChannel: "stable" }));
      asked.length = 0;
      await instance.latestToolVersions();
      expect(asked).toContain("/@anthropic-ai/claude-code/stable");
    } finally {
      await server.stop(true);
    }
  });

  test("the Updates page installs a tool, one at a time, and a failure gives the steps", async () => {
    const release = serveGhRelease();
    const runner = ghInstallRunner(systemProcessRunner, { version: null });
    const options = (ghReleaseUrl: string): EvaOptions => ({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      toolPlaces: { platform: "linux", userHome: home, standalone: false },
      toolInstall: { arch: "x64", ghReleaseUrl },
    });
    try {
      const instance = new Eva(options(release.url));
      eva = instance;
      const [first, second] = await Promise.all([instance.installTool("gh"), instance.installTool("gh")]);
      expect(first).toEqual({ ok: true, message: "Installed gh." });
      expect(second).toEqual({ ok: false, message: "Eva is installing another tool. Try again when it is done." });
      expect(runner.installs).toBe(1);
      instance.stop();
      const offline = new Eva(options("http://127.0.0.1:1/latest"));
      eva = offline;
      const failed = await offline.installTool("gh");
      expect(failed.ok).toBe(false);
      expect(failed.message).toContain("Eva could not install gh");
      expect(failed.message).toContain("https://cli.github.com");
    } finally {
      await release.stop();
    }
  });

  test("Eva's own update waits for a running tool install, then restarts (#565)", async () => {
    const release = serveGhRelease();
    const ghRunner = ghInstallRunner(systemProcessRunner, { version: null });
    const unpackGate: { open: (() => void) | null } = { open: null };
    const runner: ProcessRunner = {
      run: async (command, options) => {
        if (command[0] === "tar") await new Promise<void>((resolve) => (unpackGate.open = resolve));
        return ghRunner.run(command, options);
      },
    };
    const restarts: string[] = [];
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolPlaces: { platform: "linux", userHome: home, standalone: false },
        toolInstall: { arch: "x64", ghReleaseUrl: release.url },
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
        restartForUpdate: () => restarts.push("restart"),
      });
      eva = instance;
      const installing = instance.installTool("gh");
      await waitFor(() => unpackGate.open !== null);
      expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
      await instance.backgroundTick();
      expect(restarts).toEqual([]);
      unpackGate.open?.();
      expect((await installing).ok).toBe(true);
      await instance.backgroundTick();
      expect(restarts).toEqual(["restart"]);
    } finally {
      await release.stop();
    }
  });

  test("the Updates page lists what voice notes lack, and one install adds each part", async () => {
    const archive = new TextEncoder().encode("a pretend archive");
    const archiveHash = createHash("sha256").update(archive).digest("hex");
    const model = new TextEncoder().encode("a pretend whisper model");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const base = `http://127.0.0.1:${String(server.port)}`;
        const path = new URL(request.url).pathname;
        const release = (name: string): object => ({
          assets: [{ name, browser_download_url: `${base}/files/${name}`, digest: `sha256:${archiveHash}` }],
        });
        if (path === "/ffmpeg") return Response.json(release("ffmpeg-master-latest-linux64-gpl.tar.xz"));
        // whisper.cpp: the list of its recent releases, as GitHub gives it.
        if (path === "/whisper") return Response.json([release("whisper-bin-ubuntu-x64.tar.gz")]);
        if (path === "/model") return new Response(model);
        return new Response(archive);
      },
    });
    let installs = 0;
    const runner: ProcessRunner = {
      run: (command, options) => {
        const program = command[0] ?? "";
        if (program === "tar") {
          installs += 1;
          const target = command[command.indexOf("-C") + 1] ?? "";
          const file = (command[2] ?? "").includes("ffmpeg") ? join("build", "bin", "ffmpeg") : "whisper-cli";
          mkdirSync(join(target, file, ".."), { recursive: true });
          writeFileSync(join(target, file), "pretend program");
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        // Only Eva's own copies answer, so the answer does not depend on this machine.
        if (command.length === 2 && ["--version", "-version", "--help", "version"].includes(command[1] ?? ""))
          return existsSync(program)
            ? Promise.resolve({ exitCode: 0, stdout: "version 7.1\n", stderr: "" })
            : Promise.reject(new Error("not found"));
        return systemProcessRunner.run(command, options);
      },
    };
    const base = `http://127.0.0.1:${String(server.port)}`;
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolPlaces: { platform: "linux", userHome: home, standalone: false },
        toolInstall: {
          arch: "x64",
          ffmpegReleaseUrl: `${base}/ffmpeg`,
          whisperReleaseUrl: `${base}/whisper`,
          voiceModelUrl: `${base}/model`,
          voiceModelSha256: createHash("sha256").update(model).digest("hex"),
        },
      });
      eva = instance;
      expect((await instance.versions()).voiceNotes).toEqual({
        missing: ["ffmpeg", "whisper-cli", "speech model"],
        on: false,
      });
      expect(await instance.installVoiceNotes()).toEqual({
        ok: true,
        message: "Installed voice notes. Press Restart Eva to turn them on.",
      });
      expect(readFileSync(join(home, "voice", "ggml-base.bin"), "utf8")).toBe("a pretend whisper model");
      const after = await instance.versions();
      expect(after.voiceNotes).toEqual({ missing: [], on: false });
      expect(after.tools.find((tool) => tool.program === "ffmpeg")?.version).toBe("7.1");
      // Nothing is missing, so a second press downloads nothing.
      expect((await instance.installVoiceNotes()).ok).toBe(true);
      expect(installs).toBe(2);
    } finally {
      await server.stop(true);
    }
  });

  test("an engine update pressed during Eva's own install runs before her restart", async () => {
    const finishInstallGate: { open: (() => void) | null } = { open: null };
    const claudeRuns: string[] = [];
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        claudeRuns.push(command.join(" "));
        return Promise.resolve({ exitCode: 0, stdout: "2.1.0\n", stderr: "" });
      },
    };
    const restarts: string[] = [];
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      claudeExecutable: "/opt/claude",
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: async () => {
          await new Promise<void>((resolve) => (finishInstallGate.open = resolve));
          return { current: "0.1.0", latest: "0.2.0", available: false, releases: null };
        },
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    eva = instance;
    const installing = instance.updateNow();
    await waitFor(() => finishInstallGate.open !== null);
    expect(instance.updateEngine()?.phase).toBe("waiting_for_idle");
    finishInstallGate.open?.();
    await installing;
    expect(claudeRuns).toEqual([]);
    // The waiting engine update holds the restart, or the restart would lose it.
    expect(restarts).toEqual([]);
    await instance.backgroundTick();
    await waitFor(() => instance.engineUpdateStatus()?.last !== null);
    expect(claudeRuns).toEqual(["/opt/claude --version", "/opt/claude update", "/opt/claude --version"]);
    await instance.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("an update waits while a schedule fires, before its chat gets the prompt (lesson 92)", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(
      new FakeEngine(),
      {},
      {
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
      },
    );
    const releaseGate: { open: (() => void) | null } = { open: null };
    // The first check sends the setup card; a slow card send keeps the check running.
    const unsubscribe = instance.schedules?.subscribe(
      () =>
        new Promise<boolean>((resolve) => {
          releaseGate.open = () => resolve(true);
        }),
    );
    const check = instance.schedules?.tick();
    await waitFor(() => releaseGate.open !== null);
    expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
    unsubscribe?.();
    releaseGate.open?.();
    await check;
  });

  test("an Eva with no claude program has no engine update", () => {
    const instance = start(new FakeEngine());
    expect(instance.engineUpdateStatus()).toBeNull();
    expect(instance.updateEngine()).toBeNull();
  });

  test("voice notes stay off until a whisper model is configured", () => {
    expect(start(new FakeEngine()).transcribe).toBeNull();
    const voice = { ...defaultConfig.voice, modelPath: "/models/ggml-base.bin" };
    expect(start(new FakeEngine(), { voice }).transcribe).toBeInstanceOf(Function);
  });

  test("the idle sweep waits while an Assistant turn runs (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    sandbox.write(vault, "half.md", "half written\n");
    expect(await instance.sweep()).toBe("skipped");
    release();
    await turn;
  });

  test("events reach a subscriber", async () => {
    const instance = start(new FakeEngine());
    const events: SessionEvent[] = [];
    instance.sessions.subscribe((event) => events.push(event));
    await instance.sessions.send(instance.createAssistantSession({ source: "cli" }).id, "hi");
    expect(events.map((event) => event.kind)).toEqual(["message_received", "text", "turn_finished"]);
  });

  test("with no vault configured, Eva still starts and says so", () => {
    eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      gatherMs: 5,
    });
    expect(eva.status().vaultPath).toBeNull();
    expect(() => eva?.createAssistantSession({ source: "cli" })).toThrow("vault");
    // The page and Telegram read this text too, and neither can run a terminal command.
    expect(() => eva?.createAssistantSession({ source: "web" })).toThrow(
      "Finish the setup in Settings, on Eva's page.",
    );
  });
});

describe("Eva alerts", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }

  test("a vault conflict raises an alert that names the phone fix, and the last pick clears it", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, "Notes/plan.md", "theirs\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    sandbox.write(vault, "Notes/plan.md", "mine\n");
    expect(await instance.sweep()).toBe("conflict");
    expect(alerts.at(-1)?.message).toContain("/conflicts");
    expect((await instance.vaultConflicts()).conflicts.map((conflict) => conflict.path)).toEqual(["Notes/plan.md"]);
    const result = await instance.resolveVaultConflict("Notes/plan.md", "mine");
    expect(result.state.status).toBe("ok");
    expect(alerts.at(-1)?.level).toBe("resolved");
  });

  test("a pick waits while an Assistant turn runs, like a sync (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    const result = await instance.resolveVaultConflict("Notes/plan.md", "mine");
    expect(result.found).toBe(false);
    expect(result.state.status).toBe("skipped");
    expect(result.state.lastError).toContain("an Assistant or specialist chat");
    release();
    await turn;
  });

  test("a sync during an Assistant turn, or with no vault, says why it skipped, in a field a client can read", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    const busy = await instance.syncVault();
    expect([busy.status, busy.skipReason]).toEqual(["skipped", "assistant_busy"]);
    release();
    await turn;
    expect((await instance.syncVault()).skipReason).toBeUndefined();
    const bare = start(new FakeEngine(), { vaultPath: null });
    expect((await bare.syncVault()).skipReason).toBe("no_vault");
  });

  test("a sync also waits while a specialist chat runs a turn, since it works in the vault (#703)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.sessions.createSession({
      mode: "project",
      engine: "claude-code",
      startFolder: join(vault, "Projects", "2025-03-02-1015-coach"),
      source: "web",
      projectId: "2025-03-02-1015-coach",
    });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    expect((await instance.syncVault()).skipReason).toBe("assistant_busy");
    release();
    await turn;
    expect((await instance.syncVault()).skipReason).toBeUndefined();
  });

  test("with no vault, there is no conflict to list or resolve", async () => {
    const instance = start(new FakeEngine(), { vaultPath: null });
    expect((await instance.vaultConflicts()).conflicts).toEqual([]);
    expect((await instance.resolveVaultConflict("a.md", "mine")).found).toBe(false);
  });

  test("a vault offline for more than 30 minutes is a problem, and a good sync clears it", async () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    expect((await instance.syncVault()).status).toBe("offline");
    clock = new Date(clock.getTime() + 20 * 60_000);
    await instance.syncVault();
    expect(alerts).toEqual([]);
    clock = new Date(clock.getTime() + 11 * 60_000);
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["vault_sync", "warn"]]);
    expect(instance.status().problems).toHaveLength(1);
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    expect((await instance.syncVault()).status).toBe("ok");
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a sync error that names a secret reaches the status with the secret hidden (#447)", async () => {
    const secret = "github-token-value-for-tests";
    const instance = start(new FakeEngine(), {}, { secrets: { githubToken: secret } });
    // Git names the remote in its error, and a remote address can hold a token.
    sandbox.git(vault, "remote", "set-url", "origin", join(home, secret, "missing.git"));
    const state = await instance.syncVault();
    expect(state.status).toBe("offline");
    expect(state.lastError).toContain("[redacted]");
    expect(state.lastError).not.toContain(secret);
    expect(instance.status().vaultSync.lastError).not.toContain(secret);
  });

  test("a check that fails for 2 hours and a failed install each raise an alert that names the step", async () => {
    let failCheck = true;
    const instance = start(
      new FakeEngine(),
      {},
      {
        updateChannel: {
          kind: "source",
          check: () =>
            failCheck
              ? Promise.reject(new Error("no network"))
              : Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: true, releases: null }),
          apply: () => Promise.reject(new Error("bun install failed")),
        },
      },
    );
    const alerts = collectAlerts(instance);
    await instance.checkForUpdate();
    // One failed check is often a laptop that woke up with no network (#541).
    expect(alerts).toEqual([]);
    clock = new Date(clock.getTime() + 2 * 60 * 60_000);
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.message).toStartWith(
      "Eva could not check for updates for 2 hours or more. The last error: no network.",
    );
    failCheck = false;
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.level).toBe("resolved");
    await instance.updateNow();
    expect(alerts.at(-1)?.message).toStartWith("Eva could not install the update: bun install failed.");
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await instance.backgroundTick();
    expect(instance.status().problems[0]).toStartWith("Eva could not install the update");
  });

  test("each new held-back release reaches the phone once, even across a restart", async () => {
    let releases = [{ version: "1.0.0", notes: "## Breaking changes\n\n- feat!: rename the keys\n" }];
    const options: Partial<EvaOptions> = {
      updateChannel: {
        kind: "executable",
        check: () =>
          Promise.resolve({ current: "0.2.0", latest: releases[0]?.version ?? "", available: true, releases }),
        apply: () => Promise.reject(new Error("not in this test")),
      },
    };
    const first = start(new FakeEngine(), {}, options);
    const alerts = collectAlerts(first);
    await first.checkForUpdate();
    await first.checkForUpdate();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["update_held_back", "news"]]);
    expect(alerts[0]?.message).toContain("1.0.0");
    expect(alerts[0]?.message).toContain("can break");
    first.stop();
    const second = start(new FakeEngine(), {}, options);
    const later = collectAlerts(second);
    await second.checkForUpdate();
    expect(later).toEqual([]);
    releases = [{ version: "1.1.0", notes: "" }, ...releases];
    await second.checkForUpdate();
    expect(later).toHaveLength(1);
    expect(later[0]?.message).toContain("1.1.0");
  });

  test("a failed engine update reaches the phone as an alert, and a good one clears it", async () => {
    let refuse = true;
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: { githubToken: "secret-value-for-tests" },
      engines: [new FakeEngine()],
      runner: {
        run: (command) =>
          Promise.resolve(
            command[1] === "update" && refuse
              ? { exitCode: 1, stdout: "", stderr: "Installed with npm. Token secret-value-for-tests.\n" }
              : { exitCode: 0, stdout: "2.1.0\n", stderr: "" },
          ),
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
    });
    eva = instance;
    const alerts = collectAlerts(instance);
    instance.updateEngine();
    await waitFor(() => alerts.length >= 1);
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["engine_update", "warn"]]);
    expect(alerts[0]?.message).toStartWith("The Claude Code update failed: Installed with npm.");
    expect(alerts[0]?.message).not.toContain("secret-value-for-tests");
    expect(instance.engineUpdateStatus()?.last?.detail).not.toContain("secret-value-for-tests");
    // A tick with no waiting update never reports the old failure again, not even a day later.
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await instance.backgroundTick();
    expect(alerts).toHaveLength(1);
    refuse = false;
    // The answer to a press still carries the old result while the new run starts.
    expect(instance.updateEngine()?.last?.detail).not.toContain("secret-value-for-tests");
    await waitFor(() => alerts.length >= 2);
    expect(alerts[1]?.level).toBe("resolved");
  });

  test("a schedule that fails to fire raises an alert named after the schedule", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    // The chat list cannot be saved, so the firing's chat cannot start.
    mkdirSync(join(home, "state", "sessions.json"), { recursive: true });
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    expect(alerts.map((alert) => alert.key)).toEqual(["schedule:lunch"]);
    expect(alerts[0]?.message).toContain("Lunch");
  });

  test("a scheduled prompt whose turn fails raises the schedule's alert", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine(() => [{ kind: "turn_failed", reason: "You hit the usage limit." }]));
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    await waitFor(() => alerts.some((alert) => alert.key === "schedule:lunch"));
    expect(alerts.find((alert) => alert.key === "schedule:lunch")?.message).toContain("You hit the usage limit.");
    expect(instance.schedules?.list().schedules[0]?.lastRun).toMatchObject({ failed: true });
  });

  test("a scheduled turn that the person stops raises no alert, and the run counts as good", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          resolve();
        });
      });
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const instance = start(engine);
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    const [session] = instance.sessions.list();
    instance.sessions.stop(session?.id ?? "");
    await instance.idle();
    await Bun.sleep(0);
    expect(alerts.filter((alert) => alert.key === "schedule:lunch")).toEqual([]);
    expect(instance.schedules?.list().schedules[0]?.lastRun).toMatchObject({ failed: false });
  });

  test("a card that no front end showed is a problem in the status until a front end shows it (lesson 66)", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    await instance.schedules?.tick();
    expect(instance.status().problems).toEqual([expect.stringContaining("Lunch")]);
    expect(alerts.map((alert) => alert.key)).toEqual(["schedule_card:lunch"]);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    expect(instance.status().problems).toEqual([]);
  });

  test("a front end reports its own problem, and the status carries it", () => {
    const instance = start(new FakeEngine());
    instance.reportProblem("telegram_poll", {
      level: "error",
      message: "Another program polls the bot.",
      resolvedMessage: "Telegram works again.",
    });
    expect(instance.status().problems).toEqual(["Another program polls the bot."]);
    // The web page picks the button of a problem from its key, never from its text.
    expect(instance.status().problemDetails).toEqual([
      {
        key: "telegram_poll",
        level: "error",
        message: "Another program polls the bot.",
        hidden: false,
        since: expect.any(String) as string,
      },
    ]);
    instance.reportProblem("telegram_poll", null);
    expect(instance.status().problems).toEqual([]);
    expect(instance.status().problemDetails).toEqual([]);
  });

  test("a hidden problem stays hidden after a restart, and only an open problem can be hidden (#541)", () => {
    const problem = { level: "warn", message: "The bot is slow.", resolvedMessage: "Telegram works again." } as const;
    const first = start(new FakeEngine());
    first.reportProblem("telegram_poll", problem);
    expect(first.hideProblem("telegram_poll")).toBe(true);
    expect(first.status().problemDetails[0]?.hidden).toBe(true);
    expect(first.hideProblem("vault_sync")).toBe(false);
    first.stop();
    const second = start(new FakeEngine());
    const alerts = collectAlerts(second);
    second.reportProblem("telegram_poll", problem);
    expect(alerts).toEqual([]);
    expect(second.status().problemDetails).toEqual([
      {
        key: "telegram_poll",
        level: "warn",
        message: "The bot is slow.",
        hidden: true,
        since: expect.any(String) as string,
      },
    ]);
  });

  test("the notification history survives a restart, and the person marks entries as read (#566)", () => {
    const problem = { level: "warn", message: "The bot is slow.", resolvedMessage: "Telegram works again." } as const;
    const first = start(new FakeEngine());
    first.reportProblem("telegram_poll", problem);
    first.reportProblem("telegram_poll", null);
    expect(first.status().problemDetails).toEqual([]);
    first.reportProblem("vault_sync", problem);
    const startedAt = first.status().problemDetails[0]?.since;
    first.stop();
    const second = start(new FakeEngine());
    second.reportProblem("vault_sync", problem);
    expect(second.status().problemDetails[0]?.since).toBe(startedAt);
    const entries = second.notifications().entries;
    expect(entries.map((entry) => `${entry.key}:${entry.level}`)).toEqual([
      "telegram_poll:warn",
      "telegram_poll:resolved",
      "vault_sync:warn",
    ]);
    expect(second.markNotificationsRead({ seqs: [entries[0]?.seq ?? 0] }).entries.map((entry) => entry.read)).toEqual([
      true,
      false,
      false,
    ]);
    const all = second.markNotificationsRead({ all: true });
    expect(all.entries.every((entry) => entry.read)).toBe(true);
    expect(second.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("an expired engine login is a problem with its own key until a turn of that engine works", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 1
        ? [{ kind: "turn_failed", reason: "The login expired.", loginExpired: true }]
        : FakeEngine.answer(request, "ok"),
    );
    const instance = start(engine);
    const alerts = collectAlerts(instance);
    const chat = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([
      {
        key: "engine_login:claude-code",
        level: "error",
        message: expect.stringContaining("Claude Code login") as string,
        hidden: false,
        since: expect.any(String) as string,
      },
    ]);
    await instance.sessions.send(chat.id, "hello again");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([]);
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["engine_login:claude-code", "error"],
      ["engine_login:claude-code", "resolved"],
    ]);
  });

  test("a turn that fails for another reason leaves the login problem alone", async () => {
    const engine = new FakeEngine(() => [{ kind: "turn_failed", reason: "The network is down." }]);
    const instance = start(engine);
    const chat = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([]);
  });

  test("a default engine with no program raises an alert, which asks for a restart once the program is back", async () => {
    let piProgram: string | null = null;
    const instance = start(
      new FakeEngine(),
      { engines: { ...defaultConfig.engines, default: "pi" } },
      { locateEngine: (engine) => (engine === "pi" ? piProgram : null) },
    );
    const alerts = collectAlerts(instance);
    instance.noticeDefaultEngine();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["default_engine", "error"]]);
    expect(instance.status().problems[0]).toStartWith("Eva finds no pi program, so chats fail.");

    // The install happens while Eva runs: only a restart loads the engine.
    piProgram = "/opt/pi/bin/pi";
    await instance.backgroundTick();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["default_engine", "error"],
      ["default_engine", "resolved"],
      ["default_engine_restart", "warn"],
    ]);
    expect(instance.status().problems).toHaveLength(1);
    expect(instance.status().problems[0]).toStartWith("The pi program is installed now");
  });

  test("a loaded default engine raises no alert", () => {
    const instance = start(new FakeEngine(), {}, { locateEngine: () => null });
    const alerts = collectAlerts(instance);
    instance.noticeDefaultEngine();
    expect(alerts).toEqual([]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a start after an unclean exit sends one alert that stays out of the problems", () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.reportUncleanExit();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["unclean_exit", "warn"]]);
    expect(instance.status().problems).toEqual([]);
  });

  test("the recent log entries come from the instance's log folder, at most 100", () => {
    const instance = start(new FakeEngine());
    const logs = homePaths(home).logsFolder;
    mkdirSync(logs, { recursive: true });
    const records = Array.from({ length: 120 }, (_, index) =>
      JSON.stringify({ at: "2026-10-14T10:00:00.000Z", level: "warn", message: `Warning ${String(index)}.` }),
    );
    writeFileSync(join(logs, "eva-2026-10-14.jsonl"), records.join("\n") + "\n");
    expect(instance.recentLogs({ minimumLevel: "warn", limit: 5 }).map((entry) => entry.message)).toEqual([
      "Warning 115.",
      "Warning 116.",
      "Warning 117.",
      "Warning 118.",
      "Warning 119.",
    ]);
    expect(instance.recentLogs({ minimumLevel: "warn", limit: 500 })).toHaveLength(100);
    expect(instance.recentLogs({ minimumLevel: "error", limit: 0 })).toEqual([]);
  });

  test("a restart on request goes through the update restart path", async () => {
    const restarts: string[] = [];
    const instance = start(new FakeEngine(), {}, { restartForUpdate: () => restarts.push("restart") });
    instance.restart();
    await waitFor(() => restarts.length === 1);
    expect(restarts).toEqual(["restart"]);
  });
});

describe("migrations (#119)", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }
  const futureRecord = JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] });

  test("a vault that needs a newer Eva makes the update install at least that version, past the policy", async () => {
    sandbox.write(
      vault,
      ".eva/migrations.json",
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "0.3.0" }] }),
    );
    const releases = [
      { version: "1.0.0", notes: "" },
      { version: "0.3.0", notes: "" },
      { version: "0.2.1", notes: "" },
    ];
    const instance = start(
      new FakeEngine(),
      { updates: { ...defaultConfig.updates, install: "patch" } },
      {
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.2.0", latest: "1.0.0", available: true, releases }),
          apply: () => Promise.resolve({ current: "0.2.0", latest: "0.3.0", available: false, releases: [] }),
        },
      },
    );
    expect(await instance.checkForUpdate()).toMatchObject({ target: "0.3.0", heldBack: "1.0.0" });
  });

  test("a computer where the shell of a Project chat has no wall says so at start, with why (#711)", async () => {
    const instance = start(
      new FakeEngine(),
      {},
      { shellWallGap: () => Promise.resolve("Claude Code's shell sandbox needs bubblewrap.") },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(alerts.find((alert) => alert.key === "shell_wall")?.message).toContain("bubblewrap");
  });

  test("a failed migration at start sends an alert with its id and the error", () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "failed", applied: [], id: "2026-10-20-example", reason: "disk is full" },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["migration_failed:machine", "error"]]);
    expect(alerts[0]?.message).toContain("2026-10-20-example");
    expect(alerts[0]?.message).toContain("disk is full");
  });

  test("after the vault migrations, the hub brings the template parts up to date", () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(existsSync(join(vault, ".eva", "skills", "schedule", "SKILL.md"))).toBe(true);
    expect(instance.templateParts()?.parts.map((part) => [part.name, part.state])).toEqual([
      ["Summary", "current"],
      ["Polish", "current"],
      ["about-me", "current"],
      ["schedule", "current"],
    ]);
    expect(instance.templateParts()?.canChoose).toBe(true);
    expect(alerts).toEqual([]);
  });

  test("a template part that the person changed waits for their choice, with an alert", () => {
    sandbox.write(vault, ".eva/skills/schedule/SKILL.md", "# My own schedule skill\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["template_alignment", "warn"]]);
    expect(readFileSync(join(vault, ".eva", "skills", "schedule", "SKILL.md"), "utf-8")).toBe(
      "# My own schedule skill\n",
    );
    const parts = instance.chooseTemplateVersion(".eva/skills/schedule/SKILL.md", "mine");
    expect(parts.find((part) => part.name === "schedule")?.state).toBe("kept");
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a satellite leaves the template parts alone", () => {
    const instance = start(new FakeEngine());
    instance.reportStartMigrations({ machine: { kind: "done", applied: [], later: [] }, vault: null });
    expect(existsSync(join(vault, ".eva", "skills", "schedule", "SKILL.md"))).toBe(false);
  });

  test("a satellite shows the template parts but leaves the choice to the hub", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(vault, ".eva/skills/schedule/SKILL.md", "# My own schedule skill\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    expect(instance.templateParts()?.canChoose).toBe(false);
    expect(() => instance.chooseTemplateVersion(".eva/skills/schedule/SKILL.md", "new")).toThrow("hub");
  });

  test("the alert of a part clears after a sync that brings the person's fix", async () => {
    sandbox.write(vault, ".eva/skills/schedule/SKILL.md", "# My own schedule skill\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    sandbox.write(vault, ".eva/skills/schedule/SKILL.md", templateParts[".eva/skills/schedule/SKILL.md"] ?? "");
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("only the hub sends the alerts to the devices, as only the hub runs Telegram", async () => {
    const pushed: string[] = [];
    const pushSender = (request: { endpoint: string }): Promise<number> => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    };
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "k", auth: "a" } };
    const hub = start(new FakeEngine(), { machineName: "example-pc" }, { pushSender });
    hub.subscribePush(subscription, "Phone", null);
    hub.reportProblem("example", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toHaveLength(1);

    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const satellite = start(new FakeEngine(), { machineName: "example-pc" }, { pushSender });
    satellite.reportProblem("other", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toHaveLength(1);
    expect(satellite.pushKey().isHub).toBe(false);
  });

  test("a finished turn goes to each device that picked replies and shows no page of the chat, also on a satellite", async () => {
    const pushed: string[] = [];
    const pushSender = (request: { endpoint: string }): Promise<number> => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    };
    const phone = { endpoint: "https://fcm.googleapis.com/fcm/send/phone", keys: { p256dh: "k", auth: "a" } };
    const laptop = { endpoint: "https://fcm.googleapis.com/fcm/send/laptop", keys: { p256dh: "k", auth: "a" } };
    const desk = { endpoint: "https://fcm.googleapis.com/fcm/send/desk", keys: { p256dh: "k", auth: "a" } };
    const tablet = { endpoint: "https://fcm.googleapis.com/fcm/send/tablet", keys: { p256dh: "k", auth: "a" } };
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const instance = start(
      new FakeEngine((request) => FakeEngine.answer(request, "The report is ready.")),
      { machineName: "example-pc", sync: syncOff },
      { pushSender },
    );
    instance.subscribePush(phone, "Phone", null);
    instance.subscribePush(laptop, "Laptop", null);
    instance.subscribePush(desk, "Desk", null);
    instance.subscribePush(tablet, "Tablet", null);
    instance.setPushKinds(laptop.endpoint, ["alerts"]);
    const session = instance.createAssistantSession({ source: "web", title: "Weekly report" });
    instance.markPushInView(desk.endpoint, "desk-tab", true, [session.id]);
    // A page in view on another chat still gets the answer of this one (#614).
    instance.markPushInView(tablet.endpoint, "tablet-tab", true, ["other-chat"]);
    await instance.sessions.send(session.id, "Write the report.", "api");
    await Bun.sleep(10);
    expect(pushed).toEqual([phone.endpoint, tablet.endpoint]);
    expect(instance.recentNotifications(laptop.endpoint)).toEqual([]);
    expect(instance.recentNotifications(phone.endpoint)).toMatchObject([
      {
        key: `chat:${session.id}`,
        title: "Weekly report",
        message: "The report is ready.",
        url: `/#/chat/${session.id}`,
      },
    ]);
  });

  test("a removed device login loses its notifications", () => {
    const instance = start(new FakeEngine());
    instance.deviceLogins.attachApprover({ name: "Test", canApprove: () => true, ask: () => undefined });
    const request = instance.deviceLogins.request("owner", "Phone");
    instance.deviceLogins.answer(request.id, "allow");
    const state = instance.deviceLogins.check(request.id, "owner");
    const token = state.state === "allowed" ? state.token : "";
    instance.subscribePush(
      { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "k", auth: "a" } },
      "Phone",
      token,
    );
    instance.deviceLogins.forget(token);
    expect(instance.pushDevices()).toEqual([]);
  });

  test("a machine record from a newer Eva sends an alert, and a satellite reports no vault run", () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "ahead", unknown: ["2099-01-01-from-the-future"] },
      vault: null,
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["machine_ahead", "warn"]]);
  });

  test("a vault that a newer Eva migrated raises one alert with the computer and the versions, until it clears", async () => {
    sandbox.write(vault, ".eva/migrations.json", futureRecord);
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "ahead", unknown: ["2099-01-01-from-the-future"] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["vault_ahead", "warn"]]);
    expect(alerts[0]?.message).toContain("example-pc");
    expect(alerts[0]?.message).toContain("9.0.0");
    expect(instance.status().problems).toEqual([alerts[0]?.message ?? ""]);
    await instance.syncVault();
    expect(alerts).toHaveLength(1);
    rmSync(join(vault, ".eva", "migrations.json"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a machine that becomes the hub runs the vault migrations", async () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(
      vault,
      ".eva/settings.json",
      JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] } }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    expect(instance.role()).toBe("satellite");
    await instance.becomeHub();
    expect(instance.role()).toBe("hub");
    expect(JSON.parse(readFileSync(join(vault, ".eva", "settings.json"), "utf-8"))).toEqual({});
    expect(existsSync(join(vault, ".eva", "migrations.json"))).toBe(true);
    expect(existsSync(join(vault, ".eva", "skills", "schedule", "SKILL.md"))).toBe(true);
  });

  test("a machine that is behind the vault cannot become the hub", async () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(vault, ".eva/migrations.json", futureRecord);
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    let caught: unknown = null;
    try {
      await instance.becomeHub();
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toContain("9.0.0");
    expect(instance.role()).toBe("satellite");
  });
});

describe("the hub claim after a later fetch (#529)", () => {
  const claimedBy = (): unknown => JSON.parse(readFileSync(join(vault, ".eva", "hub.json"), "utf-8"));

  test("a machine that started with no claim claims the hub at its first timed pull", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.backgroundTick();
    expect(claimedBy()).toMatchObject({ machine: "example-pc" });
    expect(instance.role()).toBe("hub");
  });

  test("Sync now claims the hub and pushes the claim", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.syncVault();
    expect(sandbox.git(sandbox.remote, "show", "main:.eva/hub.json")).toContain("example-pc");
  });

  test("a claim that another machine pushed wins over a later fetch", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "claim");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.backgroundTick();
    expect(claimedBy()).toMatchObject({ machine: "other-pc" });
    expect(instance.role()).toBe("satellite");
  });

  test("a read or a pick of a conflict never claims the hub", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.vaultConflicts();
    await instance.resolveVaultConflict("note.md", "mine");
    expect(existsSync(join(vault, ".eva", "hub.json"))).toBe(false);
  });

  test("Sync now with sync off does not claim the hub", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    await instance.syncVault();
    expect(existsSync(join(vault, ".eva", "hub.json"))).toBe(false);
  });
});

describe("machine reports (#126)", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }
  const hubClaim = (machine: string): string => JSON.stringify({ machine, since: "" });
  const laptopReport = (problems: unknown[]): string =>
    JSON.stringify({ machine: "laptop", version: "0.1.0", problems });
  const ahead = { key: "vault_ahead", level: "warn", message: "Update Eva on laptop.", resolvedMessage: "Fixed." };
  const readReport = (machine: string): unknown =>
    JSON.parse(readFileSync(join(vault, ".eva", "machines", `${machine}.json`), "utf-8"));

  test("a satellite behind the vault writes its problem to its report, and the sync pushes it", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    sandbox.write(
      vault,
      ".eva/migrations.json",
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportStartMigrations({ machine: { kind: "done", applied: [], later: [] }, vault: null });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({
      machine: "example-pc",
      problems: [{ key: "vault_ahead", level: "warn" }],
    });
    expect(sandbox.git(vault, "status", "--porcelain")).toBe("");
  });

  test("the report leaves out the vault sync problem, which cannot travel through the sync", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("vault_sync", { level: "error", message: "The sync failed.", resolvedMessage: "Ok." });
    instance.reportProblem("telegram", { level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({ problems: [{ key: "telegram" }] });
  });

  test("the hub raises one alert per problem of another machine, named after it, until the report clears", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    sandbox.write(
      vault,
      ".eva/machines/example-pc.json",
      JSON.stringify({ machine: "example-pc", version: "", problems: [ahead] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["machine:laptop:vault_ahead", "warn"]]);
    expect(alerts[0]?.message.startsWith("On laptop: Update Eva on laptop. ")).toBe(true);
    expect(alerts[0]?.message).toContain(".eva/machines/laptop.json");
    expect(instance.status().problems).toHaveLength(1);
    // The hub's own report never carries the problems that it relays.
    expect(readReport("example-pc")).toMatchObject({ problems: [] });
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([]));
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["machine:laptop:vault_ahead", "warn"],
      ["machine:laptop:vault_ahead", "resolved"],
    ]);
    expect(alerts[1]?.message).toBe("On laptop: Fixed.");
  });

  test("a satellite's report marks a problem that the person hid there, and only that one (#541)", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("telegram", { level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." });
    instance.reportProblem("update", { level: "warn", message: "No update check.", resolvedMessage: "Ok." });
    instance.hideProblem("update");
    await instance.syncVault();
    expect(readReport("example-pc")).toEqual({
      machine: "example-pc",
      version: expect.any(String) as string,
      reportedAt: clock.toISOString(),
      problems: [
        { key: "telegram", level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." },
        { key: "update", level: "warn", message: "No update check.", resolvedMessage: "Ok.", hidden: true },
      ],
    });
  });

  test("the hub hides a problem that another machine reports as hidden, so it sends no reminder", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([{ ...ahead, hidden: true }]));
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.hidden).toBe(true);
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
  });

  test("the hub says how old a report is once it is more than a day old (#542)", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(
      vault,
      ".eva/machines/laptop.json",
      JSON.stringify({ machine: "laptop", version: "0.1.0", reportedAt: clock.toISOString(), problems: [ahead] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.message).not.toContain("last reported");
    clock = new Date(clock.getTime() + 3 * 24 * 60 * 60_000);
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.message).toContain("laptop last reported 3 days ago.");
  });

  test("the hub sends no alert for a problem that another machine hid before the hub saw it", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([{ ...ahead, hidden: true }]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts).toEqual([]);
    expect(instance.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("a relayed problem that cleared while the hub was off loses its mark, so its next failure alerts", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const first = start(new FakeEngine(), { machineName: "example-pc" });
    await first.syncVault();
    expect(first.hideProblem("machine:laptop:vault_ahead")).toBe(true);
    first.stop();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([]));
    const second = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(second);
    await second.syncVault();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    await second.syncVault();
    expect(alerts.map((alert) => alert.key)).toEqual(["machine:laptop:vault_ahead"]);
    expect(second.status().problemDetails[0]?.hidden).toBe(false);
  });

  test("a relayed problem that is still open keeps its mark across a hub restart", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const first = start(new FakeEngine(), { machineName: "example-pc" });
    await first.syncVault();
    first.hideProblem("machine:laptop:vault_ahead");
    first.stop();
    const second = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(second);
    await second.syncVault();
    expect(alerts).toEqual([]);
    expect(second.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("a deleted report, such as from a computer that is gone, resolves its alerts", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    rmSync(join(vault, ".eva", "machines", "laptop.json"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a satellite drops the schedule problems of its time as hub, because no firing clears them now", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("schedule:daily", {
      level: "error",
      message: "The schedule failed.",
      resolvedMessage: "Ok.",
    });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({ problems: [] });
    expect(instance.status().problems).toEqual([]);
  });

  test("a broken report keeps its alerts until it reads again", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    writeFileSync(join(vault, ".eva", "machines", "laptop.json"), "<<<<<<< ours\n");
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    expect(instance.status().problems).toHaveLength(1);
  });

  test('a hub that becomes a satellite drops what it relayed with no false "resolved" line', async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts).toHaveLength(1);
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    expect(instance.status().problems).toEqual([]);
  });
});

describe("the person's place (#371)", () => {
  const madrid = { latitude: 40.4, longitude: -3.7, accuracy: null };
  const aboutMe = (): string => readFileSync(join(vault, "Life", "About me.md"), "utf-8");

  test("a phone's point counts for a day, then the home place of About me", () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/About me.md", "---\nplaces:\n  home: { lat: 41.39, lon: 2.17 }\n---\n");
    expect(instance.saveLocation(madrid, "telegram", clock, true)).toBe(true);
    expect(instance.currentPlace()).toMatchObject({ latitude: 40.4, source: "telegram" });
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    expect(instance.currentPlace()).toEqual({
      latitude: 41.39,
      longitude: 2.17,
      accuracy: null,
      source: "home",
      at: null,
    });
  });

  test("only the hub keeps a location, as only the hub runs the schedules", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const satellite = start(new FakeEngine(), { machineName: "example-pc" });
    expect(() => satellite.saveLocation({ ...madrid, latitude: 1 }, "web", clock, true)).toThrow("hub");
  });

  test("the hub writes the point into About me, and the next sync carries it (#689)", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/About me.md", "---\nname: Alex\n---\n\n# About Alex\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => aboutMe().includes("lastLocation"));
    expect(aboutMe()).toBe(
      "---\nname: Alex\n# Eva's code fills lastLocation from your phone. Keep it as it is.\n" +
        `lastLocation: { latitude: 40.4, longitude: -3.7, accuracy: null, at: "${clock.toISOString()}", source: telegram }\n` +
        "---\n\n# About Alex\n",
    );
    await instance.syncVault();
    expect(sandbox.git(sandbox.remote, "show", "main:Life/About me.md")).toContain("lastLocation");
  });

  test("another computer reads the point from About me", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(
      vault,
      "Life/About me.md",
      `---\nlastLocation: { latitude: 40.4, longitude: -3.7, accuracy: 12, at: "${clock.toISOString()}", source: web }\n---\n`,
    );
    const satellite = start(new FakeEngine(), { machineName: "example-pc" });
    expect(satellite.currentPlace()).toEqual({ ...madrid, accuracy: 12, source: "web", at: clock.toISOString() });
  });

  test("with no About me, a problem says why the location is not saved, and a new note clears it", async () => {
    const instance = start(new FakeEngine());
    rmSync(join(vault, "Life", "About me.md"), { force: true });
    const problems = (): string => instance.status().problems.join("\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => problems().includes("Eva cannot save your location: Life/About me.md is missing"));
    expect(instance.currentPlace()).toMatchObject({ latitude: 40.4 });
    sandbox.write(vault, "Life/About me.md", "# About Alex\n");
    // The tick starts the write, and the write runs apart from it.
    await instance.backgroundTick();
    await waitFor(() => !problems().includes("location"));
    expect(aboutMe()).toContain("lastLocation");
  });

  test("a computer that stops being the hub closes its location alert", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    rmSync(join(vault, "Life", "About me.md"), { force: true });
    const problems = (): string => instance.status().problems.join("\n");
    instance.saveLocation(madrid, "telegram", clock, true);
    await waitFor(() => problems().includes("Eva cannot save your location"));
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    await instance.backgroundTick();
    await waitFor(() => !problems().includes("location"));
  });

  test("never writes during an Assistant turn, and writes before the snapshot after it", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    // With sync on, Eva takes the snapshots of the turn.
    const instance = start(engine, { sync: defaultConfig.sync });
    sandbox.write(vault, "Life/About me.md", "---\nname: Alex\n---\n");
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    instance.saveLocation(madrid, "telegram", clock, true);
    await instance.backgroundTick();
    expect(aboutMe()).not.toContain("lastLocation");
    release();
    await turn;
    expect(aboutMe()).toContain("lastLocation");
    const after = sandbox.git(vault, "show", `${turnSnapshotRef(session.id, 0, "after")}:Life/About me.md`);
    expect(after).toContain("lastLocation");
  });
});

describe("the vault's secret files at start (#707)", () => {
  test("a secret file that a commit holds in plain text is encrypted at start, such as after an update", async () => {
    sandbox.write(vault, "deploy/id.key", "PRIVATE\n");
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "before the update");
    const instance = start(new FakeEngine());
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await waitFor(() => readFileSync(join(vault, "deploy/id.key"), "utf8").startsWith("Encrypted by Eva."));
  });
});

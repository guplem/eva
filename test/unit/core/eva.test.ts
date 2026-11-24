/** Tests of Eva: chats, schedules, projects and the engine environment. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import type { SessionEvent } from "../../../src/shared/events.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { fakeGh } from "../../support/fake-gh.ts";
import { fakeGithub, fakeGithubWrite } from "../../support/fake-github.ts";
import { widgetTemplate } from "../../../src/core/widgets/widget-template.ts";
import { gitEnvironment } from "../../support/git-sandbox.ts";
import {
  useEvaTestbed,
  clock,
  config,
  finishingEngine,
  home,
  sandbox,
  setClock,
  setEva,
  start,
  syncOff,
  syncOn,
  vault,
  waitFor,
} from "../../support/eva-testbed.ts";

useEvaTestbed();

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
    setClock(new Date("2026-10-14T10:45:00Z"));
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    await instance.idle();
    const [session] = instance.sessions.list();
    expect(session).toMatchObject({ title: "Lunch", source: "schedule", mode: "assistant" });
    expect(engine.requests[0]?.prompt).toContain("\n\nLunch ideas?\n\n[A scheduled run.");
  });

  test("a quiet scheduled run deletes its chat and sends nothing (#687)", async () => {
    const engine = new FakeEngine((request) => FakeEngine.answer(request, "[[quiet]]"));
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "reply", name: "Reply", at: "12:45", prompt: "Any reply?" }] }),
    );
    const instance = start(engine);
    const answered: string[] = [];
    instance.schedules?.subscribe((event) => {
      if (event.kind === "schedule_answered") answered.push(event.sessionId);
      return true;
    });
    await instance.schedules?.tick();
    setClock(new Date("2026-10-14T10:45:00Z"));
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    await instance.idle();
    await waitFor(() => instance.sessions.list().length === 0);
    expect(answered).toEqual([]);
    expect(instance.schedules?.list().schedules[0]?.lastRun).toMatchObject({ quiet: true });
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
    expect(prompt).toContain(
      "- Recipes, `Projects/2025-03-02-1015-recipes/AGENTS.md` (project, closed, in use): The menus of each week.",
    );
    expect(prompt).toContain(
      `- Website, \`${join(extraRoot, "2025-04-01-0900-website", "AGENTS.md")}\` (project, active)`,
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
    setClock(new Date(clock.getTime() + 60 * 60_000));
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
    const eva = setEva(
      new Eva({
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
      }),
    );
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

  test("a new clone skips a repos entry that links into a folder, so git does not fail on it", async () => {
    const link = "https://github.com/owner/site/tree/main/apps/example-app";
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n  - ${link}\n---\n# Example app\n`,
    );
    const instance = start(new FakeEngine());
    const clone = await instance.newClone("2025-03-02-1015-example-app");
    expect(clone.repositories.map((repository) => repository.name)).toEqual(["remote"]);
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

  test("a new clone, a turn in a clone and a deleted clone each sync the Windows Search rules (#942)", async () => {
    const projectId = "2025-03-02-1015-example-app";
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    let syncs = 0;
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const instance = start(
      new FakeEngine(),
      {},
      {
        searchIndex: () => {
          syncs += 1;
          return Promise.resolve({ kind: "synced", added: 0, removed: 0 });
        },
      },
    );
    await instance.newClone(projectId);
    await settle();
    expect(syncs).toBe(1);
    const chat = await instance.createProjectSession({ projectId, cloneName: "clone-0", source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    await settle();
    expect(syncs).toBe(2);
    await instance.deleteClone(projectId, "clone-0");
    await settle();
    expect(syncs).toBe(3);
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
        status: "paused",
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
          created: "2026-10-14T12:30+02:00",
          status: "paused",
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
      // The first turn of a Project chat syncs the vault with git first, which takes seconds on a Windows runner.
      await waitFor(() => engine.requests.length > 0, 20_000);
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
      await waitFor(() => engine.requests.length > 0, 20_000);
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
    const eva = setEva(
      new Eva({
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
      }),
    );
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
    const eva = setEva(
      new Eva({
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
      }),
    );
    await eva.sweep();
    expect(environments.some((environment) => environment["EVA_GITHUB_TOKEN"] === "github-token-for-tests")).toBe(true);
    const session = eva.createAssistantSession({ source: "cli" });
    await eva.sessions.send(session.id, "hi");
    expect(engine.requests[0]?.environment["EVA_GITHUB_TOKEN"]).toBeUndefined();
  });

  test("the Google MCP server never gets the GitHub token (lesson 96)", async () => {
    const engine = new FakeEngine();
    const eva = setEva(
      new Eva({
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
      }),
    );
    const session = eva.createAssistantSession({ source: "cli" });
    await eva.sessions.send(session.id, "hi");
    const google = engine.requests[0]?.mcpServers["google"];
    expect(google?.environment["GOOGLE_OAUTH_CLIENT_ID"]).toBe("123456789012-clientid.apps.googleusercontent.com");
    expect(google?.environment["EVA_GITHUB_TOKEN"]).toBeUndefined();
    expect(Object.values(google?.environment ?? {})).not.toContain("github-token-for-tests");
  });

  test("an agent finds an `eva` command for this instance, and the chat id of its turn", async () => {
    const engine = new FakeEngine();
    const eva = setEva(
      new Eva({
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
      }),
    );
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
});

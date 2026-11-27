/** Tests of Eva's Project chats: clones, specialists and general projects. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Eva } from "../../../src/core/eva.ts";
import { homePaths } from "../../../src/core/settings/home.ts";
import { projectWallRoots } from "../../../src/core/instance/child-environments.ts";
import type { SessionRecord } from "../../../src/core/sessions/session-store.ts";
import { isEvaError } from "../../../src/shared/errors.ts";
import { mentionsIn } from "../../../src/shared/mentions.ts";
import { wallRefusesPath } from "../../../src/shared/path-area.ts";
import type { TurnRequest } from "../../../src/shared/engine-port.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import {
  useEvaTestbed,
  finishingEngine,
  home,
  sandbox,
  start,
  syncOn,
  vault,
  waitFor,
} from "../../support/eva-testbed.ts";

useEvaTestbed();

/**
 * An engine whose Project chat reads each file that its message gives it, from its start folder,
 * and answers with their text. It says when Eva could not give it a file (#753).
 */
function readingEngine(): FakeEngine {
  return new FakeEngine((request) => {
    if (request.mode !== "project") return FakeEngine.answer(request, "Noted.");
    const paths = [
      ...[...request.prompt.matchAll(/is the file (\S+)\]/g)].map((match) => match[1]!),
      ...mentionsIn(request.prompt).map((mention) => mention.name),
    ];
    const read = paths
      .map((path) => join(request.startFolder, path))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8").trim());
    const missing = request.prompt.includes("Eva could not give this file") ? ["I did not get the file."] : [];
    return FakeEngine.answer(request, [...read, ...missing].join(" ") || "Nothing to read.");
  });
}

/** The result of the project work that reports to the Assistant chat, once it arrives. */
async function workResult(instance: Eva, askingId: string): Promise<string | undefined> {
  await waitFor(() => instance.sessions.get(askingId).turns.length === 1, 20_000);
  await instance.idle();
  return instance.sessions.get(askingId).turns[0]?.projectReports[0]?.result;
}

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

  // clone-sync.test.ts checks the rest: the pull, the kept ignored files, and that they are not local work.
  test("a reused clone is on the default branch, and gets a new repository", async () => {
    const instance = start(finishingEngine());
    const first = await newChat(instance);
    await instance.sessions.send(first.id, "fix it");
    const repository = join(first.startFolder, "remote");
    // The work of the old chat: a pushed branch.
    sandbox.git(repository, "checkout", "-q", "-b", "feature");
    sandbox.write(repository, "feature.txt", "feature\n");
    sandbox.git(repository, "add", "-A");
    sandbox.git(repository, "commit", "-q", "-m", "feature");
    sandbox.git(repository, "push", "-q", "-u", "origin", "feature");
    sandbox.git(sandbox.root, "clone", "-q", "--bare", sandbox.remote, "example-api.git");
    sandbox.write(
      vault,
      `Projects/${projectId}/AGENTS.md`,
      projectFile([sandbox.remote, join(sandbox.root, "example-api.git")]),
    );
    const next = await newChat(instance);
    expect(next.clone).toBe("clone-0");
    expect(sandbox.git(repository, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(existsSync(join(first.startFolder, "example-api", "AGENTS.md"))).toBe(true);
    expect(instance.sessions.get(first.id).closed).toBe(true);
  });

  test("work from an Assistant chat reads a vault note that it names, and no repository sees the copy (#753)", async () => {
    sandbox.write(vault, "Notes/plan.md", "Use the blue button.\n");
    const engine = readingEngine();
    const instance = start(engine);
    const asking = instance.createAssistantSession({ source: "web" });
    const work = await instance.startProjectWork({
      projectId,
      request: "Build the page in @file:Notes/plan.md.",
      reportToSessionId: asking.id,
    });
    expect(await workResult(instance, asking.id)).toBe("Use the blue button.");
    const prompt = engine.requests.find((request) => request.mode === "project")?.prompt ?? "";
    expect(prompt).not.toContain("Notes/");
    expect(sandbox.git(join(work.startFolder, "remote"), "status", "--porcelain", "--ignored")).toBe("");
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
      fileWall: { area: coachFolder(), ...projectWallRoots(homePaths(home), vault, []), socketFilter: false },
    });
    expect(sandbox.git(sandbox.remote, "show", `main:Projects/${coachId}/log.md`)).toBe("Monday: legs.");
  });

  test("the socket filter runs only after the start check says this computer allows it (#760)", async () => {
    const engine = new FakeEngine((request) => FakeEngine.answer(request, "Noted."));
    const instance = start(engine, {}, { nestedSandbox: () => Promise.resolve(true) });
    const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
    await instance.sessions.send(chat.id, "Before the check.");
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    await instance.sessions.send(chat.id, "After the check.");
    expect(engine.requests.map((request) => request.fileWall?.socketFilter)).toEqual([false, true]);
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
    expect(engine.requests[1]?.prompt).toContain(
      `[Project work finished: ${coachId}, project folder, chat ${work.id}]`,
    );
    expect(instance.sessions.get(asking.id).turns[0]?.projectReports).toMatchObject([
      { projectId: coachId, clone: null, repositories: [], result: "The week is planned." },
    ]);
  });

  test("work on a specialist reads the vault notes that it names, and no copy reaches the vault (#753)", async () => {
    sandbox.write(vault, "Notes/plan.md", "Run three times a week.\n");
    sandbox.write(vault, `Projects/${coachId}/log.md`, "Ran 5 km.\n");
    const engine = readingEngine();
    const instance = start(engine, { sync: syncOn });
    const asking = instance.createAssistantSession({ source: "web" });
    await instance.startProjectWork({
      projectId: coachId,
      request: `Plan the week from @file:Notes/plan.md and @file:Projects/${coachId}/log.md.`,
      reportToSessionId: asking.id,
    });
    expect(await workResult(instance, asking.id)).toBe("Run three times a week. Ran 5 km.");
    const prompt = engine.requests.find((request) => request.mode === "project")?.prompt ?? "";
    expect(prompt).not.toContain("Notes/");
    expect(prompt).not.toContain("Projects/");
    expect(existsSync(join(coachFolder(), ".mentions"))).toBe(false);
    expect(sandbox.git(vault, "status", "--porcelain")).not.toContain(".mentions");
    expect(sandbox.git(sandbox.remote, "log", "--all", "--name-only", "--format=")).not.toContain(".mentions");
  });

  test("work on a specialist that names a secret file gets no copy, and its result says so (#753)", async () => {
    sandbox.write(vault, "Notes/keys.txt", "The key is ghp_0123456789abcdefghijklmnopqrstuvwxyzAB.\n");
    const engine = readingEngine();
    const instance = start(engine);
    const asking = instance.createAssistantSession({ source: "web" });
    await instance.startProjectWork({
      projectId: coachId,
      request: "Use @file:Notes/keys.txt.",
      reportToSessionId: asking.id,
    });
    expect(await workResult(instance, asking.id)).toBe("I did not get the file.");
    expect(existsSync(join(coachFolder(), ".mentions"))).toBe(false);
  });

  test("a message to a specialist chat that names a gone file is refused before it is sent (#753)", async () => {
    const instance = start(new FakeEngine());
    const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
    const caught = (() => {
      try {
        instance.checkMessage(chat.id, "Read @file:Notes/gone.md");
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isEvaError(caught, "file_not_found")).toBe(true);
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
    const edited = back.text.replace("type: specialist\n", "type: software\n");
    expect(() => instance.saveProjectFile(coachId, back.version, edited)).toThrow("has chats");
  });

  test("a type changed by hand stops a specialist chat, so it never runs at the root of a software project", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
    writeFileSync(
      join(coachFolder(), "AGENTS.md"),
      "---\ncreated: 2025-03-02T10:15\nstatus: active\ntype: software\n---\n# Coach\n",
    );
    await instance.sessions.send(chat.id, "hi");
    expect(engine.requests).toEqual([]);
    expect(instance.sessions.get(chat.id).turns[0]?.failure).toContain("works in clones now");
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

  test("a specialist chat gets a sent file in its project's received folder, open to it read-only (#768)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
    const { path, note } = instance.receiveFile("plan.pdf", new Uint8Array([1, 2, 3]), chat.id);
    expect(path).toMatch(new RegExp(`^\\.eva/scratch/received/${coachId}/plan-[0-9a-f]{12}\\.pdf$`));
    // The file is outside the chat's folder, so the note gives its full path and says what to do with it.
    expect(note).toBe(
      `[The person sent a file, saved as ${join(vault, path)}. It is temporary and read-only: to keep it, copy it into the project folder.]`,
    );
    expect(readFileSync(join(vault, path))).toEqual(Buffer.from([1, 2, 3]));
    // Nothing new lands in the project folder.
    expect(readdirSync(coachFolder())).toEqual(["AGENTS.md"]);
    await instance.sessions.send(chat.id, `${note}\nRead it.`);
    const received = join(vault, ".eva", "scratch", "received", coachId);
    expect(engine.requests[0]?.fileWall?.readOnly).toEqual([received]);
    // The chat reads the file but never changes it, and the Assistant's files stay closed to it.
    const wall = engine.requests[0]!.fileWall!;
    const saved = join(vault, path);
    expect(wallRefusesPath(wall, saved, coachFolder(), { reads: true })).toBe(false);
    expect(wallRefusesPath(wall, saved, coachFolder())).toBe(true);
    const assistantFile = instance.receiveFile("bank.pdf", new Uint8Array([9]), null).path;
    expect(wallRefusesPath(wall, join(vault, assistantFile), coachFolder(), { reads: true })).toBe(true);
  });

  test("a chat whose project is gone takes no file (#768)", async () => {
    const instance = start(new FakeEngine());
    const chat = await instance.createProjectSession({ projectId: coachId, source: "web" });
    rmSync(coachFolder(), { recursive: true, force: true });
    const caught = await Promise.resolve()
      .then(() => instance.receiveFile("plan.pdf", new Uint8Array([1, 2, 3]), chat.id))
      .catch((error: unknown) => error);
    expect(isEvaError(caught, "project_not_found")).toBe(true);
    expect(existsSync(join(vault, ".eva", "scratch", "received"))).toBe(false);
  });
});

describe("general projects (#768)", () => {
  const houseId = "2025-03-04-1015-house";
  const houseFolder = (): string => join(vault, "Projects", houseId);

  beforeEach(() => {
    sandbox.write(
      vault,
      `Projects/${houseId}/AGENTS.md`,
      "---\ncreated: 2025-03-04T10:15\nstatus: active\n---\n# House\n\nBuilding a house.\n",
    );
  });

  test("a project with no type and no repos reads as general, and its chat starts in the project folder", async () => {
    const engine = new FakeEngine((request) => {
      if (request.mode === "project") writeFileSync(join(request.startFolder, "plan.md"), "Walls first.\n");
      return FakeEngine.answer(request, "Noted.");
    });
    const instance = start(engine, { sync: syncOn });
    expect(instance.projects().find((project) => project.id === houseId)?.frontMatter.type).toBe("general");
    const chat = await instance.createProjectSession({ projectId: houseId, source: "web" });
    expect(chat).toMatchObject({ mode: "project", clone: null, startFolder: houseFolder(), projectId: houseId });
    await instance.sessions.send(chat.id, "Plan the walls.");
    expect(engine.requests[0]).toMatchObject({
      startFolder: houseFolder(),
      trusted: true,
      harnessMemory: false,
      folderHooks: false,
    });
    expect(sandbox.git(sandbox.remote, "show", `main:Projects/${houseId}/plan.md`)).toBe("Walls first.");
  });

  test("a general project has no clones, and its work result names the project folder", async () => {
    const engine = new FakeEngine((request) => FakeEngine.answer(request, "Done."));
    const instance = start(engine);
    const clone = await Promise.resolve()
      .then(() => instance.newClone(houseId))
      .catch((error: unknown) => error);
    expect(isEvaError(clone, "project_invalid")).toBe(true);
    const asking = instance.createAssistantSession({ source: "web" });
    const work = await instance.startProjectWork({
      projectId: houseId,
      request: "Plan.",
      reportToSessionId: asking.id,
    });
    expect(work).toMatchObject({ clone: null, startFolder: houseFolder() });
    await waitFor(() => instance.sessions.get(asking.id).turns.length === 1, 20_000);
    await instance.idle();
    expect(engine.requests[1]?.prompt).toContain(
      `[Project work finished: ${houseId}, project folder, chat ${work.id}]`,
    );
  });

  test("general and specialist switch while the project has chats, and a repository keeps it general", async () => {
    const instance = start(new FakeEngine());
    await instance.createProjectSession({ projectId: houseId, source: "web" });
    const details = { title: "House", status: "active" as const, tags: [], repos: [] };
    const specialist = instance.saveProjectDetails(houseId, instance.projectFile(houseId).version, {
      ...details,
      type: "specialist",
    });
    expect(specialist.details?.type).toBe("specialist");
    const general = instance.saveProjectDetails(houseId, specialist.version, { ...details, type: "general" });
    expect(general.details?.type).toBe("general");
    const withRepo = instance.saveProjectDetails(houseId, general.version, {
      ...details,
      repos: ["https://github.com/example/example-app"],
    });
    expect(withRepo.details?.type).toBe("general");
    const caught = (() => {
      try {
        return instance.saveProjectDetails(houseId, withRepo.version, { ...details, type: "software" });
      } catch (error) {
        return error;
      }
    })();
    expect(isEvaError(caught, "project_invalid")).toBe(true);
  });

  test("a raw save that adds repos to a general project with no type key says how to keep it general", async () => {
    const instance = start(new FakeEngine());
    await instance.createProjectSession({ projectId: houseId, source: "web" });
    const file = instance.projectFile(houseId);
    const edited = file.text.replace(
      "status: active\n",
      "status: active\nrepos:\n  - https://github.com/example/example-app\n",
    );
    expect(() => instance.saveProjectFile(houseId, file.version, edited)).toThrow(
      "Its repos make it a software project. To keep it general, write `type: general`.",
    );
  });

  test("a new general project from the form opens no chat and has no specialist line", async () => {
    const instance = start(new FakeEngine());
    const result = await instance.createProject({
      name: "Model",
      description: "A scale model.",
      status: "active",
      tags: [],
      repository: null,
      drive: false,
      type: "general",
    });
    expect(result.chat).toBeNull();
    expect(instance.sessions.list()).toEqual([]);
    const text = readFileSync(join(vault, "Projects", result.projectId, "AGENTS.md"), "utf8");
    expect(text).toContain("type: general\n");
    expect(text).not.toContain("This specialist is new");
  });
});

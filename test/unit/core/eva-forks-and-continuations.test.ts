/** Tests of Eva's forks, retries, continued chats and chat names. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Eva } from "../../../src/core/eva.ts";
import type { SessionRecord } from "../../../src/core/sessions/session-store.ts";
import { isEvaError } from "../../../src/shared/errors.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { useEvaTestbed, eva, finishingEngine, sandbox, start, vault, waitFor } from "../../support/eva-testbed.ts";

useEvaTestbed();

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

describe("Eva", () => {
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

  test("a chat takes a name from the branch on screen, and a fork from its own branch (#996)", async () => {
    const engine = new FakeEngine((request) => {
      if (request.mode !== "model-call") return FakeEngine.answer(request, "Sure.");
      return FakeEngine.answer(request, request.prompt.includes("book the hotel") ? "Rome hotel" : "Rome trip");
    });
    const instance = start(engine);
    const chat = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(chat.id, "Plan a trip to Rome", "api");
    const messageId = instance.sessions.get(chat.id).turns[0]!.lastMessageId!;
    const { session: fork } = await instance.forkChat(chat.id, messageId);
    await instance.sessions.send(fork.id, "Now book the hotel", "api");
    // The header reads the branch on screen, and names the whole chat.
    expect(await instance.renameAutomatically(fork.id, "chat")).toMatchObject({ id: chat.id, title: "Rome hotel" });
    expect(instance.sessions.get(fork.id).forkName).not.toBe("Rome hotel");
    expect(await instance.renameAutomatically(chat.id, "fork")).toMatchObject({ id: chat.id, forkName: "Rome trip" });
    expect(instance.sessions.get(chat.id).title).toBe("Rome hotel");
  });

  test("a failed automatic name keeps the old name and gives the reason (#996)", async () => {
    const engine = new FakeEngine((request) =>
      request.mode === "model-call"
        ? [{ kind: "turn_failed", reason: "Rate limited." }]
        : FakeEngine.answer(request, "Sure."),
    );
    const instance = start(engine);
    const chat = instance.createAssistantSession({ source: "web" });
    await instance.sessions.send(chat.id, "Hello", "api");
    const error: unknown = await instance.renameAutomatically(chat.id, "chat").catch((caught: unknown) => caught);
    expect(isEvaError(error, "engine_failed")).toBe(true);
    expect((error as Error).message).toBe("Rate limited.");
    expect(instance.sessions.get(chat.id).title).toBe("Hello");
  });
});

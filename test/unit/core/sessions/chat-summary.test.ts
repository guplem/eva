import { describe, expect, test } from "bun:test";
import { ModelCalls } from "../../../../src/core/model-calls/model-calls.ts";
import { ChatSummarizer, summaryLead, type ChatSummaryInput } from "../../../../src/core/sessions/chat-summary.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";

function summarizer(script?: FakeTurnScript): {
  summarizer: ChatSummarizer;
  engine: FakeEngine;
  logs: { level: LogLevel; message: string }[];
} {
  const engine = new FakeEngine(script);
  const calls = new ModelCalls({ engines: [engine], environment: {}, redact: (text) => text, timeoutMs: 5_000 });
  const logs: { level: LogLevel; message: string }[] = [];
  return {
    engine,
    logs,
    summarizer: new ChatSummarizer({
      modelCalls: calls,
      logger: { log: (level, message) => logs.push({ level, message }) },
    }),
  };
}

const input: ChatSummaryInput = {
  engine: "claude-code",
  model: "opus",
  turns: [
    { userText: "Fix the login page", answerText: "I pushed the fix to fix-login.", failure: null },
    { userText: "Open a pull request", answerText: "", failure: "The engine stopped." },
  ],
  gitState: "## fix-login...origin/fix-login\nM src/login.ts",
};

describe("the chat summarizer (#522)", () => {
  test("it gives the cheapest model the chat and the git state, and leads the draft with a note", async () => {
    const { summarizer: chat, engine } = summarizer((request) =>
      FakeEngine.answer(request, "  Goal: fix the login page.  "),
    );
    expect(await chat.summarize(input)).toEqual({ ok: true, text: `${summaryLead}\n\nGoal: fix the login page.` });
    const request = engine.requests[0];
    expect(request?.model).toBe("haiku");
    expect(request?.appendSystemPrompt).toContain("Left to do");
    expect(request?.prompt).toContain("Person: Fix the login page\n\nAgent: I pushed the fix to fix-login.");
    expect(request?.prompt).toContain("Agent: The turn failed: The engine stopped.");
    expect(request?.prompt).toContain("<git-state>\n## fix-login...origin/fix-login\nM src/login.ts\n</git-state>");
  });

  test("a message that Eva sent, such as a project work result, is not labelled the person's", async () => {
    const { summarizer: chat, engine } = summarizer((request) => FakeEngine.answer(request, "Goal: ship it."));
    await chat.summarize({
      ...input,
      turns: [
        { userText: "[Project work finished: example-app]", answerText: "It is done.", failure: null, fromEva: true },
      ],
    });
    expect(engine.requests[0]?.prompt).toContain("Eva: [Project work finished: example-app]\n\nAgent: It is done.");
    expect(engine.requests[0]?.prompt).not.toContain("Person: [Project work finished");
  });

  test("an Assistant chat sends no git state", async () => {
    const { summarizer: chat, engine } = summarizer((request) => FakeEngine.answer(request, "Goal: plan a trip."));
    await chat.summarize({ ...input, gitState: null });
    expect(engine.requests[0]?.prompt).not.toContain("<git-state>");
  });

  test("a long chat keeps its newest turns and says that older turns are left out", async () => {
    const { summarizer: chat, engine } = summarizer((request) => FakeEngine.answer(request, "Goal: a lot."));
    const turns = Array.from({ length: 30 }, (_, index) => ({
      userText: `message ${String(index)} ${"x".repeat(5_000)}`,
      answerText: "y".repeat(5_000),
      failure: null,
    }));
    await chat.summarize({ ...input, turns });
    const prompt = engine.requests[0]?.prompt ?? "";
    expect(prompt).toContain("message 29");
    expect(prompt).not.toContain("message 0 ");
    expect(prompt).toMatch(/\(\d+ older turns are left out\.\)/);
    expect(prompt.length).toBeLessThan(50_000);
  });

  test("a chat with no turns asks no model", async () => {
    const { summarizer: chat, engine } = summarizer();
    expect(await chat.summarize({ ...input, turns: [] })).toMatchObject({ ok: false });
    expect(engine.requests).toHaveLength(0);
  });

  test("a failed call or an empty answer gives a reason, and a failed call is logged", async () => {
    const { summarizer: failing, logs } = summarizer(() => [{ kind: "turn_failed", reason: "Rate limited." }]);
    expect(await failing.summarize(input)).toEqual({ ok: false, failure: "failed", reason: "Rate limited." });
    expect(logs).toEqual([{ level: "warn", message: "A chat summary failed: Rate limited." }]);
    const { summarizer: empty } = summarizer((request) => FakeEngine.answer(request, "  "));
    expect(await empty.summarize(input)).toMatchObject({ ok: false, reason: "The model gave an empty summary." });
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { cheapestModel, ModelCalls, type ModelCallRequest } from "../../../../src/core/model-calls/model-calls.ts";
import type { EnginePort } from "../../../../src/shared/engine-port.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";

function calls(engines: readonly EnginePort[], timeoutMs = 5_000): ModelCalls {
  return new ModelCalls({
    engines,
    environment: { HOME: "/h" },
    redact: (text) => text.replaceAll("secret-value", "[redacted]"),
    timeoutMs,
  });
}

const question: ModelCallRequest = {
  engine: "claude-code",
  model: "haiku",
  systemPrompt: "You name chats.",
  prompt: "Name this chat.",
};

describe("a model call", () => {
  test("runs one turn with no tools, no history and no Eva skills, in an empty folder that it removes", async () => {
    let folder = "";
    let folderWasEmpty = false;
    const engine = new FakeEngine((request) => {
      folder = request.startFolder;
      folderWasEmpty = readdirSync(folder).length === 0;
      return [{ kind: "text", text: "Trip", messageId: "m1" }, ...FakeEngine.answer(request, "plans")];
    });
    expect(await calls([engine]).ask(question)).toEqual({ ok: true, text: "Trip\n\nplans" });
    const request = engine.requests[0];
    expect(request).toMatchObject({
      mode: "model-call",
      model: "haiku",
      prompt: "Name this chat.",
      appendSystemPrompt: "You name chats.",
      pluginFolders: [],
      mcpServers: {},
      trusted: false,
      environment: { HOME: "/h" },
    });
    expect(request?.history.kind).toBe("new");
    expect(await request?.requestApproval({ requestId: "r", toolName: "Bash", summary: "ls" })).toBe("deny");
    expect(folderWasEmpty).toBe(true);
    expect(existsSync(folder)).toBe(false);
  });

  test("puts each named fact after the prompt, in a block tagged with its name", async () => {
    const engine = new FakeEngine();
    await calls([engine]).ask({
      ...question,
      context: { "first-message": "Plan a trip to Rome", "first-answer": "Sure." },
    });
    expect(engine.requests[0]?.prompt).toBe(
      "Name this chat.\n\n<first-message>\nPlan a trip to Rome\n</first-message>\n\n<first-answer>\nSure.\n</first-answer>",
    );
  });

  test("names a missing engine, a failed turn, a thrown error and a stream with no end", async () => {
    expect(await calls([]).ask(question)).toEqual({
      ok: false,
      failure: "missing",
      reason: "Eva did not find Claude Code on this machine.",
    });
    const failing = new FakeEngine(() => [{ kind: "turn_failed", reason: "Not logged in: secret-value" }]);
    expect(await calls([failing]).ask(question)).toEqual({
      ok: false,
      failure: "failed",
      reason: "Not logged in: [redacted]",
    });
    const broken: EnginePort = {
      name: "pi",
      runTurn() {
        throw new Error("spawn failed: secret-value");
      },
    };
    expect(await calls([broken]).ask({ ...question, engine: "pi" })).toEqual({
      ok: false,
      failure: "failed",
      reason: "spawn failed: [redacted]",
    });
    const quiet = new FakeEngine(() => [{ kind: "text", text: "half", messageId: "m1" }]);
    expect(await calls([quiet]).ask(question)).toEqual({
      ok: false,
      failure: "failed",
      reason: "Claude Code stopped without an answer.",
    });
  });

  test("ends at its time limit, even when the engine never answers the abort", async () => {
    const silent: EnginePort = {
      name: "pi",
      async *runTurn(request) {
        await new Promise((resolve) => request.signal.addEventListener("abort", resolve));
        yield { kind: "turn_failed", reason: "aborted" };
      },
    };
    expect(await calls([silent], 20).ask({ ...question, engine: "pi" })).toEqual({
      ok: false,
      failure: "late",
      reason: "pi gave no answer in time.",
    });
    // pi answers an abort only over its RPC channel, so a stuck pi may never end the stream.
    const deaf: EnginePort = {
      name: "pi",
      async *runTurn() {
        await new Promise(() => undefined);
        yield { kind: "turn_failed", reason: "never" };
      },
    };
    expect(await calls([deaf]).ask({ ...question, engine: "pi", timeoutMs: 20 })).toEqual({
      ok: false,
      failure: "late",
      reason: "pi gave no answer in time.",
    });
  });
});

describe("cheapestModel", () => {
  test("Claude Code takes haiku; pi keeps the chat's model, because pi has no fixed cheap model", () => {
    expect(cheapestModel("claude-code", "opus")).toBe("haiku");
    expect(cheapestModel("pi", "sonnet")).toBe("sonnet");
  });
});

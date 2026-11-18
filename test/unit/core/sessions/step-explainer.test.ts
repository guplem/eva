import { describe, expect, test } from "bun:test";
import { ModelCalls } from "../../../../src/core/model-calls/model-calls.ts";
import { StepExplainer, type StepExplainInput } from "../../../../src/core/sessions/step-explainer.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";

function explainer(script?: FakeTurnScript): {
  explainer: StepExplainer;
  engine: FakeEngine;
  logs: { level: LogLevel; message: string }[];
} {
  const engine = new FakeEngine(script);
  const calls = new ModelCalls({ engines: [engine], environment: {}, redact: (text) => text, timeoutMs: 5_000 });
  const logs: { level: LogLevel; message: string }[] = [];
  return {
    engine,
    logs,
    explainer: new StepExplainer({
      modelCalls: calls,
      logger: { log: (level, message) => logs.push({ level, message }) },
    }),
  };
}

const input: StepExplainInput = {
  engine: "claude-code",
  model: "opus",
  kind: "command",
  input: '{"command":"rm -rf build && mkdir build"}',
  output: "done",
  chatText: "Limpia la carpeta build",
};

describe("the step explainer (#963)", () => {
  test("it gives the cheapest model the input and the output, and returns the trimmed text", async () => {
    const { explainer: steps, engine } = explainer((request) => FakeEngine.answer(request, "  1. Delete build.  "));
    expect(await steps.explain(input)).toEqual({ ok: true, text: "1. Delete build." });
    const request = engine.requests[0];
    expect(request?.model).toBe("haiku");
    expect(request?.appendSystemPrompt).toContain("plain words");
    expect(request?.prompt).toContain("<input>");
    expect(request?.prompt).toContain("rm -rf build");
    expect(request?.prompt).toContain("<output>\ndone\n</output>");
    expect(request?.prompt).toContain("<chat-language>\nLimpia la carpeta build\n</chat-language>");
  });

  test("a long input or output is cut, so the call stays small", async () => {
    const { explainer: steps, engine } = explainer((request) => FakeEngine.answer(request, "1. Run it."));
    await steps.explain({ ...input, input: "a".repeat(50_000), output: "b".repeat(50_000) });
    const prompt = engine.requests[0]?.prompt ?? "";
    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).toContain("…");
  });

  test("a step with no input fails without a model call", async () => {
    const { explainer: steps, engine } = explainer();
    const result = await steps.explain({ ...input, input: "" });
    expect(result.ok).toBe(false);
    expect(engine.requests).toHaveLength(0);
  });

  test("an empty answer is a failure, and a failed call is logged", async () => {
    const empty = explainer((request) => FakeEngine.answer(request, "   "));
    expect((await empty.explainer.explain(input)).ok).toBe(false);
    const failing = explainer(() => [{ kind: "turn_failed", reason: "no login" }]);
    const result = await failing.explainer.explain(input);
    expect(result.ok).toBe(false);
    expect(failing.logs.some((log) => log.level === "warn")).toBe(true);
  });
});

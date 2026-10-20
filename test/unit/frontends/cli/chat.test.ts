import { describe, expect, test } from "bun:test";
import { createEventPrinter } from "../../../../src/frontends/cli/chat.ts";
import type { EngineEventPayload, SessionEvent } from "../../../../src/shared/events.ts";

let seq = 0;
function stamped(payload: EngineEventPayload): SessionEvent {
  seq += 1;
  return { ...payload, sessionId: "s1", seq, at: "2026-10-20T10:00:00.000Z" };
}

function printed(payloads: readonly EngineEventPayload[]): string {
  const print = createEventPrinter();
  return payloads.map((payload) => print(stamped(payload)) ?? "").join("");
}

const finished: EngineEventPayload = {
  kind: "turn_finished",
  engineSessionId: "e1",
  lastMessageId: null,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: null,
  contextTokens: null,
  contextWindow: null,
};

describe("createEventPrinter", () => {
  test("writes each piece at once, and only the rest of the block at its final text", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Hello " },
        { kind: "text_delta", text: "there " },
        { kind: "text", text: "Hello there friend.", messageId: "m1" },
        finished,
      ]),
    ).toBe("Hello there friend.\n");
  });

  test("a block with no pieces prints whole, as before", () => {
    expect(printed([{ kind: "text", text: "Done.", messageId: "m1" }, finished])).toBe("Done.\n");
  });

  test("a final text that differs from the pieces starts on a new line, in full", () => {
    expect(
      printed([
        { kind: "text_delta", text: "-----BEGIN RSA " },
        { kind: "text", text: "[redacted]", messageId: "m1" },
      ]),
    ).toBe("-----BEGIN RSA \n[redacted]\n");
  });

  test("another line during the pieces ends the open line, and the block never prints twice", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Let me " },
        { kind: "tool_finished", toolUseId: "t1", isError: false },
        { kind: "notice", text: "A server did not start." },
        { kind: "text", text: "Let me look.", messageId: "m1" },
      ]),
    ).toBe("Let me \n  (A server did not start.)\nlook.\n");
  });

  test("a turn that fails during the pieces ends the open line", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Let me " },
        { kind: "turn_failed", reason: "stopped" },
      ]),
    ).toBe("Let me \n  The turn failed: stopped\n");
    expect(printed([{ kind: "text_delta", text: "Half " }, finished])).toBe("Half \n");
  });
});

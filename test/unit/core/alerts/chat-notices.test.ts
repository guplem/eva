import { describe, expect, test } from "bun:test";
import { ChatNotices, type ChatNotice } from "../../../../src/core/alerts/chat-notices.ts";
import type { EngineEventPayload, CoreEventPayload } from "../../../../src/shared/events.ts";

const chats: Record<string, { title: string; source: "web" | "telegram" | "schedule" | "cli" }> = {
  web: { title: "Plan the trip", source: "web" },
  daily: { title: "Daily summary", source: "schedule" },
  untitled: { title: "", source: "web" },
};

function notices(): {
  readonly sent: ChatNotice[];
  readonly feed: (sessionId: string, ...payloads: Payload[]) => void;
} {
  const sent: ChatNotice[] = [];
  const center = new ChatNotices({
    chatOf: (sessionId) => chats[sessionId] ?? null,
    onNotice: (notice) => sent.push(notice),
  });
  let seq = 0;
  return {
    sent,
    feed: (sessionId, ...payloads) => {
      for (const payload of payloads) {
        seq += 1;
        center.handle({ ...payload, sessionId, seq, at: "2026-10-22T08:00:00.000Z" });
      }
    },
  };
}

type Payload = EngineEventPayload | CoreEventPayload;

const finished: Payload = {
  kind: "turn_finished",
  engineSessionId: "engine-1",
  lastMessageId: null,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: null,
  contextTokens: null,
  contextWindow: null,
};

function received(origin: "api" | "telegram" | "schedule" | "eva"): Payload {
  return { kind: "message_received", text: "Hello", origin };
}

function text(value: string): Payload {
  return { kind: "text", text: value, messageId: "m1" };
}

describe("a finished turn", () => {
  test("sends a reply notice with the chat title and the start of the last text", () => {
    const { sent, feed } = notices();
    feed("web", received("api"), text("First part."), text("The trip   is\nready."), finished);
    expect(sent).toEqual([
      { kind: "replies", sessionId: "web", key: "chat:web", title: "Plan the trip", body: "The trip is ready." },
    ]);
  });

  test("cuts a long text", () => {
    const { sent, feed } = notices();
    feed("web", received("api"), text("word ".repeat(100)), finished);
    expect(sent[0]?.body.length).toBeLessThanOrEqual(160);
    expect(sent[0]?.body.endsWith("…")).toBe(true);
  });

  test("says that Eva finished when the turn wrote no text", () => {
    const { sent, feed } = notices();
    feed("untitled", received("api"), finished);
    expect(sent).toEqual([
      { kind: "replies", sessionId: "untitled", key: "chat:untitled", title: "Eva", body: "Eva finished." },
    ]);
  });

  test("of a schedule's chat sends a schedule notice", () => {
    const { sent, feed } = notices();
    feed("daily", received("schedule"), text("Three meetings today."), finished);
    expect(sent.map((notice) => notice.kind)).toEqual(["schedules"]);
  });

  test("that failed says why", () => {
    const { sent, feed } = notices();
    feed("web", received("api"), text("Half"), { kind: "turn_failed", reason: "The engine stopped." });
    expect(sent[0]?.body).toBe("Eva could not finish: The engine stopped.");
  });

  test("started from Telegram sends nothing: Telegram shows the answer already", () => {
    const { sent, feed } = notices();
    feed("web", received("telegram"), text("Answer"), finished);
    expect(sent).toEqual([]);
  });

  test("does not carry its text into the next turn", () => {
    const { sent, feed } = notices();
    feed("web", received("api"), text("Old answer"), finished, received("api"), finished);
    expect(sent.map((notice) => notice.body)).toEqual(["Old answer", "Eva finished."]);
  });

  test("of a chat that is gone sends nothing", () => {
    const { sent, feed } = notices();
    feed("deleted", received("api"), text("Answer"), finished);
    expect(sent).toEqual([]);
  });
});

describe("an approval", () => {
  test("sends an approval notice", () => {
    const { sent, feed } = notices();
    feed("web", received("api"), { kind: "approval_needed", requestId: "r1", toolName: "Bash", summary: "rm -r old" });
    expect(sent).toEqual([
      {
        kind: "approvals",
        sessionId: "web",
        key: "approval:web",
        title: "Plan the trip",
        body: "Eva waits for your approval: rm -r old",
      },
    ]);
  });

  test("in a turn that Telegram started sends nothing", () => {
    const { sent, feed } = notices();
    feed("web", received("telegram"), { kind: "approval_needed", requestId: "r1", toolName: "Bash", summary: "ls" });
    expect(sent).toEqual([]);
  });
});

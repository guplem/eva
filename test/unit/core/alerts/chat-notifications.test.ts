import { describe, expect, test } from "bun:test";
import { ChatNotifications, type ChatNotification } from "../../../../src/core/alerts/chat-notifications.ts";
import type { CoreEventPayload, EngineEventPayload } from "../../../../src/shared/events.ts";

type Payload = EngineEventPayload | CoreEventPayload;

const titles: Record<string, string> = {
  web: "Plan the trip",
  daily: "Daily summary",
  untitled: "",
  project: "Fix the login",
};

interface Fake {
  readonly sent: ChatNotification[];
  readonly feed: (sessionId: string, ...payloads: Payload[]) => void;
  readonly idle: (sessionId: string, stopped?: boolean) => void;
}

function notifications(): Fake {
  const sent: ChatNotification[] = [];
  const center = new ChatNotifications({
    chatOf: (sessionId) => (sessionId in titles ? { title: titles[sessionId] ?? "" } : null),
    onNotification: (notification) => sent.push(notification),
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
    idle: (sessionId, stopped = false) => {
      center.idle(sessionId, { stopped });
    },
  };
}

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

const approval: Payload = { kind: "approval_needed", requestId: "r1", toolName: "Bash", summary: "rm -r old" };

describe("a chat that is free again", () => {
  test("sends a reply with the chat title and the start of the last text", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("First part."), text("The trip   is\nready."), finished);
    expect(sent).toEqual([]);
    idle("web");
    expect(sent).toEqual([
      { kind: "replies", sessionId: "web", key: "chat:web", title: "Plan the trip", body: "The trip is ready." },
    ]);
  });

  test("sends one reply after the follow-up turns of the mode, with the last text", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("Step one."), finished, text("All done."), finished);
    idle("web");
    expect(sent.map((notification) => notification.body)).toEqual(["All done."]);
  });

  test("cuts a long text", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("word ".repeat(100)), finished);
    idle("web");
    expect(sent[0]?.body.length).toBeLessThanOrEqual(160);
    expect(sent[0]?.body.endsWith("…")).toBe(true);
  });

  test("says that Eva finished when the turn wrote no text, under Eva's name for a chat with no title", () => {
    const { sent, feed, idle } = notifications();
    feed("untitled", received("api"), finished);
    idle("untitled");
    expect(sent).toMatchObject([{ title: "Eva", body: "Eva finished." }]);
  });

  test("after a schedule's message sends a schedule notification, and the person's next message a reply", () => {
    const { sent, feed, idle } = notifications();
    feed("daily", received("schedule"), text("Three meetings today."), finished);
    idle("daily");
    feed("daily", received("api"), text("Moved one."), finished);
    idle("daily");
    expect(sent.map((notification) => notification.kind)).toEqual(["schedules", "replies"]);
  });

  test("after a failed turn says why", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("Half"), { kind: "turn_failed", reason: "The engine stopped." });
    idle("web");
    expect(sent[0]?.body).toBe("Eva could not finish: The engine stopped.");
  });

  test("after a stop sends nothing: the person stopped it", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("Half"), { kind: "turn_failed", reason: "Stopped." });
    idle("web", true);
    expect(sent).toEqual([]);
  });

  test("after a turn that Telegram started sends nothing, also after its follow-up turns", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("telegram"), text("Answer"), finished, text("More"), finished, approval);
    idle("web");
    expect(sent).toEqual([]);
  });

  test("with no turn sends nothing", () => {
    const { sent, idle } = notifications();
    idle("web");
    expect(sent).toEqual([]);
  });

  test("does not carry the text of a run into the next one", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), text("Old answer"), finished);
    idle("web");
    feed("web", received("api"), finished);
    idle("web");
    expect(sent.map((notification) => notification.body)).toEqual(["Old answer", "Eva finished."]);
  });

  test("that is gone sends nothing", () => {
    const { sent, feed, idle } = notifications();
    feed("deleted", received("api"), text("Answer"), finished);
    idle("deleted");
    feed("web", received("api"), finished, { kind: "session_deleted" });
    idle("web");
    expect(sent).toEqual([]);
  });

  test("of a project chat that reports back sends nothing: the report in the asking chat does", () => {
    const { sent, feed, idle } = notifications();
    feed("web", received("api"), {
      kind: "project_work_started",
      projectId: "p",
      projectSessionId: "project",
      request: "x",
    });
    feed("project", received("eva"), text("Fixed."), finished);
    idle("project");
    feed("web", received("eva"), text("The project chat fixed the login."), finished);
    idle("web");
    expect(sent.map((notification) => notification.sessionId)).toEqual(["web"]);
    // The next run of that project chat is the person's own, so it rings.
    feed("project", received("api"), text("Done."), finished);
    idle("project");
    expect(sent.map((notification) => notification.sessionId)).toEqual(["web", "project"]);
  });

  test("of a project chat that the person stopped does not silence its next run", () => {
    const { sent, feed, idle } = notifications();
    feed("web", { kind: "project_work_started", projectId: "p", projectSessionId: "project", request: "x" });
    feed("project", received("eva"), { kind: "turn_failed", reason: "Stopped." });
    idle("project", true);
    feed("project", received("api"), text("Done."), finished);
    idle("project");
    expect(sent.map((notification) => notification.sessionId)).toEqual(["project"]);
  });

  test("keeps the kind of a schedule's run through the report turn of its project work", () => {
    const { sent, feed, idle } = notifications();
    feed("daily", received("schedule"), text("I asked the project chat."), finished);
    idle("daily");
    feed("daily", received("eva"), text("The project chat is done."), finished);
    idle("daily");
    expect(sent.map((notification) => notification.kind)).toEqual(["schedules", "schedules"]);
  });
});

describe("an approval", () => {
  test("sends an approval at once, under the chat's key, so the answer replaces it", () => {
    const { sent, feed } = notifications();
    feed("web", received("api"), approval);
    expect(sent).toEqual([
      {
        kind: "approvals",
        sessionId: "web",
        key: "chat:web",
        title: "Plan the trip",
        body: "Eva waits for your approval: rm -r old",
      },
    ]);
  });
});

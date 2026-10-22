/**
 * Turns the events of the chats into notices for the person's devices (#360): a finished turn, a
 * schedule's turn and an approval that waits. A person who left the page learns that Eva needs them.
 */
import type { MessageOrigin, SessionEvent } from "../../shared/events.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

/** What a device can get. Each device picks its own kinds. */
export const notificationKinds = ["replies", "schedules", "approvals", "alerts"] as const;

export type NotificationKind = (typeof notificationKinds)[number];

export interface ChatNotice {
  readonly kind: Exclude<NotificationKind, "alerts">;
  readonly sessionId: string;
  /** A new notice with the same key replaces the old one on the device. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

export interface ChatNoticesOptions {
  /** The chat's title and source, or null when the chat is gone. */
  readonly chatOf: (sessionId: string) => Pick<SessionRecord, "title" | "source"> | null;
  readonly onNotice: (notice: ChatNotice) => void;
}

interface TurnState {
  origin: MessageOrigin | null;
  lastText: string | null;
}

/** A lock screen shows about two lines. */
const maxBodyLength = 160;

export class ChatNotices {
  private readonly options: ChatNoticesOptions;
  private readonly turns: Map<string, TurnState>;

  constructor(options: ChatNoticesOptions) {
    this.options = options;
    this.turns = new Map();
  }

  handle(event: SessionEvent): void {
    const turn = this.turnOf(event.sessionId);
    switch (event.kind) {
      case "message_received":
        turn.origin = event.origin;
        turn.lastText = null;
        return;
      case "text":
        turn.lastText = event.text;
        return;
      case "approval_needed":
        this.send(event.sessionId, turn, "approvals", `Eva waits for your approval: ${event.summary}`);
        return;
      case "turn_finished":
      case "turn_failed": {
        this.turns.delete(event.sessionId);
        const body =
          event.kind === "turn_failed" ? `Eva could not finish: ${event.reason}` : (turn.lastText ?? "Eva finished.");
        this.send(event.sessionId, turn, "replies", body);
        return;
      }
      case "session_deleted":
        this.turns.delete(event.sessionId);
        return;
      default:
        return;
    }
  }

  private turnOf(sessionId: string): TurnState {
    let turn = this.turns.get(sessionId);
    if (turn === undefined) {
      turn = { origin: null, lastText: null };
      this.turns.set(sessionId, turn);
    }
    return turn;
  }

  private send(sessionId: string, turn: TurnState, kind: "replies" | "approvals", body: string): void {
    // Telegram shows the answer and the approval of a turn that it started, so a push would ring twice.
    if (turn.origin === "telegram") return;
    const chat = this.options.chatOf(sessionId);
    if (chat === null) return;
    this.options.onNotice({
      kind: kind === "replies" && chat.source === "schedule" ? "schedules" : kind,
      sessionId,
      key: `${kind === "approvals" ? "approval" : "chat"}:${sessionId}`,
      title: chat.title.trim() === "" ? "Eva" : chat.title,
      body: shorten(body),
    });
  }
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxBodyLength ? flat : `${flat.slice(0, maxBodyLength - 1).trimEnd()}…`;
}

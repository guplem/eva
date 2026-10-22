/**
 * Turns the events of the chats into notifications for the person's devices (#360): Eva is done,
 * a schedule's work is done, or an approval waits. A person who left the page learns that Eva
 * needs them.
 */
import type { MessageOrigin, SessionEvent } from "../../shared/events.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

/** What a device can get. Each device picks its own kinds. `alerts` are Eva's problem alerts. */
export const notificationKinds = ["replies", "schedules", "approvals", "alerts"] as const;

export type NotificationKind = (typeof notificationKinds)[number];

export interface ChatNotification {
  readonly kind: Exclude<NotificationKind, "alerts">;
  readonly sessionId: string;
  /**
   * A new notification with the same key replaces the old one on the device. The answer and the
   * approval of a chat share it, so the answer replaces an approval that is no longer open.
   */
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

export interface ChatNotificationsOptions {
  /** The chat's title, or null when the chat is gone. */
  readonly chatOf: (sessionId: string) => Pick<SessionRecord, "title"> | null;
  readonly onNotification: (notification: ChatNotification) => void;
}

/** A lock screen shows about two lines. */
const maxBodyLength = 160;

export class ChatNotifications {
  private readonly options: ChatNotificationsOptions;
  /**
   * Who sent the last message of each chat. A follow-up turn of the mode and a retry have no
   * message of their own, so the origin stays until the next message.
   */
  private readonly origins: Map<string, MessageOrigin>;
  /** The newest text of the chat's current run of turns. */
  private readonly lastTexts: Map<string, string>;
  /** How the last turn ended: the body of the notification that the chat sends when it is free. */
  private readonly endings: Map<string, string>;
  /** The project chats that report back to another chat: the report is the notification. */
  private readonly reportingChats: Set<string>;

  constructor(options: ChatNotificationsOptions) {
    this.options = options;
    this.origins = new Map();
    this.lastTexts = new Map();
    this.endings = new Map();
    this.reportingChats = new Set();
  }

  handle(event: SessionEvent): void {
    const { sessionId } = event;
    switch (event.kind) {
      case "message_received":
        this.origins.set(sessionId, event.origin);
        return;
      case "text":
        this.lastTexts.set(sessionId, event.text);
        return;
      case "approval_needed":
        this.send(sessionId, "approvals", `Eva waits for your approval: ${event.summary}`);
        return;
      case "turn_finished":
        this.endings.set(sessionId, this.lastTexts.get(sessionId) ?? "Eva finished.");
        return;
      case "turn_failed":
        this.endings.set(sessionId, `Eva could not finish: ${event.reason}`);
        return;
      case "project_work_started":
        this.reportingChats.add(event.projectSessionId);
        return;
      case "session_deleted":
        this.forget(sessionId);
        this.origins.delete(sessionId);
        this.reportingChats.delete(sessionId);
        return;
      default:
        return;
    }
  }

  /**
   * The chat is free again. Only now Eva is done: a turn end can still have a follow-up turn of
   * the mode after it. A run that the person stopped sends nothing: they know already.
   */
  idle(sessionId: string, state: { readonly stopped: boolean }): void {
    const ending = this.endings.get(sessionId);
    this.forget(sessionId);
    if (ending === undefined || state.stopped) return;
    // The project chat's report reaches the chat that asked, as a turn there: one notification is enough.
    if (this.reportingChats.delete(sessionId)) return;
    const kind = this.origins.get(sessionId) === "schedule" ? "schedules" : "replies";
    this.send(sessionId, kind, ending);
  }

  private forget(sessionId: string): void {
    this.lastTexts.delete(sessionId);
    this.endings.delete(sessionId);
  }

  private send(sessionId: string, kind: ChatNotification["kind"], body: string): void {
    // Telegram shows the answer and the approval of a turn that it started, so a push would ring twice.
    if (this.origins.get(sessionId) === "telegram") return;
    const chat = this.options.chatOf(sessionId);
    if (chat === null) return;
    this.options.onNotification({
      kind,
      sessionId,
      key: `chat:${sessionId}`,
      title: chat.title.trim() === "" ? "Eva" : chat.title,
      body: shorten(body),
    });
  }
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxBodyLength ? flat : `${flat.slice(0, maxBodyLength - 1).trimEnd()}…`;
}

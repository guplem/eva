/**
 * The chats of every front end in Telegram (#9): /chats binds a web or terminal chat to a topic,
 * a Project chat that a Telegram chat started gets a topic and a link, and a delete reaches
 * Telegram from any front end.
 */
import type { Eva } from "../../core/eva.ts";
import { extractFileMarkers } from "../../shared/file-markers.ts";
import type { SessionRecord } from "../../core/sessions/session-store.ts";
import { isEvaError } from "../../shared/errors.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { keyOf, titleOf } from "./telegram-messages.ts";
import type { TelegramSender } from "./telegram-sender.ts";
import { isScheduleTopic, placeOf, targetOf, type BotState } from "./telegram-state.ts";
import { personWords, reportText } from "../../shared/project-report.ts";

type Turn = SessionRecord["turns"][number];

/** What a newly bound chat shows: the turns before the bind, and whether a turn runs. */
interface ChatHistory {
  readonly turns: readonly Turn[];
  readonly working: boolean;
}

type OpenedTopic =
  | { readonly kind: "opened"; readonly topicId: number }
  | { readonly kind: "no_topics"; readonly history: ChatHistory }
  | { readonly kind: "failed"; readonly reason: string }
  /** Another press or a project work opens this chat's topic now. */
  | { readonly kind: "opening" };

/** An event that waits while its chat's topic opens, with the answer that the record held then. */
interface WaitingEvent {
  readonly event: SessionEvent;
  readonly answer: string | null;
}

export interface TelegramChatsOptions {
  readonly api: TelegramApi;
  readonly sender: TelegramSender;
  readonly eva: Eva;
  /** The bot's state; a bound chat keeps its topic in it. */
  readonly state: BotState;
  readonly saveState: () => void;
  readonly describeError: (error: unknown) => string;
  /** Shows "typing" in the topic until the chat's turn ends. */
  readonly startTyping: (chatId: number, topicId: number | null, sessionId: string) => void;
  /** Drops the typing and the answer text that a deleted chat left in the bot. */
  readonly forgetLive: (sessionId: string) => void;
  /** Shows one event where its chat lives; a waiting turn end brings the answer it had then. */
  readonly dispatch: (event: SessionEvent, waitedAnswer: string | null) => Promise<void>;
}

/** At most this many chats in one /chats answer; the web app lists the rest. */
const chatListLimit = 10;
/** The turns that a topic shows when it opens for a chat that has a history. */
const replayedTurns = 3;

export class TelegramChats {
  private readonly options: TelegramChatsOptions;
  /** The events of each chat whose topic opens now, to show once the topic exists. */
  private readonly opening: Map<string, WaitingEvent[]>;

  constructor(options: TelegramChatsOptions) {
    this.options = options;
    this.opening = new Map();
  }

  /** True when the event waits for its chat's topic; the flush shows it later. */
  wait(event: SessionEvent): boolean {
    const waiting = this.opening.get(event.sessionId);
    if (waiting === undefined) return false;
    // A later turn may end before the flush, so the answer is read now.
    waiting.push({ event, answer: event.kind === "turn_finished" ? this.lastAnswerOf(event.sessionId) : null });
    return true;
  }

  /** The answer of a chat's last turn, or null when the chat has none. */
  lastAnswerOf(sessionId: string): string | null {
    return this.turnsOf(sessionId).at(-1)?.answerText ?? null;
  }

  /** /chats: the newest chats of every front end, but not the archived ones. A schedule's chats live in its own topic. */
  async list(chatId: number, topicId: number | null): Promise<void> {
    const chats = this.options.eva.sessions
      .list()
      .filter((session) => session.parentId === null && session.source !== "schedule" && !session.archived)
      .sort((first, second) => lastActivityOf(second).localeCompare(lastActivityOf(first)))
      .slice(0, chatListLimit);
    if (chats.length === 0) {
      await this.options.sender.send(chatId, topicId, "No chats yet. Write a message to start one.");
      return;
    }
    await this.options.sender.send(chatId, topicId, "Pick a chat to continue it here:", {
      inline_keyboard: chats.map((chat) => [
        { text: `${chat.mode === "project" ? "Project: " : ""}${chat.title}`, callback_data: `o:${chat.id}` },
      ]),
    });
  }

  /**
   * Binds a chat of any front end to a topic of its own, with its last turns. Without topics,
   * the main chat continues it instead, as /new does (lesson 61).
   */
  async continueChat(chatId: number, topicId: number | null, sessionId: string): Promise<void> {
    const sender = this.options.sender;
    const session = this.options.eva.sessions.list().find((candidate) => candidate.id === sessionId);
    if (session === undefined) {
      await sender.send(chatId, topicId, "That chat no longer exists.");
      return;
    }
    const bound = targetOf(this.options.state, sessionId);
    if (bound !== null) {
      await sender.send(
        chatId,
        topicId,
        bound.topicId === null
          ? "This chat already continues in the main chat."
          : `This chat already has its topic: ${topicName(bound.chatId, bound.topicId, session.title)}.`,
      );
      return;
    }
    const opened = await this.openTopicFor(chatId, sessionId, session.title);
    if (opened.kind === "opened") {
      await sender.send(chatId, topicId, `This chat continues in ${topicName(chatId, opened.topicId, session.title)}.`);
      return;
    }
    if (opened.kind === "opening") {
      await sender.send(chatId, topicId, "Eva opens a topic for this chat already. It comes in a moment.");
      return;
    }
    try {
      if (opened.kind === "failed") {
        // A chat with topics must not lose its main chat to a short Telegram problem.
        await sender.send(chatId, topicId, `Telegram did not open the topic: ${opened.reason} Press the chat again.`);
        return;
      }
      const main = this.options.state.topics[keyOf(chatId, null)];
      if (main !== undefined && this.options.eva.sessions.isActive(main.sessionId)) {
        // Never take the main chat from a turn that runs (lesson 49).
        await sender.send(chatId, null, "Eva is still working in this chat. Press the chat again when she finishes.");
        return;
      }
      this.options.state.topics[keyOf(chatId, null)] = { sessionId, openedByEva: false, renamed: true };
      this.options.saveState();
      await sender.send(
        chatId,
        null,
        `The main chat now continues “${session.title}”. The chat before it stays in the web app and in /chats.`,
      );
      await this.showHistory(chatId, null, sessionId, opened.history);
    } finally {
      // The chat's events waited for the bind; without one, only an approval shows.
      await this.flushOpening(sessionId);
    }
  }

  /**
   * A Telegram chat gave work to a project: the Project chat gets a topic, and the asking chat
   * gets a link to it, and to the web chat when Tailscale gives Eva an address.
   */
  async showProjectWork(event: Extract<SessionEvent, { kind: "project_work_started" }>): Promise<void> {
    const asking = targetOf(this.options.state, event.sessionId);
    if (asking === null || !this.sessionExists(event.projectSessionId)) return;
    const project =
      this.options.eva.projects().find((candidate) => candidate.id === event.projectId)?.title ?? event.projectId;
    const name = titleOf(`${project}: ${event.request}`);
    const opened = await this.openTopicFor(asking.chatId, event.projectSessionId, name);
    // Without a topic, the Project chat lives on the web only: its waiting events go nowhere.
    if (opened.kind === "no_topics" || opened.kind === "failed") await this.flushOpening(event.projectSessionId);
    const topicId = opened.kind === "opened" ? opened.topicId : null;
    const url = this.options.eva.status().remoteAccess?.url ?? null;
    const lines = [
      topicId === null
        ? `Project work started in ${project}.${url === null ? " Follow it in the web app, in Project mode." : ""}`
        : `Project work started in ${project}. Follow it in ${topicName(asking.chatId, topicId, name)}.`,
      ...(url === null ? [] : [`Web: ${url}/#/chat/${encodeURIComponent(event.projectSessionId)}`]),
    ];
    await this.options.sender.send(asking.chatId, asking.topicId, lines.join("\n"));
  }

  /** Deletes the chat in every front end first, so a busy chat keeps its topic. */
  async deleteTopic(chatId: number, topicId: number): Promise<void> {
    if (!(await this.deleteChatOf(chatId, topicId))) return;
    // A schedule's topic holds its earlier firings too, so only the firing's chat goes.
    if (isScheduleTopic(this.options.state, topicId)) {
      await this.options.sender.send(chatId, topicId, "Deleted. The next firing starts a new chat here.");
      return;
    }
    try {
      await this.options.api.call("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
    } catch (error) {
      await this.options.sender.send(
        chatId,
        topicId,
        `Telegram did not delete the topic: ${this.options.describeError(error)}`,
      );
    }
  }

  /** The main chat has no topic to delete: only its chat goes, and its messages stay. */
  async deleteMainChat(chatId: number): Promise<void> {
    if (this.options.state.topics[keyOf(chatId, null)] === undefined) {
      await this.options.sender.send(chatId, null, "There is no chat here to delete.");
      return;
    }
    if (await this.deleteChatOf(chatId, null))
      await this.options.sender.send(chatId, null, "Deleted. A new message starts a new chat.");
  }

  /**
   * A chat deleted in another front end. Eva deletes a topic that she opened for it. Any other
   * topic keeps its messages, and its next message starts a new chat. When only one branch went, the
   * fork that took its place goes on in its topic, unless that fork has a topic of its own (issue 647).
   */
  async forgetDeletedChat(sessionId: string, heirId?: string): Promise<void> {
    this.options.forgetLive(sessionId);
    for (const [key, entry] of Object.entries(this.options.state.topics)) {
      if (entry.sessionId !== sessionId) continue;
      if (heirId !== undefined && targetOf(this.options.state, heirId) === null) {
        this.options.state.topics[key] = { ...entry, sessionId: heirId };
        this.options.saveState();
        continue;
      }
      Reflect.deleteProperty(this.options.state.topics, key);
      this.options.saveState();
      const { chatId, topicId } = placeOf(key);
      if (topicId !== null && entry.openedByEva && !isScheduleTopic(this.options.state, topicId))
        await this.options.sender.quietCall("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
      else
        await this.options.sender.send(
          chatId,
          topicId,
          "This chat was deleted elsewhere. A new message starts a new chat.",
        );
    }
  }

  /** Deletes the chat of a topic or of the main chat in the core. False, after a sentence, when it still works. */
  private async deleteChatOf(chatId: number, topicId: number | null): Promise<boolean> {
    const key = keyOf(chatId, topicId);
    const entry = this.options.state.topics[key];
    if (entry === undefined) return true;
    // Forget the topic or the main chat first: the delete event of this chat then finds nothing to do here.
    Reflect.deleteProperty(this.options.state.topics, key);
    try {
      if (this.sessionExists(entry.sessionId)) this.options.eva.sessions.delete(entry.sessionId);
    } catch (error) {
      this.options.state.topics[key] = entry;
      if (!isEvaError(error, "session_busy")) throw error;
      await this.options.sender.send(
        chatId,
        topicId,
        "Eva is still working in this chat. Try again when she finishes.",
      );
      return false;
    }
    this.options.saveState();
    return true;
  }

  /**
   * Opens a topic for a chat, binds it, and shows its last turns. Only a refused topic (400)
   * means that this chat has no topics (lesson 61); any other failure says why. Without a
   * topic, the chat's events still wait: the caller binds the chat elsewhere, then flushes them.
   */
  private async openTopicFor(chatId: number, sessionId: string, name: string): Promise<OpenedTopic> {
    if (this.opening.has(sessionId)) return { kind: "opening" };
    // The chat's events wait from here: a turn that ends while Telegram opens the topic shows
    // once, after the turns that were in the record before.
    const history = { turns: this.turnsOf(sessionId), working: this.options.eva.sessions.isBusy(sessionId) };
    this.opening.set(sessionId, []);
    let topicId: number;
    try {
      const topic = await this.options.api.call<{ message_thread_id: number }>("createForumTopic", {
        chat_id: chatId,
        name: titleOf(name),
      });
      topicId = topic.message_thread_id;
    } catch (error) {
      if (error instanceof TelegramError && error.code === 400) return { kind: "no_topics", history };
      return { kind: "failed", reason: this.options.describeError(error) };
    }
    try {
      if (!this.sessionExists(sessionId)) {
        // Deleted while the topic opened: an empty topic would only confuse.
        await this.options.sender.quietCall("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
        return { kind: "failed", reason: "That chat no longer exists." };
      }
      // Eva named the topic, so the first message keeps that name (lesson 125).
      this.options.state.topics[keyOf(chatId, topicId)] = { sessionId, openedByEva: true, renamed: true };
      this.options.saveState();
      await this.showHistory(chatId, topicId, sessionId, history);
      return { kind: "opened", topicId };
    } finally {
      await this.flushOpening(sessionId);
    }
  }

  /**
   * The last turns of a newly bound chat. A turn that ran at the bind sent its message before,
   * so a sentence takes its place.
   */
  private async showHistory(
    chatId: number,
    topicId: number | null,
    sessionId: string,
    history: ChatHistory,
  ): Promise<void> {
    const sender = this.options.sender;
    if (history.turns.length > replayedTurns)
      await sender.send(
        chatId,
        topicId,
        `Earlier turns: ${String(history.turns.length)}. The web chat has all of them.`,
      );
    for (const turn of history.turns.slice(-replayedTurns)) {
      // A project work result shows as its summary, and the person's own words apart.
      for (const report of turn.projectReports) await sender.sendPlain(chatId, topicId, reportText(report));
      const words = personWords(turn);
      if (words !== null) await sender.sendPlain(chatId, topicId, `Message: ${words}`);
      if (turn.answerText.length > 0)
        await sender.sendAnswer(chatId, topicId, extractFileMarkers(turn.answerText).text);
      if (turn.failure !== null) await sender.send(chatId, topicId, `The turn failed: ${turn.failure}`);
    }
    if (!history.working) return;
    this.options.startTyping(chatId, topicId, sessionId);
    await sender.send(
      chatId,
      topicId,
      "Eva is working on a message from the web app or the terminal. Her answer comes here.",
    );
  }

  /** Shows the events that waited while a topic opened, in order, and then lets new events through. */
  private async flushOpening(sessionId: string): Promise<void> {
    const waiting = this.opening.get(sessionId) ?? [];
    try {
      // New events keep waiting while the loop sends, so they stay in order.
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift())
        await this.options.dispatch(next.event, next.answer);
    } finally {
      this.opening.delete(sessionId);
    }
  }

  private turnsOf(sessionId: string): readonly Turn[] {
    return this.options.eva.sessions.list().find((session) => session.id === sessionId)?.turns ?? [];
  }

  private sessionExists(sessionId: string): boolean {
    return this.options.eva.sessions.list().some((session) => session.id === sessionId);
  }
}

/** A topic's name, as a link in a supergroup: only there does Telegram give topics an address. */
function topicName(chatId: number, topicId: number, title: string): string {
  const link = topicLink(chatId, topicId);
  return link === null ? `the topic “${title}”` : `the topic “${title}” (${link})`;
}

/** A supergroup's id is -100 and then its own id; a topic link needs that own id. */
function topicLink(chatId: number, topicId: number): string | null {
  const id = String(chatId);
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${String(topicId)}` : null;
}

function lastActivityOf(session: SessionRecord): string {
  return session.lastTurnAt ?? session.createdAt;
}

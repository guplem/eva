/**
 * Eva in a Telegram chat, ported from Wall-I v1 with lessons 56 to 63
 * and 123 to 127. Each topic is one chat of the instance's single conversation list;
 * a message outside every topic belongs to the main chat.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Alert, AlertProblem } from "../../core/alerts/alert-center.ts";
import type { Eva } from "../../core/eva.ts";
import {
  describeLogEntries,
  describeProjectLines,
  describeStatusLines,
  describeSync,
  describeUpdate,
} from "../cli/client.ts";
import { describeAccess } from "../cli/network-setup.ts";
import { extractFileMarkers, OfferStore, resolveSendableFile, saveReceivedFile } from "../../core/files/vault-files.ts";
import { parseProjectQuery } from "../../core/projects/project-catalog.ts";
import type { DeviceLoginRequest } from "../../core/remote-access/device-logins.ts";
import type { ScheduleCard, ScheduleEvent } from "../../core/schedules/scheduler.ts";
import type { SessionRecord } from "../../core/sessions/session-store.ts";
import type { ModelAlias } from "../../shared/engine-port.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { type Clock, systemClock } from "../../shared/clock.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { isEvaError } from "../../shared/errors.ts";
import type { Logger } from "../../shared/logger.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { keepFencesWhole, splitForTelegram, toTelegramHtml } from "./telegram-format.ts";

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

export interface TelegramBotOptions {
  readonly api: TelegramApi;
  readonly eva: Eva;
  readonly statePath: string;
  readonly allowedChatId: number | null;
  /**
   * The person who paired the chat. In a group (topics need one), only this person may act.
   * Null for a chat paired before Eva kept it: then the chat id alone decides.
   */
  readonly allowedUserId: number | null;
  /** With no chat allowed yet, the chat that sends this code becomes the allowed one. */
  readonly pairingCode: string;
  readonly onPaired: (chatId: number, userId: number | null) => void;
  readonly logger?: Logger;
  readonly pollTimeoutSeconds?: number;
  readonly typingIntervalMs?: number;
  /** Turns a voice note into text. Without it, a voice note gets a sentence that says so. */
  readonly transcribe?: (audio: Uint8Array) => Promise<string>;
  /** Gives the time of each 409 conflict, for the conflict window. */
  readonly clock?: Clock;
  /** Waits before a retry. It must return early when the signal aborts, so a stop never waits. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** What the poll loop does now, for a status line. */
export type TelegramPollState =
  | { readonly kind: "polling" }
  | { readonly kind: "failing"; readonly since: string; readonly reason: string }
  /** Another program polls this bot; Eva pauses the poll loop, and the core runs on. */
  | { readonly kind: "conflict"; readonly since: string };

interface TopicEntry {
  readonly sessionId: string;
  readonly openedByEva: boolean;
  renamed: boolean;
}

interface BotState {
  offset: number;
  /** Key: `<chatId>:<topicId>` or `<chatId>:main`. */
  topics: Record<string, TopicEntry>;
  /** The topic of each schedule, by schedule id. */
  scheduleTopics: Record<string, number>;
}

interface TelegramChat {
  readonly id: number;
}

interface TelegramFile {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly file_size?: number;
  readonly file_name?: string;
}

interface TelegramPhotoSize extends TelegramFile {
  readonly width: number;
  readonly height: number;
}

interface TelegramMessage {
  readonly chat: TelegramChat;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly document?: TelegramFile;
  readonly voice?: TelegramFile;
  readonly audio?: TelegramFile;
  /** One photo in several sizes. */
  readonly photo?: readonly TelegramPhotoSize[];
  readonly message_thread_id?: number;
  readonly is_topic_message?: boolean;
}

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: {
    readonly id: string;
    readonly from?: { readonly id: number };
    readonly data?: string;
    readonly message?: TelegramMessage;
  };
}

/** Telegram refuses a message past 4096 characters; the split leaves room for the HTML tags. */
const messageLimit = 3_500;
/** The longest message that Telegram takes; `send` cuts a longer one. */
const telegramMessageLimit = 4_096;
/** At most this many projects in one /projects answer: a longer list is hard to read on a phone. */
const projectListLimit = 20;
/**
 * Lesson 56: count 409 conflicts in a window, and never let a success reset the count. Past
 * the limit, only the poll loop pauses: the owner reaches Eva from a phone, so Eva never exits.
 */
const conflictLimit = 3;
const conflictWindowMs = 2 * 60_000;
const conflictPauseMs = 10 * 60_000;
const firstRetryMs = 1_000;
const maxPollRetryMs = 60_000;
const sendRetries = 3;
const maxSendRetryMs = 30_000;
const confirmAttempts = 3;
/**
 * Message contents that Eva cannot read yet: the Telegram field, then its name in the reply.
 * A venue also carries a location, so it comes first. A service message (a new topic, a pin) gets no reply.
 */
const unreadableContents: readonly (readonly [string, string])[] = [
  ["sticker", "stickers"],
  ["video", "videos"],
  ["video_note", "video notes"],
  ["animation", "GIFs"],
  ["venue", "places"],
  ["location", "locations"],
  ["contact", "contacts"],
  ["poll", "polls"],
  ["dice", "dice"],
];
const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];
const deviceExpiredText = "This request expired.";
/** Telegram lets a bot download at most 20 MB. */
const maxDownloadBytes = 20 * 1024 * 1024;
/** Telegram refuses a keyboard of more than 100 buttons. */
const buttonsPerMessage = 50;
/** A short Telegram outage heals by itself; only a long one needs the owner. */
const pollFailingAlertMs = 15 * 60_000;
const pollProblemKey = "telegram_poll";
const defaultLogCount = 20;
/** At most this many chats in one /chats answer; the web app lists the rest. */
const chatListLimit = 10;
/** The turns that a topic shows when it opens for a chat that has a history. */
const replayedTurns = 3;

const commands: readonly { command: string; description: string }[] = [
  { command: "new", description: "Start a new chat in its own topic" },
  { command: "delete", description: "Delete this chat everywhere, with its topic" },
  { command: "rename", description: "Rename this chat and its topic: /rename <title>" },
  { command: "stop", description: "Stop Eva's work in this chat" },
  { command: "status", description: "Show Eva's state" },
  { command: "chats", description: "Continue a chat from the web app or the terminal here" },
  { command: "projects", description: "Search the projects: /projects [words] [status:active] [#tag]" },
  { command: "schedules", description: "List the schedules" },
  { command: "link", description: "The address that opens Eva on any device" },
  { command: "sync", description: "Sync the vault now" },
  { command: "update", description: "Install the latest version of Eva" },
  { command: "logs", description: "Show the last warnings and errors: /logs [count]" },
  { command: "restart", description: "Restart Eva" },
  { command: "help", description: "Show the commands" },
];

export class TelegramBot {
  private readonly options: TelegramBotOptions;
  private readonly state: BotState;
  private allowedChatId: number | null;
  private allowedUserId: number | null;
  private readonly pendingText = new Map<string, string[]>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeSchedules: () => void;
  private readonly unsubscribeAlerts: () => void;
  private readonly offers: OfferStore;
  private running = false;
  private readonly clock: Clock;
  /** The times (ms) of the recent 409 conflicts, inside the conflict window. */
  private conflictTimes: number[];
  private nextPollRetryMs: number;
  private currentPollState: TelegramPollState;
  /** Aborts at stop(), so a wait in the loop ends at once. */
  private stopping: AbortController;
  /** The approval and device login questions in the chat, by request id, so the answer can replace their buttons. */
  private readonly approvalMessages: Map<string, { chatId: number; messageId: number; text: string }>;
  /** The chats that /stop stopped, so their failed turn says "Stopped." instead of a failure. */
  private readonly stoppedSessions: Set<string>;
  /** The events of each chat whose topic opens now, to show once the topic exists. */
  private readonly opening: Map<string, WaitingEvent[]>;
  /** The card text of each schedule that was too long for Telegram, so the notice goes out once per card. */
  private readonly tooLongCards: Map<string, string>;
  private readonly detachDeviceApprover: () => void;

  constructor(options: TelegramBotOptions) {
    this.options = options;
    this.allowedChatId = options.allowedChatId;
    this.allowedUserId = options.allowedUserId;
    this.clock = options.clock ?? systemClock;
    this.conflictTimes = [];
    this.nextPollRetryMs = firstRetryMs;
    this.currentPollState = { kind: "polling" };
    this.stopping = new AbortController();
    this.approvalMessages = new Map();
    this.stoppedSessions = new Set();
    this.opening = new Map();
    this.tooLongCards = new Map();
    this.state = loadState(options.statePath);
    this.offers = new OfferStore(join(dirname(options.statePath), "telegram-offers.json"));
    this.unsubscribe = options.eva.sessions.subscribe((event) => {
      void this.onEvent(event);
    });
    this.unsubscribeSchedules =
      options.eva.schedules?.subscribe((event) => this.onScheduleEvent(event)) ?? ((): void => undefined);
    this.unsubscribeAlerts = options.eva.onAlert((alert) => this.sendAlert(alert));
    // The paired chat confirms each new browser of the web UI.
    this.detachDeviceApprover = options.eva.deviceLogins.attachApprover({
      canApprove: () => this.allowedChatId !== null,
      ask: (request) => {
        void this.askDeviceLogin(request);
      },
    });
  }

  async registerCommands(): Promise<void> {
    await this.quietCall("setMyCommands", { commands });
  }

  /** Polls until stop() is called. Telegram is the owner's only way in, so no error ends the loop. */
  async run(): Promise<void> {
    this.running = true;
    this.stopping = new AbortController();
    await this.registerCommands();
    while (this.isRunning()) {
      let waitMs: number;
      try {
        waitMs = await this.pollOnce();
      } catch (error) {
        // For example a full disk in saveState(): log it and poll again after a wait.
        this.options.logger?.log("error", "The Telegram poll loop failed; it continues.", { reason: String(error) });
        waitMs = this.takePollRetryMs();
      }
      if (waitMs > 0 && this.isRunning()) await this.sleep(waitMs);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  pollState(): TelegramPollState {
    return this.currentPollState;
  }

  /** One long poll and the handling of its updates. Returns how long to wait before the next poll. */
  async pollOnce(): Promise<number> {
    let updates: TelegramUpdate[];
    try {
      updates = await this.options.api.call<TelegramUpdate[]>("getUpdates", {
        offset: this.state.offset,
        timeout: this.options.pollTimeoutSeconds ?? 30,
        allowed_updates: ["message", "callback_query"],
      });
    } catch (error) {
      return this.onPollFailed(error);
    }
    this.nextPollRetryMs = firstRetryMs;
    this.currentPollState = { kind: "polling" };
    this.reportPollProblem();
    for (const update of updates) {
      this.state.offset = update.update_id + 1;
      this.saveState();
      try {
        await this.handle(update);
      } catch (error) {
        this.options.logger?.log("error", "A Telegram update failed.", { reason: String(error) });
      }
    }
    return 0;
  }

  /** Records a failed poll and returns the wait before the next one. */
  private onPollFailed(error: unknown): number {
    const now = this.clock.now();
    if (error instanceof TelegramError && error.code === 409) {
      this.conflictTimes = [
        ...this.conflictTimes.filter((time) => now.getTime() - time < conflictWindowMs),
        now.getTime(),
      ];
      if (this.conflictTimes.length >= conflictLimit) {
        this.conflictTimes = [];
        this.currentPollState = { kind: "conflict", since: now.toISOString() };
        this.options.logger?.log(
          "error",
          "Another program polls this Telegram bot. Eva pauses Telegram for 10 minutes.",
        );
        this.reportPollProblem();
        return conflictPauseMs;
      }
    }
    this.options.logger?.log("warn", "Telegram poll failed.", { reason: String(error) });
    if (this.currentPollState.kind !== "failing")
      this.currentPollState = { kind: "failing", since: now.toISOString(), reason: this.describeError(error) };
    this.reportPollProblem();
    if (error instanceof TelegramError && error.retryAfterSeconds !== null) return error.retryAfterSeconds * 1_000;
    return this.takePollRetryMs();
  }

  /**
   * Tells the core about a poll that cannot work. The bot cannot say it over Telegram, so the
   * problem must reach the status and the web UI.
   */
  private reportPollProblem(): void {
    this.options.eva.reportProblem(pollProblemKey, pollProblem(this.currentPollState, this.clock.now()));
  }

  /** Sends an alert to the main chat; before pairing, there is no chat to send it to. */
  private async sendAlert(alert: Alert): Promise<void> {
    if (this.allowedChatId === null) return;
    await this.send(
      this.allowedChatId,
      null,
      `${alert.level === "resolved" ? "Resolved" : "Problem"}: ${alert.message}`,
    );
  }

  /** The exponential backoff of the poll loop: 1 second, doubled after each failure, up to 60 seconds. */
  private takePollRetryMs(): number {
    const waitMs = this.nextPollRetryMs;
    this.nextPollRetryMs = Math.min(waitMs * 2, maxPollRetryMs);
    return waitMs;
  }

  private sleep(ms: number): Promise<void> {
    return (this.options.sleep ?? sleepUntilAborted)(ms, this.stopping.signal);
  }

  /** Stops polling and confirms the offset, so no update replays at the next start (lesson 57). */
  async stop(): Promise<void> {
    this.running = false;
    this.stopping.abort();
    this.unsubscribe();
    this.unsubscribeSchedules();
    this.unsubscribeAlerts();
    // A bot that stops (another machine became the hub) has no poll problem any more.
    this.options.eva.reportProblem(pollProblemKey, null);
    this.detachDeviceApprover();
    for (const timer of this.typingTimers.values()) clearInterval(timer);
    this.typingTimers.clear();
    for (let attempt = 0; attempt < confirmAttempts; attempt += 1) {
      try {
        await this.options.api.call("getUpdates", { offset: this.state.offset, timeout: 0 });
        return;
      } catch {
        // Try again; a replayed batch is the cost of three failures.
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query !== undefined) {
      await this.handleButton(update.callback_query);
      return;
    }
    const message = update.message;
    if (message === undefined) return;
    const chatId = message.chat.id;
    const topicId = message.is_topic_message === true ? (message.message_thread_id ?? null) : null;
    const text = (message.text ?? message.caption ?? "").trim();
    const file = receivedFileOf(message);
    const unreadable = unreadableContentOf(message);
    if (text.length === 0 && file === null && message.voice === undefined && unreadable === null) return;

    if (this.allowedChatId === null) {
      if (text === this.options.pairingCode) {
        this.allowedChatId = chatId;
        this.allowedUserId = message.from?.id ?? null;
        this.options.onPaired(chatId, this.allowedUserId);
        await this.send(chatId, null, "Paired. This chat now talks to Eva.");
      } else {
        await this.send(
          chatId,
          null,
          `This bot is private. Send the pairing code from \`eva status\` to use it. Your chat id is ${String(chatId)}.`,
        );
      }
      return;
    }
    if (chatId !== this.allowedChatId || !this.isAllowedSender(message.from?.id)) {
      await this.send(chatId, null, `This bot is private. Your chat id is ${String(chatId)}.`);
      return;
    }
    if (message.voice !== undefined) {
      await this.forwardVoice(chatId, topicId, message.voice);
      return;
    }
    // Before the text: a sticker or a video can carry a caption, and the person must learn that Eva missed the rest.
    if (unreadable !== null) {
      await this.send(chatId, topicId, `Eva cannot read ${unreadable} yet.`);
      return;
    }
    if (file !== null) {
      await this.forwardFile(chatId, topicId, file, text);
      return;
    }
    if (text.startsWith("/")) {
      await this.handleCommand(chatId, topicId, text);
      return;
    }
    await this.forward(chatId, topicId, text);
  }

  /** Saves a received file in Scratch/, so the agent can read it, and tells the chat where it is. */
  private async forwardFile(
    chatId: number,
    topicId: number | null,
    file: TelegramFile,
    caption: string,
  ): Promise<void> {
    const vaultPath = this.options.eva.status().vaultPath;
    if (vaultPath === null) {
      await this.send(chatId, topicId, "No vault is configured, so Eva cannot keep the file.");
      return;
    }
    const bytes = await this.download(chatId, topicId, file);
    if (bytes === null) return;
    const saved = saveReceivedFile(vaultPath, file.file_name ?? "file", bytes);
    await this.forward(chatId, topicId, `${caption}\n\n[The person sent a file, saved as ${saved}]`.trim());
  }

  /** Transcribes a voice note on this machine, echoes it, then sends it as the message (lesson 123). */
  private async forwardVoice(chatId: number, topicId: number | null, voice: TelegramFile): Promise<void> {
    const transcribe = this.options.transcribe;
    if (transcribe === undefined) {
      await this.send(chatId, topicId, "Voice notes are not set up on this machine. Run `eva doctor` to see why.");
      return;
    }
    const audio = await this.download(chatId, topicId, voice);
    if (audio === null) return;
    let heard: string;
    try {
      heard = (await transcribe(audio)).trim();
    } catch (error) {
      await this.send(chatId, topicId, `The voice note could not be transcribed: ${this.describeError(error)}`);
      return;
    }
    if (heard.length === 0) {
      await this.send(chatId, topicId, "The voice note holds no speech.");
      return;
    }
    await this.send(chatId, topicId, `Heard: ${heard}`);
    await this.forward(chatId, topicId, heard);
  }

  /** Downloads a file that a message holds. Returns null, after a sentence in the chat, when it fails. */
  private async download(chatId: number, topicId: number | null, file: TelegramFile): Promise<Uint8Array | null> {
    if ((file.file_size ?? 0) > maxDownloadBytes) {
      await this.send(chatId, topicId, "Telegram lets Eva download files up to 20 MB only.");
      return null;
    }
    try {
      const described = await this.options.api.call<{ file_path?: string }>("getFile", { file_id: file.file_id });
      if (described.file_path === undefined) throw new Error("Telegram gave no file path");
      return await this.options.api.download(described.file_path);
    } catch (error) {
      await this.send(chatId, topicId, `The file could not be downloaded: ${this.describeError(error)}`);
      return null;
    }
  }

  private async handleCommand(chatId: number, topicId: number | null, text: string): Promise<void> {
    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = (rawName ?? "").split("@")[0];
    switch (name) {
      case "new":
        await this.openChat(chatId);
        return;
      case "delete":
        if (topicId === null) {
          // A chat without topics has only the main chat, so it must be able to delete that one.
          await this.send(
            chatId,
            null,
            "Delete this chat everywhere? Its messages here stay. The engine keeps its own copy of the chat.",
            { inline_keyboard: [[{ text: "Delete", callback_data: "d:main" }]] },
          );
          return;
        }
        await this.send(
          chatId,
          topicId,
          this.isScheduleTopic(topicId)
            ? "Delete the chat of the last firing everywhere? This topic keeps the earlier firings. The engine keeps its own copy of the chat."
            : "Delete this chat everywhere, and this topic with every message in it? The engine keeps its own copy of the chat.",
          {
            inline_keyboard: [[{ text: "Delete", callback_data: `d:${String(topicId)}` }]],
          },
        );
        return;
      case "stop": {
        const entry = this.state.topics[keyOf(chatId, topicId)];
        const stopped = entry !== undefined && this.options.eva.sessions.stop(entry.sessionId);
        if (stopped) this.stoppedSessions.add(entry.sessionId);
        await this.send(chatId, topicId, stopped ? "Stopping." : "Eva is not working in this chat.");
        return;
      }
      case "rename": {
        const entry = this.state.topics[keyOf(chatId, topicId)];
        if (rest.join("").length === 0) {
          await this.send(chatId, topicId, "Use: /rename <title>");
          return;
        }
        if (entry === undefined || !this.sessionExists(entry.sessionId)) {
          await this.send(chatId, topicId, "There is no chat here to rename yet. Send a message first.");
          return;
        }
        // The topic follows through the session_renamed event, as it does for a rename on the web.
        const { title } = this.options.eva.sessions.rename(entry.sessionId, rest.join(" "));
        await this.send(chatId, topicId, `The chat is now called ${title}.`);
        return;
      }
      case "status":
        await this.send(chatId, topicId, this.statusText());
        return;
      case "schedules":
        await this.listSchedules(chatId, topicId);
        return;
      case "sync":
        this.runApart(chatId, topicId, "Syncing…", async () => describeSync(await this.options.eva.syncVault()));
        return;
      case "link":
        await this.send(chatId, topicId, describeAccess(this.options.eva.status()).join("\n"));
        return;
      case "update":
        this.runApart(chatId, topicId, "Updating…", async () => {
          const update = await this.options.eva.updateNow();
          return update === null ? "This Eva cannot update herself." : describeUpdate(update);
        });
        return;
      case "logs": {
        const count = Number.parseInt(rest[0] ?? "", 10);
        const entries = this.options.eva.recentLogs({
          minimumLevel: "warn",
          limit: Number.isNaN(count) ? defaultLogCount : count,
        });
        for (const part of splitForTelegram(describeLogEntries(entries), messageLimit))
          await this.send(chatId, topicId, part);
        return;
      }
      case "restart": {
        const running = this.options.eva.status().busySessionIds.length;
        const warning =
          running === 0
            ? ""
            : `${String(running)} ${running === 1 ? "chat is" : "chats are"} running. A restart stops ${running === 1 ? "it" : "them"}. `;
        await this.send(chatId, topicId, `${warning}Restart Eva now?`, {
          inline_keyboard: [[{ text: "Restart", callback_data: "r:now" }]],
        });
        return;
      }
      case "chats":
        await this.listChats(chatId, topicId);
        return;
      case "projects": {
        const projects = this.options.eva.projects(parseProjectQuery(rest.join(" ")));
        await this.send(chatId, topicId, fitProjects(projects));
        return;
      }
      default:
        await this.send(
          chatId,
          topicId,
          commands.map((command) => `/${command.command}: ${command.description}`).join("\n"),
        );
    }
  }

  /**
   * Runs a slow command (a git sync, an update) outside the poll loop, so /stop and the buttons
   * still answer while it runs. It sends a first line at once, then the result.
   */
  private runApart(chatId: number, topicId: number | null, firstLine: string, work: () => Promise<string>): void {
    void (async (): Promise<void> => {
      try {
        await this.send(chatId, topicId, firstLine);
        await this.send(chatId, topicId, await work());
      } catch (error) {
        await this.send(chatId, topicId, `The command failed: ${this.describeError(error)}`);
      }
    })();
  }

  /** /new: a topic with its own chat, and the model picker first (lessons 41, 61). */
  private async openChat(chatId: number): Promise<void> {
    let topicId: number | null = null;
    try {
      const topic = await this.options.api.call<{ message_thread_id: number }>("createForumTopic", {
        chat_id: chatId,
        name: "New chat",
      });
      topicId = topic.message_thread_id;
    } catch {
      await this.send(
        chatId,
        null,
        "Topics are not available in this chat, so the new chat continues here. The earlier history of this chat is set aside.",
      );
    }
    const current = this.state.topics[keyOf(chatId, topicId)];
    if (topicId === null && current !== undefined && this.options.eva.sessions.isBusy(current.sessionId)) {
      // Never reset a chat while its turn runs (lesson 49).
      await this.send(chatId, null, "Eva is still working in this chat. Send /new again when she finishes.");
      return;
    }
    const session = this.options.eva.createAssistantSession({
      source: "telegram",
      model: "default",
      ...(topicId === null ? {} : { telegramTopicId: topicId }),
    });
    this.state.topics[keyOf(chatId, topicId)] = {
      sessionId: session.id,
      openedByEva: topicId !== null,
      renamed: false,
    };
    this.saveState();
    await this.send(chatId, topicId, "Which model for this chat?", {
      inline_keyboard: [models.map((model) => ({ text: model, callback_data: `m:${session.id}:${model}` }))],
    });
  }

  private async forward(chatId: number, topicId: number | null, text: string): Promise<void> {
    const key = keyOf(chatId, topicId);
    let entry = this.state.topics[key];
    if (entry === undefined || !this.sessionExists(entry.sessionId)) {
      const session = this.options.eva.createAssistantSession({
        source: "telegram",
        model: "default",
        ...(topicId === null ? {} : { telegramTopicId: topicId }),
      });
      entry = { sessionId: session.id, openedByEva: false, renamed: true };
      this.state.topics[key] = entry;
      this.saveState();
    }
    if (topicId !== null && entry.openedByEva && !entry.renamed) {
      entry.renamed = true;
      this.saveState();
      await this.quietCall("editForumTopic", { chat_id: chatId, message_thread_id: topicId, name: titleOf(text) });
    }
    this.startTyping(chatId, topicId, entry.sessionId);
    void this.options.eva.sessions.send(entry.sessionId, text, "telegram");
  }

  private async handleButton(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = query.message?.chat.id;
    const isAllowed = chatId !== undefined && chatId === this.allowedChatId && this.isAllowedSender(query.from?.id);
    const [kind, first, second] = (query.data ?? "").split(":");
    const isApproval = kind === "a" && first !== undefined && (second === "allow" || second === "deny");
    const isDeviceAnswer = kind === "l" && first !== undefined && (second === "allow" || second === "deny");
    // The device answer comes first, so the reply to the press can say that the request expired.
    const deviceAnswered = isAllowed && isDeviceAnswer ? this.options.eva.deviceLogins.answer(first, second) : null;
    const answerText = deviceAnswered === false ? deviceExpiredText : second === "allow" ? "Allowed" : "Denied";
    await this.quietCall("answerCallbackQuery", {
      callback_query_id: query.id,
      ...(isAllowed && (isApproval || isDeviceAnswer) ? { text: answerText } : {}),
    });
    if (!isAllowed) return;
    if (isApproval) {
      this.options.eva.sessions.answerApproval(first, second);
    } else if (isDeviceAnswer) {
      await this.closeQuestion(first, answerText);
    } else if (kind === "m" && first !== undefined && models.includes(second as ModelAlias)) {
      try {
        this.options.eva.sessions.setModel(first, second as ModelAlias);
      } catch {
        // The chat already started; its model stays.
      }
    } else if (kind === "d" && first !== undefined) {
      if (first === "main") await this.deleteMainChat(chatId);
      else await this.deleteTopic(chatId, Number(first));
    } else if (kind === "f" && first !== undefined) {
      const topicId = query.message?.is_topic_message === true ? (query.message.message_thread_id ?? null) : null;
      const path = this.offers.pathFor(first);
      if (path === null) await this.send(chatId, topicId, "That file is no longer available.");
      else await this.sendVaultFile(chatId, topicId, path);
    } else if (kind === "c" && first !== undefined) {
      const topicId = query.message?.is_topic_message === true ? (query.message.message_thread_id ?? null) : null;
      await this.continueChat(chatId, topicId, first);
    } else if (kind === "s" && first !== undefined) {
      const removed = this.options.eva.schedules?.remove(first) ?? false;
      await this.send(chatId, null, removed ? `Removed the schedule ${first}.` : `No schedule ${first} exists.`);
    } else if (kind === "r" && first === "now") {
      const topicId = query.message?.is_topic_message === true ? (query.message.message_thread_id ?? null) : null;
      await this.send(chatId, topicId, "Restarting… Eva answers again in a moment.");
      this.options.eva.restart();
    }
  }

  /** /chats: the newest chats of every front end. A schedule's chats live in its own topic. */
  private async listChats(chatId: number, topicId: number | null): Promise<void> {
    const chats = this.options.eva.sessions
      .list()
      .filter((session) => session.parentId === null && session.source !== "schedule")
      .sort((first, second) => lastActivityOf(second).localeCompare(lastActivityOf(first)))
      .slice(0, chatListLimit);
    if (chats.length === 0) {
      await this.send(chatId, topicId, "No chats yet. Write a message to start one.");
      return;
    }
    await this.send(chatId, topicId, "Pick a chat to continue it here:", {
      inline_keyboard: chats.map((chat) => [
        { text: `${chat.mode === "project" ? "Project: " : ""}${chat.title}`, callback_data: `c:${chat.id}` },
      ]),
    });
  }

  /**
   * Binds a chat of any front end to a topic of its own, with its last turns. Without topics,
   * the main chat continues it instead, as /new does (lesson 61).
   */
  private async continueChat(chatId: number, topicId: number | null, sessionId: string): Promise<void> {
    const session = this.options.eva.sessions.list().find((candidate) => candidate.id === sessionId);
    if (session === undefined) {
      await this.send(chatId, topicId, "That chat no longer exists.");
      return;
    }
    const bound = this.targetOf(sessionId);
    if (bound !== null) {
      await this.send(
        chatId,
        topicId,
        bound.topicId === null
          ? "This chat already continues in the main chat."
          : `This chat already has its topic: ${this.topicName(bound.chatId, bound.topicId, session.title)}.`,
      );
      return;
    }
    const opened = await this.openTopicFor(chatId, sessionId, session.title);
    if (opened.kind === "opened") {
      await this.send(
        chatId,
        topicId,
        `This chat continues in ${this.topicName(chatId, opened.topicId, session.title)}.`,
      );
      return;
    }
    if (opened.kind === "opening") {
      await this.send(chatId, topicId, "Eva opens a topic for this chat already. It comes in a moment.");
      return;
    }
    try {
      if (opened.kind === "failed") {
        // A chat with topics must not lose its main chat to a short Telegram problem.
        await this.send(chatId, topicId, `Telegram did not open the topic: ${opened.reason} Press the chat again.`);
        return;
      }
      const main = this.state.topics[keyOf(chatId, null)];
      if (main !== undefined && this.options.eva.sessions.isActive(main.sessionId)) {
        // Never take the main chat from a turn that runs (lesson 49).
        await this.send(chatId, null, "Eva is still working in this chat. Press the chat again when she finishes.");
        return;
      }
      this.state.topics[keyOf(chatId, null)] = { sessionId, openedByEva: false, renamed: true };
      this.saveState();
      await this.send(
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
      return { kind: "failed", reason: this.describeError(error) };
    }
    try {
      if (!this.sessionExists(sessionId)) {
        // Deleted while the topic opened: an empty topic would only confuse.
        await this.quietCall("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
        return { kind: "failed", reason: "That chat no longer exists." };
      }
      // Eva named the topic, so the first message keeps that name (lesson 125).
      this.state.topics[keyOf(chatId, topicId)] = { sessionId, openedByEva: true, renamed: true };
      this.saveState();
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
    await this.replayTurns(chatId, topicId, history.turns);
    if (!history.working) return;
    this.startTyping(chatId, topicId, sessionId);
    await this.send(
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
        await this.dispatch(next.event, next.answer);
    } finally {
      this.opening.delete(sessionId);
    }
  }

  /**
   * A Telegram chat gave work to a project: the Project chat gets a topic, and the asking chat
   * gets a link to it, and to the web chat when Tailscale gives Eva an address.
   */
  private async showProjectWork(event: Extract<SessionEvent, { kind: "project_work_started" }>): Promise<void> {
    const asking = this.targetOf(event.sessionId);
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
        : `Project work started in ${project}. Follow it in ${this.topicName(asking.chatId, topicId, name)}.`,
      ...(url === null ? [] : [`Web: ${url}/#/chat/${encodeURIComponent(event.projectSessionId)}`]),
    ];
    await this.send(asking.chatId, asking.topicId, lines.join("\n"));
  }

  private turnsOf(sessionId: string): readonly Turn[] {
    return this.options.eva.sessions.list().find((session) => session.id === sessionId)?.turns ?? [];
  }

  /** The answer of a chat's last turn, or null when the chat has none. */
  private lastAnswerOf(sessionId: string): string | null {
    return (
      this.options.eva.sessions
        .list()
        .find((session) => session.id === sessionId)
        ?.turns.at(-1)?.answerText ?? null
    );
  }

  /** The last turns of a chat, so a topic and its web chat show the same history. */
  private async replayTurns(chatId: number, topicId: number | null, turns: readonly Turn[]): Promise<void> {
    if (turns.length > replayedTurns)
      await this.send(chatId, topicId, `Earlier turns: ${String(turns.length)}. The web chat has all of them.`);
    for (const turn of turns.slice(-replayedTurns)) {
      await this.sendPlain(chatId, topicId, `Message: ${turn.userText}`);
      if (turn.answerText.length > 0) await this.sendAnswer(chatId, topicId, extractFileMarkers(turn.answerText).text);
      if (turn.failure !== null) await this.send(chatId, topicId, `The turn failed: ${turn.failure}`);
    }
  }

  /** Plain text of any length, in parts: `send` would cut it at Telegram's limit with no sign. */
  private async sendPlain(chatId: number, topicId: number | null, text: string): Promise<void> {
    for (const part of splitForTelegram(text, messageLimit)) await this.send(chatId, topicId, part);
  }

  /** A topic's name, as a link in a supergroup: only there does Telegram give topics an address. */
  private topicName(chatId: number, topicId: number, title: string): string {
    const link = topicLink(chatId, topicId);
    return link === null ? `the topic “${title}”` : `the topic “${title}” (${link})`;
  }

  /** /schedules: every schedule with its next run, a remove button each, and the file's problems. */
  private async listSchedules(chatId: number, topicId: number | null): Promise<void> {
    const scheduler = this.options.eva.schedules;
    if (scheduler === null) {
      await this.send(chatId, topicId, "No vault is configured, so there are no schedules.");
      return;
    }
    const { schedules, problems } = scheduler.list();
    const lines = schedules.map(
      ({ schedule, nextRun }) => `• ${schedule.name} (${schedule.id}), next: ${nextRun?.replace("T", " ") ?? "never"}`,
    );
    if (problems.length > 0) lines.push("", "Schedules file problems:", ...problems.map((problem) => `• ${problem}`));
    await this.send(
      chatId,
      topicId,
      lines.length === 0 ? "No schedules. Ask Eva to create one." : lines.join("\n"),
      schedules.length === 0
        ? undefined
        : {
            inline_keyboard: schedules
              .slice(0, buttonsPerMessage)
              .map(({ schedule }) => [{ text: `Remove ${schedule.name}`, callback_data: `s:${schedule.id}` }]),
          },
    );
  }

  /**
   * Setup cards, firings and file problems of the schedules (lessons 66, 70, 126). True when the
   * paired chat got the event: a card that failed to go out waits for the next check.
   */
  private async onScheduleEvent(event: ScheduleEvent): Promise<boolean> {
    const chatId = this.allowedChatId;
    if (chatId === null) return false;
    if (event.kind === "schedule_problems") {
      const text = ["Schedules file problems:", ...event.problems.map((line) => `• ${line}`)].join("\n");
      return (await this.send(chatId, null, text)) !== null;
    }
    const topicId = await this.scheduleTopic(chatId, event.scheduleId, event.name);
    if (event.kind === "schedule_card") return this.sendCard(chatId, topicId, event);
    const current = this.state.topics[keyOf(chatId, topicId)];
    const busy = current !== undefined && this.options.eva.sessions.isBusy(current.sessionId);
    // Never take a chat from a turn that runs (lesson 49): then the firing's answer shows on the web only.
    if (event.sessionId !== null && !busy) {
      // Each firing is a fresh chat in the schedule's topic (lesson 126).
      this.state.topics[keyOf(chatId, topicId)] = { sessionId: event.sessionId, openedByEva: true, renamed: true };
      this.saveState();
      this.startTyping(chatId, topicId, event.sessionId);
    }
    if (event.text !== null) await this.send(chatId, topicId, event.text);
    if (event.file !== null) await this.sendVaultFile(chatId, topicId, event.file);
    return true;
  }

  /**
   * A cut card would hide its last fields, the prompt among them (lesson 67). So a card too long
   * for one message never counts as shown: a short notice sends the person to the web app.
   */
  private async sendCard(chatId: number, topicId: number | null, card: ScheduleCard): Promise<boolean> {
    const text = cardText(card);
    if (text.length <= telegramMessageLimit) {
      this.tooLongCards.delete(card.scheduleId);
      return (await this.send(chatId, topicId, text)) !== null;
    }
    if (this.tooLongCards.get(card.scheduleId) === text) return false;
    const notice = `The setup card of ${card.name} is too long for Telegram. Open the web app to check it: the schedule runs only after that.`;
    // A notice that failed to go out goes out again at the next check.
    if ((await this.send(chatId, topicId, notice)) !== null) this.tooLongCards.set(card.scheduleId, text);
    return false;
  }

  /** The schedule's topic. A topic deleted in the app answers a typing action with 400, so a new one opens (lesson 70). */
  private async scheduleTopic(chatId: number, scheduleId: string, name: string): Promise<number | null> {
    const existing = this.state.scheduleTopics[scheduleId];
    if (existing !== undefined) {
      try {
        await this.options.api.call("sendChatAction", {
          chat_id: chatId,
          action: "typing",
          message_thread_id: existing,
        });
        return existing;
      } catch (error) {
        if (!(error instanceof TelegramError && error.code === 400)) return existing;
      }
    }
    try {
      const topic = await this.options.api.call<{ message_thread_id: number }>("createForumTopic", {
        chat_id: chatId,
        name,
      });
      this.state.scheduleTopics[scheduleId] = topic.message_thread_id;
      this.saveState();
      return topic.message_thread_id;
    } catch {
      return null;
    }
  }

  /** Uploads a vault file, after the path check; a refused or failed file gets a sentence (lesson 72). */
  private async sendVaultFile(chatId: number, topicId: number | null, requested: string): Promise<void> {
    const vaultPath = this.options.eva.status().vaultPath;
    const file = vaultPath === null ? null : resolveSendableFile(vaultPath, requested);
    if (file?.ok !== true) {
      await this.send(chatId, topicId, file?.reason ?? "No vault is configured.");
      return;
    }
    try {
      await this.options.api.upload(
        "sendDocument",
        { chat_id: chatId, ...threadOf(topicId) },
        { field: "document", name: file.name, bytes: new Uint8Array(readFileSync(file.path)) },
      );
    } catch (error) {
      await this.send(chatId, topicId, `Telegram did not take ${file.relativePath}: ${this.describeError(error)}`);
    }
  }

  /** Offered files become buttons; nothing uploads until a press (lesson 124). */
  private async offerFiles(chatId: number, topicId: number | null, paths: readonly string[]): Promise<void> {
    const vaultPath = this.options.eva.status().vaultPath;
    const buttons: { text: string; callback_data: string }[] = [];
    for (const requested of paths) {
      const file = vaultPath === null ? null : resolveSendableFile(vaultPath, requested);
      if (file?.ok !== true) {
        await this.send(chatId, topicId, file?.reason ?? "No vault is configured.");
        continue;
      }
      buttons.push({ text: file.name, callback_data: `f:${this.offers.idFor(file.relativePath)}` });
    }
    for (let start = 0; start < buttons.length; start += buttonsPerMessage) {
      await this.send(chatId, topicId, "Files you can open:", {
        inline_keyboard: buttons.slice(start, start + buttonsPerMessage).map((button) => [button]),
      });
    }
  }

  /** Deletes the chat in every front end first, so a busy chat keeps its topic. */
  private async deleteTopic(chatId: number, topicId: number): Promise<void> {
    if (!(await this.deleteChatOf(chatId, topicId))) return;
    // A schedule's topic holds its earlier firings too, so only the firing's chat goes.
    if (this.isScheduleTopic(topicId)) {
      await this.send(chatId, topicId, "Deleted. The next firing starts a new chat here.");
      return;
    }
    try {
      await this.options.api.call("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
    } catch (error) {
      await this.send(chatId, topicId, `Telegram did not delete the topic: ${this.describeError(error)}`);
    }
  }

  /** A schedule's topic holds all its firings, so a delete of one firing keeps it. */
  private isScheduleTopic(topicId: number): boolean {
    return Object.values(this.state.scheduleTopics).includes(topicId);
  }

  /** The main chat has no topic to delete: only its chat goes, and its messages stay. */
  private async deleteMainChat(chatId: number): Promise<void> {
    if (this.state.topics[keyOf(chatId, null)] === undefined) {
      await this.send(chatId, null, "There is no chat here to delete.");
      return;
    }
    if (await this.deleteChatOf(chatId, null))
      await this.send(chatId, null, "Deleted. A new message starts a new chat.");
  }

  /** Deletes the chat of a topic or of the main chat in the core. False, after a sentence, when it still works. */
  private async deleteChatOf(chatId: number, topicId: number | null): Promise<boolean> {
    const key = keyOf(chatId, topicId);
    const entry = this.state.topics[key];
    if (entry === undefined) return true;
    // Forget the topic or the main chat first: the delete event of this chat then finds nothing to do here.
    Reflect.deleteProperty(this.state.topics, key);
    try {
      if (this.sessionExists(entry.sessionId)) this.options.eva.sessions.delete(entry.sessionId);
    } catch (error) {
      this.state.topics[key] = entry;
      if (!isEvaError(error, "session_busy")) throw error;
      await this.send(chatId, topicId, "Eva is still working in this chat. Try again when she finishes.");
      return false;
    }
    this.saveState();
    return true;
  }

  /**
   * A chat deleted in another front end. Eva deletes a topic that she opened for it. Any other
   * topic keeps its messages, and its next message starts a new chat.
   */
  private async forgetDeletedChat(sessionId: string): Promise<void> {
    this.stopTyping(sessionId);
    this.pendingText.delete(sessionId);
    for (const [key, entry] of Object.entries(this.state.topics)) {
      if (entry.sessionId !== sessionId) continue;
      Reflect.deleteProperty(this.state.topics, key);
      this.saveState();
      const { chatId, topicId } = placeOf(key);
      if (topicId !== null && entry.openedByEva && !this.isScheduleTopic(topicId))
        await this.quietCall("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
      else await this.send(chatId, topicId, "This chat was deleted elsewhere. A new message starts a new chat.");
    }
  }

  private async onEvent(event: SessionEvent): Promise<void> {
    if (event.kind === "approval_resolved") {
      await this.closeApproval(event);
      return;
    }
    if (event.kind === "session_deleted") {
      await this.forgetDeletedChat(event.sessionId);
      return;
    }
    if (event.kind === "project_work_started") {
      await this.showProjectWork(event);
      return;
    }
    // A topic opens for this chat: its events wait, so the topic shows them in order.
    const waiting = this.opening.get(event.sessionId);
    if (waiting !== undefined) {
      // A later turn may end before the flush, so the answer is read now.
      waiting.push({ event, answer: event.kind === "turn_finished" ? this.lastAnswerOf(event.sessionId) : null });
      return;
    }
    await this.dispatch(event, null);
  }

  /** Shows one event of a chat where the chat lives. */
  private async dispatch(event: SessionEvent, waitedAnswer: string | null): Promise<void> {
    const target = this.targetOf(event.sessionId);
    if (target === null) {
      // Every attached front end shows an approval, also for a chat that lives elsewhere.
      if (event.kind === "approval_needed" && this.allowedChatId !== null) {
        const title = this.options.eva.sessions.list().find((session) => session.id === event.sessionId)?.title;
        await this.sendApproval(this.allowedChatId, null, event, title ?? "another chat");
      }
      return;
    }
    switch (event.kind) {
      case "text":
        this.pendingText.set(event.sessionId, [...(this.pendingText.get(event.sessionId) ?? []), event.text]);
        return;
      case "approval_needed":
        await this.sendApproval(target.chatId, target.topicId, event, null);
        return;
      case "message_received": {
        // Its turn starts now, so Telegram shows that Eva works.
        this.startTyping(target.chatId, target.topicId, event.sessionId);
        // The web chat shows every message, so the topic shows the ones that Telegram did not send.
        // A schedule's setup card showed its prompt already.
        if (event.origin === "telegram" || event.origin === "schedule") return;
        await this.sendPlain(target.chatId, target.topicId, `Message: ${event.text}`);
        return;
      }
      case "history_lost":
        await this.send(target.chatId, target.topicId, "The earlier history of this chat is lost.");
        return;
      case "session_renamed":
        await this.renameTopic(target.chatId, target.topicId, event.title);
        return;
      case "turn_finished":
      case "turn_failed": {
        this.stopTyping(event.sessionId);
        // A topic can open while a turn runs, after its first text events. The record holds a
        // finished turn before its end event, so the whole answer comes from there.
        const recorded = event.kind === "turn_finished" ? (waitedAnswer ?? this.lastAnswerOf(event.sessionId)) : null;
        const answer = recorded ?? (this.pendingText.get(event.sessionId) ?? []).join("\n\n");
        this.pendingText.delete(event.sessionId);
        // Markers are read from the whole answer, so a marker is never shown half written (lesson 124).
        const markers = extractFileMarkers(answer);
        if (markers.text.length > 0) await this.sendAnswer(target.chatId, target.topicId, markers.text);
        for (const path of markers.attach) await this.sendVaultFile(target.chatId, target.topicId, path);
        if (markers.offer.length > 0) await this.offerFiles(target.chatId, target.topicId, markers.offer);
        const stopped = this.stoppedSessions.delete(event.sessionId);
        if (event.kind === "turn_failed")
          await this.send(target.chatId, target.topicId, stopped ? "Stopped." : `The turn failed: ${event.reason}`);
        return;
      }
      default:
        return;
    }
  }

  /**
   * Gives the chat's topic the person's title. Lesson 125 limits only the automatic rename to the topics
   * that Eva opened: this name is the person's choice, so any chat topic takes it. A schedule's topic
   * holds every run of the schedule, so a rename of one run keeps the schedule's name.
   */
  private async renameTopic(chatId: number, topicId: number | null, title: string): Promise<void> {
    if (topicId === null || Object.values(this.state.scheduleTopics).includes(topicId)) return;
    const entry = this.state.topics[keyOf(chatId, topicId)];
    // The first message must not replace the name that the person chose.
    if (entry !== undefined && !entry.renamed) {
      entry.renamed = true;
      this.saveState();
    }
    try {
      await this.callWithRetry("editForumTopic", { chat_id: chatId, message_thread_id: topicId, name: title });
    } catch (error) {
      // The same title again is how the person retries a refused rename, so a topic with that name is fine.
      if (isTopicNotModified(error)) return;
      // The chat already says that the rename worked, so a topic that keeps its old name must say why.
      this.logFailedCall("editForumTopic", error);
      await this.send(chatId, topicId, `Telegram did not rename this topic: ${this.describeError(error)}`);
    }
  }

  private async sendApproval(
    chatId: number,
    topicId: number | null,
    event: Extract<SessionEvent, { kind: "approval_needed" }>,
    chatTitle: string | null,
  ): Promise<void> {
    const where = chatTitle === null ? "" : ` (in “${chatTitle}”)`;
    const text = `Eva wants to run ${event.toolName}${where}: ${event.summary}`;
    const messageId = await this.send(chatId, topicId, text, {
      inline_keyboard: [
        [
          { text: "Allow", callback_data: `a:${event.requestId}:allow` },
          { text: "Deny", callback_data: `a:${event.requestId}:deny` },
        ],
      ],
    });
    if (messageId !== null) this.approvalMessages.set(event.requestId, { chatId, messageId, text });
  }

  private async closeApproval(event: Extract<SessionEvent, { kind: "approval_resolved" }>): Promise<void> {
    await this.closeQuestion(event.requestId, approvalAnswerText(event));
  }

  /** Shows the answer in the question message; an edit with no keyboard removes the buttons. */
  private async closeQuestion(requestId: string, answerText: string): Promise<void> {
    const question = this.approvalMessages.get(requestId);
    if (question === undefined) return;
    this.approvalMessages.delete(requestId);
    await this.quietCall("editMessageText", {
      chat_id: question.chatId,
      message_id: question.messageId,
      text: `${question.text}\n\n${answerText}`.slice(0, 4_096),
    });
  }

  /** Asks the paired chat whether a new browser may open the web UI; the page shows the same code. */
  private async askDeviceLogin(request: DeviceLoginRequest): Promise<void> {
    const chatId = this.allowedChatId;
    if (chatId === null) return;
    const text = `A browser wants to open Eva (code ${request.code}, account ${request.account}). Allow?`;
    const messageId = await this.send(chatId, null, text, {
      inline_keyboard: [
        [
          { text: "Allow", callback_data: `l:${request.id}:allow` },
          { text: "Deny", callback_data: `l:${request.id}:deny` },
        ],
      ],
    });
    if (messageId !== null) this.approvalMessages.set(request.id, { chatId, messageId, text });
  }

  /** Sends Markdown as Telegram HTML, split under the limit; a part with refused HTML goes again as plain text (lesson 58). */
  private async sendAnswer(chatId: number, topicId: number | null, markdown: string): Promise<void> {
    for (const chunk of keepFencesWhole(splitForTelegram(markdown, messageLimit))) {
      try {
        await this.callWithRetry("sendMessage", {
          chat_id: chatId,
          text: toTelegramHtml(chunk),
          parse_mode: "HTML",
          ...threadOf(topicId),
        });
      } catch (error) {
        if (isHtmlRefused(error)) await this.send(chatId, topicId, chunk);
        else this.logFailedCall("sendMessage", error);
      }
    }
  }

  /** Sends plain text. Returns the id of the message, or null when Telegram did not take it. */
  private async send(
    chatId: number,
    topicId: number | null,
    text: string,
    replyMarkup?: unknown,
  ): Promise<number | null> {
    try {
      const sent = await this.callWithRetry<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: text.slice(0, telegramMessageLimit),
        ...threadOf(topicId),
        ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      });
      return sent.message_id;
    } catch (error) {
      this.logFailedCall("sendMessage", error);
      return null;
    }
  }

  /** A call that goes again after a 429 or a network error, at most three times. Any other error throws at once. */
  private async callWithRetry<Result>(method: string, params: Record<string, unknown>): Promise<Result> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.options.api.call<Result>(method, params);
      } catch (error) {
        const waitMs = sendRetryMs(error, retry);
        if (waitMs === null || retry >= sendRetries) throw error;
        await this.sleep(waitMs);
      }
    }
  }

  private startTyping(chatId: number, topicId: number | null, sessionId: string): void {
    if (this.typingTimers.has(sessionId)) return;
    const typing = (): void => {
      void this.options.api
        .call("sendChatAction", { chat_id: chatId, action: "typing", ...threadOf(topicId) })
        .catch(() => undefined);
    };
    typing();
    this.typingTimers.set(sessionId, setInterval(typing, this.options.typingIntervalMs ?? 4_000));
  }

  private stopTyping(sessionId: string): void {
    const timer = this.typingTimers.get(sessionId);
    if (timer !== undefined) clearInterval(timer);
    this.typingTimers.delete(sessionId);
  }

  private targetOf(sessionId: string): { chatId: number; topicId: number | null } | null {
    for (const [key, entry] of Object.entries(this.state.topics)) {
      if (entry.sessionId === sessionId) return placeOf(key);
    }
    return null;
  }

  private statusText(): string {
    return describeStatusLines(this.options.eva.status()).join("\n");
  }

  private isAllowedSender(userId: number | undefined): boolean {
    return this.allowedUserId === null || userId === this.allowedUserId;
  }

  private sessionExists(sessionId: string): boolean {
    return this.options.eva.sessions.list().some((session) => session.id === sessionId);
  }

  private async quietCall(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.callWithRetry(method, params);
    } catch (error) {
      this.logFailedCall(method, error);
    }
  }

  /** An error for the chat: a Telegram URL holds the bot token, and a tool's message can hold any secret (lesson 95). */
  private describeError(error: unknown): string {
    return this.options.eva.redact(errorText(error));
  }

  private logFailedCall(method: string, error: unknown): void {
    this.options.logger?.log("warn", "A Telegram call failed.", { method, reason: String(error) });
  }

  private saveState(): void {
    writeFileAtomic(this.options.statePath, JSON.stringify(this.state, null, 2) + "\n");
  }
}

function loadState(path: string): BotState {
  const read = readJsonTolerant(path);
  if (read.ok && typeof read.value === "object" && read.value !== null) {
    const value = read.value as Partial<BotState>;
    if (typeof value.offset === "number" && typeof value.topics === "object")
      return { offset: value.offset, topics: value.topics, scheduleTopics: value.scheduleTopics ?? {} };
  }
  return { offset: 0, topics: {}, scheduleTopics: {} };
}

function keyOf(chatId: number, topicId: number | null): string {
  return `${String(chatId)}:${topicId === null ? "main" : String(topicId)}`;
}

/** A supergroup's id is -100 and then its own id; a topic link needs that own id. */
function topicLink(chatId: number, topicId: number): string | null {
  const id = String(chatId);
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${String(topicId)}` : null;
}

function lastActivityOf(session: SessionRecord): string {
  return session.lastTurnAt ?? session.createdAt;
}

/** The chat and the topic that a key of the topic map names. */
function placeOf(key: string): { chatId: number; topicId: number | null } {
  const [chat, topic] = key.split(":");
  return { chatId: Number(chat), topicId: topic === "main" ? null : Number(topic) };
}

function threadOf(topicId: number | null): Record<string, number> {
  return topicId === null ? {} : { message_thread_id: topicId };
}

function titleOf(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "Chat";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "Chat";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The file that a message holds and Eva saves: a document, an audio file, or the largest size of a photo. */
function receivedFileOf(message: TelegramMessage): TelegramFile | null {
  if (message.document !== undefined) return message.document;
  if (message.audio !== undefined) return message.audio;
  const largest = (message.photo ?? []).reduce<TelegramPhotoSize | null>(
    (best, size) => (best === null || size.width * size.height > best.width * best.height ? size : best),
    null,
  );
  if (largest === null) return null;
  // A photo has no file name; Telegram always sends it as a JPEG.
  return { ...largest, file_name: `photo-${largest.file_unique_id ?? largest.file_id}.jpg` };
}

/** The name of the content that Eva cannot read yet, or null. */
function unreadableContentOf(message: TelegramMessage): string | null {
  return unreadableContents.find(([field]) => field in message)?.[1] ?? null;
}

/**
 * The wait before a retry of a sending call, or null when a retry cannot help. A 429 waits what
 * Telegram asks for, up to 30 seconds; a network error (code 0) waits 1, 2, then 4 seconds.
 */
function sendRetryMs(error: unknown, retry: number): number | null {
  if (!(error instanceof TelegramError)) return null;
  if (error.code === 429) return Math.min((error.retryAfterSeconds ?? 1) * 1_000, maxSendRetryMs);
  if (error.code === 0) return firstRetryMs * 2 ** retry;
  return null;
}

/**
 * True when Telegram refused the HTML of a message (lesson 58). Telegram gives no structured
 * field for this case, so its description is the only signal (lesson 36 allows no better one).
 */
function isHtmlRefused(error: unknown): boolean {
  return error instanceof TelegramError && error.code === 400 && /can't parse entities/i.test(error.description);
}

/** True when the topic already has the name. As above, the description is Telegram's only signal. */
function isTopicNotModified(error: unknown): boolean {
  return error instanceof TelegramError && error.code === 400 && error.description.includes("TOPIC_NOT_MODIFIED");
}

/** A conflict is a problem at once; a failing poll only after 15 minutes. */
function pollProblem(state: TelegramPollState, now: Date): AlertProblem | null {
  const resolvedMessage = "Eva reads Telegram again.";
  if (state.kind === "conflict") {
    return {
      level: "error",
      message:
        "Another program polls this Telegram bot, so Eva cannot read Telegram. Stop the other program; Eva tries again every 10 minutes.",
      resolvedMessage,
    };
  }
  if (state.kind === "failing" && now.getTime() - new Date(state.since).getTime() > pollFailingAlertMs) {
    return {
      level: "error",
      message: `Eva cannot reach Telegram for more than 15 minutes: ${state.reason}. Check the network of this machine and the bot token.`,
      resolvedMessage,
    };
  }
  return null;
}

function approvalAnswerText(event: Extract<SessionEvent, { kind: "approval_resolved" }>): string {
  if (event.answer === "allow") return "Allowed";
  return event.timedOut ? "Denied (timed out)" : "Denied";
}

function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish);
  });
}

function cardText(event: ScheduleCard): string {
  const heading =
    event.changed.length === 0
      ? `New schedule: ${event.name}`
      : `Schedule changed (${event.changed.join(", ")}): ${event.name}`;
  const fields = Object.entries(event.fields).map(([name, value]) => `${name}: ${value}`);
  const next = `Next run: ${event.nextRun?.replace("T", " ") ?? "never"} (${event.timeZone})`;
  // The card is the check against a schedule that someone else pushed to the vault (lesson 67).
  return [heading, "", ...fields, "", next].join("\n");
}

/** The /projects answer: whole projects only, within one message, and a note on what was left out. */
function fitProjects(projects: Parameters<typeof describeProjectLines>[0]): string {
  const lines: string[] = [];
  let shown = 0;
  for (const project of projects.slice(0, projectListLimit)) {
    const block = describeProjectLines([project]);
    // The first project always shows; send() cuts it if it alone passes Telegram's size.
    if (shown > 0 && [...lines, ...block].join("\n").length > messageLimit) break;
    lines.push(...block);
    shown += 1;
  }
  if (projects.length === 0) return describeProjectLines([]).join("\n");
  const left = projects.length - shown;
  return [...lines, ...(left > 0 ? [`…and ${String(left)} more. Add words to narrow the search.`] : [])].join("\n");
}

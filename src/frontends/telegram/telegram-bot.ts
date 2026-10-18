/**
 * Eva in a Telegram chat, ported from Wall-I v1 with lessons 56 to 63
 * and 123 to 127. Each topic is one chat of the instance's single conversation list;
 * a message outside every topic belongs to the main chat.
 */
import { dirname, join } from "node:path";
import type { Alert } from "../../core/alerts/alert-center.ts";
import type { Eva } from "../../core/eva.ts";
import { describeLogEntries, describeStatusLines, describeSync, describeUpdate } from "../cli/client.ts";
import { describeAccess } from "../cli/network-setup.ts";
import { extractFileMarkers, saveReceivedFile } from "../../core/files/vault-files.ts";
import { parseProjectQuery } from "../../core/projects/project-catalog.ts";
import type { DeviceLoginRequest } from "../../core/remote-access/device-logins.ts";

import type { ModelAlias } from "../../shared/engine-port.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { type Clock, systemClock } from "../../shared/clock.ts";
import type { Logger } from "../../shared/logger.ts";
import type { TelegramApi } from "./telegram-api.ts";
import { TelegramFiles } from "./telegram-files.ts";
import { splitForTelegram } from "./telegram-format.ts";
import {
  keyOf,
  receivedFileOf,
  threadOf,
  titleOf,
  topicOf,
  unreadableContentOf,
  type TelegramFile,
  type TelegramUpdate,
} from "./telegram-messages.ts";
import { PollHealth, sleepUntilAborted, type TelegramPollState } from "./telegram-poll.ts";
import { isTopicNotModified, messageLimit, TelegramSender, telegramMessageLimit } from "./telegram-sender.ts";
import { isScheduleTopic, loadBotState, saveBotState, targetOf, type BotState } from "./telegram-state.ts";
import { TelegramChats } from "./telegram-chats.ts";
import { TelegramConflicts } from "./telegram-conflicts.ts";
import { TelegramSchedules } from "./telegram-schedules.ts";
import { approvalAnswerText, fitProjects } from "./telegram-texts.ts";

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

const confirmAttempts = 3;
const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];
const deviceExpiredText = "This request expired.";
const pollProblemKey = "telegram_poll";
const defaultLogCount = 20;

const commands: readonly { command: string; description: string }[] = [
  { command: "new", description: "Start a new chat in its own topic" },
  { command: "delete", description: "Delete this chat everywhere, with its topic" },
  { command: "rename", description: "Rename this chat and its topic: /rename <title>" },
  { command: "chats", description: "Continue a chat from the web app or the terminal here" },
  { command: "stop", description: "Stop Eva's work in this chat" },
  { command: "status", description: "Show Eva's state" },
  { command: "projects", description: "Search the projects: /projects [words] [status:active] [#tag]" },
  { command: "schedules", description: "List the schedules" },
  { command: "link", description: "The address that opens Eva on any device" },
  { command: "sync", description: "Sync the vault now" },
  { command: "conflicts", description: "Pick a version of each vault note that conflicts" },
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
  private readonly files: TelegramFiles;
  private readonly schedules: TelegramSchedules;
  private readonly conflicts: TelegramConflicts;
  private readonly chats: TelegramChats;
  private running = false;
  private readonly sender: TelegramSender;
  private readonly poll: PollHealth;
  /** Aborts at stop(), so a wait in the loop ends at once. */
  private stopping: AbortController;
  /** The approval and device login questions in the chat, by request id, so the answer can replace their buttons. */
  private readonly approvalMessages: Map<string, { chatId: number; messageId: number; text: string }>;
  /** The chats that /stop stopped, so their failed turn says "Stopped." instead of a failure. */
  private readonly stoppedSessions: Set<string>;
  private readonly detachDeviceApprover: () => void;

  constructor(options: TelegramBotOptions) {
    this.options = options;
    this.allowedChatId = options.allowedChatId;
    this.allowedUserId = options.allowedUserId;
    this.stopping = new AbortController();
    this.sender = new TelegramSender({
      api: options.api,
      sleep: (ms) => this.sleep(ms),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.poll = new PollHealth({
      clock: options.clock ?? systemClock,
      report: (problem) => {
        options.eva.reportProblem(pollProblemKey, problem);
      },
      describeError: (error) => this.describeError(error),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.approvalMessages = new Map();
    this.stoppedSessions = new Set();
    this.state = loadBotState(options.statePath);
    this.files = new TelegramFiles({
      api: options.api,
      sender: this.sender,
      vaultPath: () => options.eva.status().vaultPath,
      describeError: (error) => this.describeError(error),
      offersPath: join(dirname(options.statePath), "telegram-offers.json"),
    });
    this.conflicts = new TelegramConflicts({
      eva: options.eva,
      sender: this.sender,
      offersPath: join(dirname(options.statePath), "telegram-conflicts.json"),
    });
    this.schedules = new TelegramSchedules({
      api: options.api,
      sender: this.sender,
      files: this.files,
      eva: options.eva,
      state: this.state,
      saveState: () => {
        this.saveState();
      },
      pairedChat: () => this.allowedChatId,
      startTyping: (chatId, topicId, sessionId) => {
        this.startTyping(chatId, topicId, sessionId);
      },
    });
    this.chats = new TelegramChats({
      api: options.api,
      sender: this.sender,
      eva: options.eva,
      state: this.state,
      saveState: () => {
        this.saveState();
      },
      describeError: (error) => this.describeError(error),
      startTyping: (chatId, topicId, sessionId) => {
        this.startTyping(chatId, topicId, sessionId);
      },
      forgetLive: (sessionId) => {
        this.stopTyping(sessionId);
        this.pendingText.delete(sessionId);
      },
      dispatch: (event, waitedAnswer) => this.dispatch(event, waitedAnswer),
    });
    this.unsubscribe = options.eva.sessions.subscribe((event) => {
      void this.onEvent(event);
    });
    this.unsubscribeSchedules =
      options.eva.schedules?.subscribe((event) => this.schedules.onEvent(event)) ?? ((): void => undefined);
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
    await this.sender.quietCall("setMyCommands", { commands });
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
        waitMs = this.poll.takeRetryMs();
      }
      if (waitMs > 0 && this.isRunning()) await this.sleep(waitMs);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  pollState(): TelegramPollState {
    return this.poll.state();
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
      return this.poll.failed(error);
    }
    this.poll.succeeded();
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

  /** Sends an alert to the main chat; before pairing, there is no chat to send it to. */
  private async sendAlert(alert: Alert): Promise<void> {
    if (this.allowedChatId === null) return;
    await this.send(
      this.allowedChatId,
      null,
      `${alert.level === "resolved" ? "Resolved" : "Problem"}: ${alert.message}`,
    );
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
    const topicId = topicOf(message);
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
    const bytes = await this.files.download(chatId, topicId, file);
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
    const audio = await this.files.download(chatId, topicId, voice);
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
          isScheduleTopic(this.state, topicId)
            ? "Delete the chat of the last firing everywhere? This topic keeps the earlier firings. The engine keeps its own copy of the chat."
            : "Delete this chat everywhere, and this topic with every message in it? The engine keeps its own copy of the chat.",
          {
            inline_keyboard: [[{ text: "Delete", callback_data: `d:${String(topicId)}` }]],
          },
        );
        return;
      case "chats":
        await this.chats.list(chatId, topicId);
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
        await this.send(chatId, topicId, describeStatusLines(this.options.eva.status()).join("\n"));
        return;
      case "schedules":
        await this.schedules.list(chatId, topicId);
        return;
      case "sync":
        this.runApart(chatId, topicId, "Syncing…", async () => describeSync(await this.options.eva.syncVault()));
        return;
      case "conflicts":
        this.inBackground(chatId, topicId, () => this.conflicts.list(chatId, topicId));
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
    this.inBackground(chatId, topicId, async () => {
      await this.send(chatId, topicId, firstLine);
      await this.send(chatId, topicId, await work());
    });
  }

  private inBackground(chatId: number, topicId: number | null, work: () => Promise<void>): void {
    void (async (): Promise<void> => {
      try {
        await work();
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
      await this.sender.quietCall("editForumTopic", {
        chat_id: chatId,
        message_thread_id: topicId,
        name: titleOf(text),
      });
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
    await this.sender.quietCall("answerCallbackQuery", {
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
      if (first === "main") await this.chats.deleteMainChat(chatId);
      else await this.chats.deleteTopic(chatId, Number(first));
    } else if (kind === "o" && first !== undefined) {
      await this.chats.continueChat(chatId, topicOf(query.message), first);
    } else if (kind === "f" && first !== undefined) {
      await this.files.sendOffered(chatId, topicOf(query.message), first);
    } else if (kind === "s" && first !== undefined) {
      const removed = this.options.eva.schedules?.remove(first) ?? false;
      await this.send(chatId, null, removed ? `Removed the schedule ${first}.` : `No schedule ${first} exists.`);
    } else if (kind === "c" && first !== undefined && second !== undefined) {
      const topicId = topicOf(query.message);
      this.inBackground(chatId, topicId, () => this.conflicts.pick(chatId, topicId, first, second));
    } else if (kind === "r" && first === "now") {
      await this.send(chatId, topicOf(query.message), "Restarting… Eva answers again in a moment.");
      this.options.eva.restart();
    }
  }

  private async onEvent(event: SessionEvent): Promise<void> {
    if (event.kind === "approval_resolved") {
      await this.closeQuestion(event.requestId, approvalAnswerText(event));
      return;
    }
    if (event.kind === "session_deleted") {
      await this.chats.forgetDeletedChat(event.sessionId);
      return;
    }
    if (event.kind === "project_work_started") {
      await this.chats.showProjectWork(event);
      return;
    }
    // A topic opens for this chat: its events wait, so the topic shows them in order.
    if (this.chats.wait(event)) return;
    await this.dispatch(event, null);
  }

  /** Shows one event of a chat where the chat lives. */
  private async dispatch(event: SessionEvent, waitedAnswer: string | null): Promise<void> {
    const target = targetOf(this.state, event.sessionId);
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
      case "message_received":
        // Its turn starts now, so Telegram shows that Eva works.
        this.startTyping(target.chatId, target.topicId, event.sessionId);
        // The web chat shows every message, so the topic shows the ones that Telegram did not send.
        // A schedule's setup card showed its prompt already.
        if (event.origin === "telegram" || event.origin === "schedule") return;
        await this.sender.sendPlain(target.chatId, target.topicId, `Message: ${event.text}`);
        return;
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
        const recorded =
          event.kind === "turn_finished" ? (waitedAnswer ?? this.chats.lastAnswerOf(event.sessionId)) : null;
        const answer = recorded ?? (this.pendingText.get(event.sessionId) ?? []).join("\n\n");
        this.pendingText.delete(event.sessionId);
        // Markers are read from the whole answer, so a marker is never shown half written (lesson 124).
        const markers = extractFileMarkers(answer);
        if (markers.text.length > 0) await this.sender.sendAnswer(target.chatId, target.topicId, markers.text);
        for (const path of markers.attach) await this.files.sendVaultFile(target.chatId, target.topicId, path);
        if (markers.offer.length > 0) await this.files.offerFiles(target.chatId, target.topicId, markers.offer);
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
    if (topicId === null || isScheduleTopic(this.state, topicId)) return;
    const entry = this.state.topics[keyOf(chatId, topicId)];
    // The first message must not replace the name that the person chose.
    if (entry !== undefined && !entry.renamed) {
      entry.renamed = true;
      this.saveState();
    }
    try {
      await this.sender.callWithRetry("editForumTopic", { chat_id: chatId, message_thread_id: topicId, name: title });
    } catch (error) {
      // The same title again is how the person retries a refused rename, so a topic with that name is fine.
      if (isTopicNotModified(error)) return;
      // The chat already says that the rename worked, so a topic that keeps its old name must say why.
      this.sender.logFailedCall("editForumTopic", error);
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

  /** Shows the answer in the question message; an edit with no keyboard removes the buttons. */
  private async closeQuestion(requestId: string, answerText: string): Promise<void> {
    const question = this.approvalMessages.get(requestId);
    if (question === undefined) return;
    this.approvalMessages.delete(requestId);
    await this.sender.quietCall("editMessageText", {
      chat_id: question.chatId,
      message_id: question.messageId,
      text: `${question.text}\n\n${answerText}`.slice(0, telegramMessageLimit),
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

  private send(chatId: number, topicId: number | null, text: string, replyMarkup?: unknown): Promise<number | null> {
    return this.sender.send(chatId, topicId, text, replyMarkup);
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

  private isAllowedSender(userId: number | undefined): boolean {
    return this.allowedUserId === null || userId === this.allowedUserId;
  }

  private sessionExists(sessionId: string): boolean {
    return this.options.eva.sessions.list().some((session) => session.id === sessionId);
  }

  /** An error for the chat: a Telegram URL holds the bot token, and a tool's message can hold any secret (lesson 95). */
  private describeError(error: unknown): string {
    return this.options.eva.redact(error instanceof Error ? error.message : String(error));
  }

  private saveState(): void {
    saveBotState(this.options.statePath, this.state);
  }
}

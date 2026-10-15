/**
 * Eva in a Telegram chat (docs/plan.md §8.2), ported from Wall-I v1 with lessons 56 to 63
 * and 123 to 127. Each topic is one chat of the instance's single conversation list (D13);
 * a message outside every topic belongs to the main chat.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Eva } from "../../core/eva.ts";
import { describeLastTurn } from "../cli/client.ts";
import { extractFileMarkers, OfferStore, resolveSendableFile, saveReceivedFile } from "../../core/files/vault-files.ts";
import type { ScheduleEvent } from "../../core/schedules/scheduler.ts";
import type { ModelAlias } from "../../shared/engine-port.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { keepFencesWhole, splitForTelegram, toTelegramHtml } from "./telegram-format.ts";

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
  /** Called when Eva must stop, with the exit code (lesson 89). */
  readonly onFatal: (exitCode: number) => void;
  readonly logger?: Logger;
  readonly pollTimeoutSeconds?: number;
  readonly typingIntervalMs?: number;
  /** Turns a voice note into text (plan §9). Without it, a voice note gets a sentence that says so. */
  readonly transcribe?: (audio: Uint8Array) => Promise<string>;
}

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
  readonly file_size?: number;
  readonly file_name?: string;
}

interface TelegramMessage {
  readonly chat: TelegramChat;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly document?: TelegramFile;
  readonly voice?: TelegramFile;
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
/** Lesson 56: count conflicts, and never let a success reset the count. */
const conflictLimit = 3;
const confirmAttempts = 3;
const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];
/** Telegram lets a bot download at most 20 MB. */
const maxDownloadBytes = 20 * 1024 * 1024;
/** Telegram refuses a keyboard of more than 100 buttons. */
const buttonsPerMessage = 50;

const commands: readonly { command: string; description: string }[] = [
  { command: "new", description: "Start a new chat in its own topic" },
  { command: "delete", description: "Delete this topic and forget its chat" },
  { command: "status", description: "Show Eva's state" },
  { command: "projects", description: "Search the projects" },
  { command: "schedules", description: "List the schedules" },
  { command: "help", description: "Show the commands" },
];

export class TelegramBot {
  private readonly options: TelegramBotOptions;
  private readonly state: BotState;
  private allowedChatId: number | null;
  private allowedUserId: number | null;
  private conflicts = 0;
  private readonly pendingText = new Map<string, string[]>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeSchedules: () => void;
  private readonly offers: OfferStore;
  private running = false;

  constructor(options: TelegramBotOptions) {
    this.options = options;
    this.allowedChatId = options.allowedChatId;
    this.allowedUserId = options.allowedUserId;
    this.state = loadState(options.statePath);
    this.offers = new OfferStore(join(dirname(options.statePath), "telegram-offers.json"));
    this.unsubscribe = options.eva.sessions.subscribe((event) => {
      void this.onEvent(event);
    });
    this.unsubscribeSchedules =
      options.eva.schedules?.subscribe((event) => this.onScheduleEvent(event)) ?? ((): void => undefined);
  }

  async registerCommands(): Promise<void> {
    await this.quietCall("setMyCommands", { commands });
  }

  /** Polls until stop() is called. */
  async run(): Promise<void> {
    this.running = true;
    await this.registerCommands();
    while (this.isRunning()) await this.pollOnce();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** One long poll and the handling of its updates. */
  async pollOnce(): Promise<void> {
    let updates: TelegramUpdate[];
    try {
      updates = await this.options.api.call<TelegramUpdate[]>("getUpdates", {
        offset: this.state.offset,
        timeout: this.options.pollTimeoutSeconds ?? 30,
        allowed_updates: ["message", "callback_query"],
      });
    } catch (error) {
      if (error instanceof TelegramError && error.code === 409) {
        this.conflicts += 1;
        if (this.conflicts >= conflictLimit) {
          this.options.logger?.log("error", "Another program polls this Telegram bot; Eva stops.");
          this.running = false;
          this.options.onFatal(exitCodes.secondInstance);
        }
      } else {
        this.options.logger?.log("warn", "Telegram poll failed.", { reason: String(error) });
      }
      return;
    }
    for (const update of updates) {
      this.state.offset = update.update_id + 1;
      this.saveState();
      try {
        await this.handle(update);
      } catch (error) {
        this.options.logger?.log("error", "A Telegram update failed.", { reason: String(error) });
      }
    }
  }

  /** Stops polling and confirms the offset, so no update replays at the next start (lesson 57). */
  async stop(): Promise<void> {
    this.running = false;
    this.unsubscribe();
    this.unsubscribeSchedules();
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
    if (text.length === 0 && message.document === undefined && message.voice === undefined) return;

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
    if (message.document !== undefined) {
      await this.forwardFile(chatId, topicId, message.document, text);
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
      await this.send(chatId, topicId, `The voice note could not be transcribed: ${errorText(error)}`);
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
      await this.send(chatId, topicId, `The file could not be downloaded: ${errorText(error)}`);
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
          await this.send(chatId, null, "/delete works only inside a topic.");
          return;
        }
        await this.send(chatId, topicId, "Delete this topic and every message in it?", {
          inline_keyboard: [[{ text: "Delete", callback_data: `d:${String(topicId)}` }]],
        });
        return;
      case "status":
        await this.send(chatId, topicId, this.statusText());
        return;
      case "schedules":
        await this.listSchedules(chatId, topicId);
        return;
      case "projects": {
        const projects = this.options.eva.projects({ text: rest.join(" ") }).slice(0, 20);
        await this.send(
          chatId,
          topicId,
          projects.length === 0 ? "No project matches." : projects.map((project) => `• ${project.id}`).join("\n"),
        );
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
    void this.options.eva.sessions.send(entry.sessionId, text);
  }

  private async handleButton(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = query.message?.chat.id;
    await this.quietCall("answerCallbackQuery", { callback_query_id: query.id });
    if (chatId === undefined || chatId !== this.allowedChatId || !this.isAllowedSender(query.from?.id)) return;
    const [kind, first, second] = (query.data ?? "").split(":");
    if (kind === "a" && first !== undefined && (second === "allow" || second === "deny")) {
      this.options.eva.sessions.answerApproval(first, second);
    } else if (kind === "m" && first !== undefined && models.includes(second as ModelAlias)) {
      try {
        this.options.eva.sessions.setModel(first, second as ModelAlias);
      } catch {
        // The chat already started; its model stays.
      }
    } else if (kind === "d" && first !== undefined) {
      await this.deleteTopic(chatId, Number(first));
    } else if (kind === "f" && first !== undefined) {
      const topicId = query.message?.is_topic_message === true ? (query.message.message_thread_id ?? null) : null;
      const path = this.offers.pathFor(first);
      if (path === null) await this.send(chatId, topicId, "That file is no longer available.");
      else await this.sendVaultFile(chatId, topicId, path);
    } else if (kind === "s" && first !== undefined) {
      const removed = this.options.eva.schedules?.remove(first) ?? false;
      await this.send(chatId, null, removed ? `Removed the schedule ${first}.` : `No schedule ${first} exists.`);
    }
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
            inline_keyboard: schedules.map(({ schedule }) => [
              { text: `Remove ${schedule.name}`, callback_data: `s:${schedule.id}` },
            ]),
          },
    );
  }

  /** Setup cards, firings and file problems of the schedules (plan §9, lessons 66, 70, 126). */
  private async onScheduleEvent(event: ScheduleEvent): Promise<void> {
    const chatId = this.allowedChatId;
    if (chatId === null) return;
    if (event.kind === "schedule_problems") {
      await this.send(
        chatId,
        null,
        ["Schedules file problems:", ...event.problems.map((line) => `• ${line}`)].join("\n"),
      );
      return;
    }
    const topicId = await this.scheduleTopic(chatId, event.scheduleId, event.name);
    if (event.kind === "schedule_card") {
      await this.send(chatId, topicId, cardText(event));
      return;
    }
    if (event.sessionId !== null) {
      // Each firing is a fresh chat in the schedule's topic (lesson 126).
      this.state.topics[keyOf(chatId, topicId)] = { sessionId: event.sessionId, openedByEva: true, renamed: true };
      this.saveState();
      this.startTyping(chatId, topicId, event.sessionId);
    }
    if (event.text !== null) await this.send(chatId, topicId, event.text);
    if (event.file !== null) await this.sendVaultFile(chatId, topicId, event.file);
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
      await this.send(chatId, topicId, `Telegram did not take ${file.relativePath}: ${errorText(error)}`);
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

  private async deleteTopic(chatId: number, topicId: number): Promise<void> {
    const key = keyOf(chatId, topicId);
    const entry = this.state.topics[key];
    if (entry !== undefined && this.options.eva.sessions.isBusy(entry.sessionId)) {
      await this.send(chatId, topicId, "Eva is still working in this topic. Try again when she finishes.");
      return;
    }
    try {
      await this.options.api.call("deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
    } catch (error) {
      await this.send(
        chatId,
        topicId,
        `Telegram did not delete the topic: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    Reflect.deleteProperty(this.state.topics, key);
    this.saveState();
  }

  private async onEvent(event: SessionEvent): Promise<void> {
    const target = this.targetOf(event.sessionId);
    if (target === null) return;
    switch (event.kind) {
      case "text":
        this.pendingText.set(event.sessionId, [...(this.pendingText.get(event.sessionId) ?? []), event.text]);
        return;
      case "approval_needed":
        await this.send(target.chatId, target.topicId, `Eva wants to run ${event.toolName}: ${event.summary}`, {
          inline_keyboard: [
            [
              { text: "Allow", callback_data: `a:${event.requestId}:allow` },
              { text: "Deny", callback_data: `a:${event.requestId}:deny` },
            ],
          ],
        });
        return;
      case "history_lost":
        await this.send(target.chatId, target.topicId, "The earlier history of this chat is lost.");
        return;
      case "turn_finished":
      case "turn_failed": {
        this.stopTyping(event.sessionId);
        const answer = (this.pendingText.get(event.sessionId) ?? []).join("\n\n");
        this.pendingText.delete(event.sessionId);
        // Markers are read from the whole answer, so a marker is never shown half written (lesson 124).
        const markers = extractFileMarkers(answer);
        if (markers.text.length > 0) await this.sendAnswer(target.chatId, target.topicId, markers.text);
        for (const path of markers.attach) await this.sendVaultFile(target.chatId, target.topicId, path);
        if (markers.offer.length > 0) await this.offerFiles(target.chatId, target.topicId, markers.offer);
        if (event.kind === "turn_failed")
          await this.send(target.chatId, target.topicId, `The turn failed: ${event.reason}`);
        return;
      }
      default:
        return;
    }
  }

  /** Sends Markdown as Telegram HTML, split under the limit; a refused part goes again as plain text (lesson 58). */
  private async sendAnswer(chatId: number, topicId: number | null, markdown: string): Promise<void> {
    for (const chunk of keepFencesWhole(splitForTelegram(markdown, messageLimit))) {
      try {
        await this.options.api.call("sendMessage", {
          chat_id: chatId,
          text: toTelegramHtml(chunk),
          parse_mode: "HTML",
          ...threadOf(topicId),
        });
      } catch {
        await this.send(chatId, topicId, chunk);
      }
    }
  }

  private async send(chatId: number, topicId: number | null, text: string, replyMarkup?: unknown): Promise<void> {
    await this.quietCall("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4_096),
      ...threadOf(topicId),
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    });
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
      if (entry.sessionId !== sessionId) continue;
      const [chat, topic] = key.split(":");
      return { chatId: Number(chat), topicId: topic === "main" ? null : Number(topic) };
    }
    return null;
  }

  private statusText(): string {
    const status = this.options.eva.status();
    return [
      `Eva ${status.version}`,
      `Vault: ${status.vaultPath ?? "not configured"}`,
      `Vault sync: ${status.vaultSync.status}${status.vaultSync.lastError === null ? "" : ` (${status.vaultSync.lastError})`}`,
      `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
      describeLastTurn(status.lastTurn),
    ].join("\n");
  }

  private isAllowedSender(userId: number | undefined): boolean {
    return this.allowedUserId === null || userId === this.allowedUserId;
  }

  private sessionExists(sessionId: string): boolean {
    return this.options.eva.sessions.list().some((session) => session.id === sessionId);
  }

  private async quietCall(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.options.api.call(method, params);
    } catch (error) {
      this.options.logger?.log("warn", "A Telegram call failed.", { method, reason: String(error) });
    }
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

function cardText(event: Extract<ScheduleEvent, { kind: "schedule_card" }>): string {
  const heading =
    event.changed.length === 0
      ? `New schedule: ${event.name}`
      : `Schedule changed (${event.changed.join(", ")}): ${event.name}`;
  const fields = Object.entries(event.fields).map(([name, value]) => `${name}: ${value}`);
  const next = `Next run: ${event.nextRun?.replace("T", " ") ?? "never"} (${event.timeZone})`;
  // The card is the check against a schedule that someone else pushed to the vault (lesson 67).
  return [heading, "", ...fields, "", next].join("\n");
}

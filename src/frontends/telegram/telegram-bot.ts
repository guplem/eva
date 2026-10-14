/**
 * Eva in a Telegram chat (docs/plan.md §8.2), ported from Wall-I v1 with lessons 56 to 63
 * and 123 to 127. Each topic is one chat of the instance's single conversation list (D13);
 * a message outside every topic belongs to the main chat.
 */
import type { Eva } from "../../core/eva.ts";
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
  /** With no chat allowed yet, the chat that sends this code becomes the allowed one. */
  readonly pairingCode: string;
  readonly onPaired: (chatId: number) => void;
  /** Called when Eva must stop, with the exit code (lesson 89). */
  readonly onFatal: (exitCode: number) => void;
  readonly logger?: Logger;
  readonly pollTimeoutSeconds?: number;
  readonly typingIntervalMs?: number;
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
}

interface TelegramChat {
  readonly id: number;
}

interface TelegramMessage {
  readonly chat: TelegramChat;
  readonly text?: string;
  readonly message_thread_id?: number;
  readonly is_topic_message?: boolean;
}

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: { readonly id: string; readonly data?: string; readonly message?: TelegramMessage };
}

/** Telegram refuses a message past 4096 characters; the split leaves room for the HTML tags. */
const messageLimit = 3_500;
/** Lesson 56: count conflicts, and never let a success reset the count. */
const conflictLimit = 3;
const confirmAttempts = 3;
const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

const commands: readonly { command: string; description: string }[] = [
  { command: "new", description: "Start a new chat in its own topic" },
  { command: "delete", description: "Delete this topic and forget its chat" },
  { command: "status", description: "Show Eva's state" },
  { command: "projects", description: "Search the projects" },
  { command: "help", description: "Show the commands" },
];

export class TelegramBot {
  private readonly options: TelegramBotOptions;
  private readonly state: BotState;
  private allowedChatId: number | null;
  private conflicts = 0;
  private readonly pendingText = new Map<string, string[]>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly unsubscribe: () => void;
  private running = false;

  constructor(options: TelegramBotOptions) {
    this.options = options;
    this.allowedChatId = options.allowedChatId;
    this.state = loadState(options.statePath);
    this.unsubscribe = options.eva.sessions.subscribe((event) => {
      void this.onEvent(event);
    });
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
    if (message?.text === undefined) return;
    const chatId = message.chat.id;
    const topicId = message.is_topic_message === true ? (message.message_thread_id ?? null) : null;
    const text = message.text.trim();

    if (this.allowedChatId === null) {
      if (text === this.options.pairingCode) {
        this.allowedChatId = chatId;
        this.options.onPaired(chatId);
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
    if (chatId !== this.allowedChatId) {
      await this.send(chatId, null, `This bot is private. Your chat id is ${String(chatId)}.`);
      return;
    }
    if (text.startsWith("/")) {
      await this.handleCommand(chatId, topicId, text);
      return;
    }
    await this.forward(chatId, topicId, text);
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

  private async handleButton(query: { id: string; data?: string; message?: TelegramMessage }): Promise<void> {
    const chatId = query.message?.chat.id;
    await this.quietCall("answerCallbackQuery", { callback_query_id: query.id });
    if (chatId === undefined || chatId !== this.allowedChatId) return;
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
        if (answer.trim().length > 0) await this.sendAnswer(target.chatId, target.topicId, answer);
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
      `Vault: ${status.vaultPath ?? "not configured"}`,
      `Vault sync: ${status.vaultSync.status}${status.vaultSync.lastError === null ? "" : ` (${status.vaultSync.lastError})`}`,
      `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
    ].join("\n");
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
      return { offset: value.offset, topics: value.topics };
  }
  return { offset: 0, topics: {} };
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

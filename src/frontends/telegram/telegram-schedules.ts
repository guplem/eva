/**
 * The schedules in Telegram: the /schedules list, and each schedule's topic, which gets its
 * setup cards, its firings and the file problems (lessons 66, 67, 70, 126).
 */
import type { Eva } from "../../core/eva.ts";
import type { ScheduleCard, ScheduleEvent } from "../../core/schedules/scheduler.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { buttonsPerMessage, type TelegramFiles } from "./telegram-files.ts";
import { keyOf } from "./telegram-messages.ts";
import { telegramMessageLimit, type TelegramSender } from "./telegram-sender.ts";
import type { BotState } from "./telegram-state.ts";
import { cardText } from "./telegram-texts.ts";

export interface TelegramSchedulesOptions {
  readonly api: TelegramApi;
  readonly sender: TelegramSender;
  readonly files: TelegramFiles;
  readonly eva: Eva;
  /** The bot's state; the schedules keep their topics in it. */
  readonly state: BotState;
  readonly saveState: () => void;
  /** The paired chat, or null before the pairing. */
  readonly pairedChat: () => number | null;
  /** Shows "typing" in the topic until the chat's turn ends. */
  readonly startTyping: (chatId: number, topicId: number | null, sessionId: string) => void;
}

export class TelegramSchedules {
  private readonly options: TelegramSchedulesOptions;
  /** The card text of each schedule that was too long for Telegram, so the notice goes out once per card. */
  private readonly tooLongCards: Map<string, string>;

  constructor(options: TelegramSchedulesOptions) {
    this.options = options;
    this.tooLongCards = new Map();
  }

  /** /schedules: every schedule with its next run, a remove button each, and the file's problems. */
  async list(chatId: number, topicId: number | null): Promise<void> {
    const scheduler = this.options.eva.schedules;
    if (scheduler === null) {
      await this.options.sender.send(chatId, topicId, "No vault is configured, so there are no schedules.");
      return;
    }
    const { schedules, problems } = scheduler.list();
    const lines = schedules.map(
      ({ schedule, nextRun }) =>
        `• ${schedule.name} (${schedule.id}), ${schedule.enabled ? `next: ${nextRun?.replace("T", " ") ?? "never"}` : "off"}`,
    );
    if (problems.length > 0) lines.push("", "Schedules file problems:", ...problems.map((problem) => `• ${problem}`));
    await this.options.sender.send(
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
   * Setup cards, firings and file problems of the schedules. True when the paired chat got the
   * event: a card that failed to go out waits for the next check.
   */
  async onEvent(event: ScheduleEvent): Promise<boolean> {
    const chatId = this.options.pairedChat();
    if (chatId === null) return false;
    const { sender, state } = this.options;
    if (event.kind === "schedule_problems") {
      const text = ["Schedules file problems:", ...event.problems.map((line) => `• ${line}`)].join("\n");
      return (await sender.send(chatId, null, text)) !== null;
    }
    const topicId = await this.topic(chatId, event.scheduleId, event.name);
    if (event.kind === "schedule_card") return this.sendCard(chatId, topicId, event);
    const current = state.topics[keyOf(chatId, topicId)];
    const busy = current !== undefined && this.options.eva.sessions.isBusy(current.sessionId);
    // Never take a chat from a turn that runs (lesson 49): then the firing's answer shows on the web only.
    if (event.sessionId !== null && !busy) {
      // Each firing is a fresh chat in the schedule's topic (lesson 126).
      state.topics[keyOf(chatId, topicId)] = { sessionId: event.sessionId, openedByEva: true, renamed: true };
      this.options.saveState();
      this.options.startTyping(chatId, topicId, event.sessionId);
    }
    if (event.text !== null) await sender.send(chatId, topicId, event.text);
    if (event.file !== null) await this.options.files.sendVaultFile(chatId, topicId, event.file);
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
      return (await this.options.sender.send(chatId, topicId, text)) !== null;
    }
    if (this.tooLongCards.get(card.scheduleId) === text) return false;
    const notice = `The setup card of ${card.name} is too long for Telegram. Open the web app to check it: the schedule runs only after that.`;
    // A notice that failed to go out goes out again at the next check.
    if ((await this.options.sender.send(chatId, topicId, notice)) !== null)
      this.tooLongCards.set(card.scheduleId, text);
    return false;
  }

  /** The schedule's topic. A topic deleted in the app answers a typing action with 400, so a new one opens (lesson 70). */
  private async topic(chatId: number, scheduleId: string, name: string): Promise<number | null> {
    const { api, state } = this.options;
    const existing = state.scheduleTopics[scheduleId];
    if (existing !== undefined) {
      try {
        await api.call("sendChatAction", { chat_id: chatId, action: "typing", message_thread_id: existing });
        return existing;
      } catch (error) {
        if (!(error instanceof TelegramError && error.code === 400)) return existing;
      }
    }
    try {
      const topic = await api.call<{ message_thread_id: number }>("createForumTopic", { chat_id: chatId, name });
      state.scheduleTopics[scheduleId] = topic.message_thread_id;
      this.options.saveState();
      return topic.message_thread_id;
    } catch {
      return null;
    }
  }
}

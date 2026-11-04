/**
 * The schedules in Telegram: the /schedules list, and each schedule's topic, which gets its
 * firings, their answers and the file problems (lessons 70, 126).
 */
import type { Eva } from "../../core/eva.ts";
import type { ScheduleEvent } from "../../core/schedules/scheduler.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { buttonsPerMessage, type TelegramFiles } from "./telegram-files.ts";
import { keyOf } from "./telegram-messages.ts";
import type { TelegramSender } from "./telegram-sender.ts";
import type { BotState } from "./telegram-state.ts";
import { extractFileMarkers } from "../../shared/file-markers.ts";

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
  /** Stops "typing": a scheduled run ends with its answer, not with a turn end in the topic. */
  readonly stopTyping: (sessionId: string) => void;
}

export class TelegramSchedules {
  private readonly options: TelegramSchedulesOptions;

  constructor(options: TelegramSchedulesOptions) {
    this.options = options;
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
      ({ schedule, nextRun, ended }) =>
        `• ${schedule.name} (${schedule.id}), ${stateOf(schedule.enabled, nextRun, ended)}`,
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

  /** Firings, answers and file problems of the schedules. Nothing goes out before the pairing. */
  async onEvent(event: ScheduleEvent): Promise<void> {
    const chatId = this.options.pairedChat();
    if (chatId === null) return;
    const { sender } = this.options;
    if (event.kind === "schedule_problems") {
      const text = ["Schedules file problems:", ...event.problems.map((line) => `• ${line}`)].join("\n");
      await sender.send(chatId, null, text);
      return;
    }
    const topicId = await this.topic(chatId, event.scheduleId, event.name);
    if (event.kind === "schedule_answered") {
      await this.sendAnswer(chatId, topicId, event);
      return;
    }
    // The topic gets the run's chat only when the run ends: a quiet run must leave nothing in it (#687).
    if (event.sessionId !== null) this.options.startTyping(chatId, topicId, event.sessionId);
    if (event.text !== null) await sender.send(chatId, topicId, event.text);
    if (event.file !== null) await this.options.files.sendVaultFile(chatId, topicId, event.file);
  }

  /** The end of a run with something to tell: its whole answer, its files, and a failure. */
  private async sendAnswer(
    chatId: number,
    topicId: number | null,
    event: Extract<ScheduleEvent, { kind: "schedule_answered" }>,
  ): Promise<void> {
    const { sender, state, files } = this.options;
    this.options.stopTyping(event.sessionId);
    const current = state.topics[keyOf(chatId, topicId)];
    const busy = current !== undefined && this.options.eva.sessions.isBusy(current.sessionId);
    // Never take a chat from a turn that runs (lesson 49): then a reply goes to that chat, not to this run.
    if (!busy) {
      // Each firing is a fresh chat in the schedule's topic (lesson 126).
      state.topics[keyOf(chatId, topicId)] = { sessionId: event.sessionId, openedByEva: true, renamed: true };
      this.options.saveState();
    }
    const markers = extractFileMarkers(event.text);
    if (markers.text.length > 0) await sender.sendAnswer(chatId, topicId, markers.text);
    for (const path of markers.attach) await files.sendVaultFile(chatId, topicId, path);
    if (markers.offer.length > 0) await files.offerFiles(chatId, topicId, markers.offer);
    if (event.failure !== null) await sender.send(chatId, topicId, `The turn failed: ${event.failure}`);
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

/** "Ended" comes first: a schedule that ended stays ended, also when it is off (#822, #687). */
function stateOf(enabled: boolean, nextRun: string | null, ended: string | null): string {
  if (ended !== null) return `ended: ${ended.replace("T", " ")}`;
  if (!enabled) return "off";
  return `next: ${nextRun?.replace("T", " ") ?? "never"}`;
}

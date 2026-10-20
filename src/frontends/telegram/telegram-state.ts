/** The bot's state file: the poll offset, and the chat of each topic. */
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

interface TopicEntry {
  readonly sessionId: string;
  readonly openedByEva: boolean;
  renamed: boolean;
}

export interface BotState {
  offset: number;
  /** Key: `<chatId>:<topicId>` or `<chatId>:main`. */
  topics: Record<string, TopicEntry>;
  /** The topic of each schedule, by schedule id. */
  scheduleTopics: Record<string, number>;
}

export function loadBotState(path: string): BotState {
  const read = readJsonTolerant(path);
  if (read.ok && typeof read.value === "object" && read.value !== null) {
    const value = read.value as Partial<BotState>;
    if (typeof value.offset === "number" && typeof value.topics === "object")
      return { offset: value.offset, topics: value.topics, scheduleTopics: value.scheduleTopics ?? {} };
  }
  return { offset: 0, topics: {}, scheduleTopics: {} };
}

export function saveBotState(path: string, state: BotState): void {
  writeFileAtomic(path, JSON.stringify(state, null, 2) + "\n");
}

/** The chat and the topic that a key of the topic map names. */
export function placeOf(key: string): { chatId: number; topicId: number | null } {
  const [chat, topic] = key.split(":");
  return { chatId: Number(chat), topicId: topic === "main" ? null : Number(topic) };
}

/** Where a chat lives in Telegram, or null when no topic and no main chat shows it. */
export function targetOf(state: BotState, sessionId: string): { chatId: number; topicId: number | null } | null {
  for (const [key, entry] of Object.entries(state.topics)) {
    if (entry.sessionId === sessionId) return placeOf(key);
  }
  return null;
}

/** A schedule's topic holds all its firings, so a delete or a rename of one firing keeps it. */
export function isScheduleTopic(state: BotState, topicId: number): boolean {
  return Object.values(state.scheduleTopics).includes(topicId);
}

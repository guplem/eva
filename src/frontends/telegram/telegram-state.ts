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

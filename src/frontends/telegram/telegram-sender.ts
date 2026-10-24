/** Sends messages to Telegram: plain text, Markdown answers, and calls that retry after a 429 or a network error. */
import type { Logger } from "../../shared/logger.ts";
import { TelegramError, type TelegramApi } from "./telegram-api.ts";
import { keepFencesWhole, splitForTelegram, toTelegramHtml } from "./telegram-format.ts";
import { threadOf } from "./telegram-messages.ts";

/** Telegram refuses a message past 4096 characters; the split leaves room for the HTML tags. */
export const messageLimit = 3_500;
/** The longest message that Telegram takes; `send` cuts a longer one. */
export const telegramMessageLimit = 4_096;
export const firstRetryMs = 1_000;
const sendRetries = 3;
/**
 * The longest total wait across the retries of one call. A send in the poll loop holds the loop:
 * no button, /stop or other chat is read while it waits.
 */
const sendWaitBudgetMs = 120_000;
/** A call that only logs its failure, such as the answer to a button, is useless when it comes late. */
const quietWaitBudgetMs = 30_000;

/** How a call goes again after a failure. */
interface RetryPolicy {
  /** The longest total wait across all retries of the call. */
  readonly waitBudgetMs: number;
}

export interface TelegramSenderOptions {
  readonly api: TelegramApi;
  readonly logger?: Logger;
  /** Waits before a retry; the bot's wait ends early at a stop. */
  readonly sleep: (ms: number) => Promise<void>;
}

export class TelegramSender {
  private readonly options: TelegramSenderOptions;

  constructor(options: TelegramSenderOptions) {
    this.options = options;
  }

  /** Sends Markdown as Telegram HTML, split under the limit; a part with refused HTML goes again as plain text (lesson 58). */
  async sendAnswer(chatId: number, topicId: number | null, markdown: string, quiet = false): Promise<void> {
    for (const chunk of keepFencesWhole(splitForTelegram(markdown, messageLimit))) {
      try {
        await this.callWithRetry("sendMessage", {
          chat_id: chatId,
          text: toTelegramHtml(chunk),
          parse_mode: "HTML",
          ...threadOf(topicId),
          ...(quiet ? { disable_notification: true } : {}),
        });
      } catch (error) {
        if (isHtmlRefused(error)) await this.send(chatId, topicId, chunk, undefined, quiet);
        else this.logFailedCall("sendMessage", error);
      }
    }
  }

  /** Sends plain text. Returns the id of the message, or null when Telegram did not take it. */
  async send(
    chatId: number,
    topicId: number | null,
    text: string,
    replyMarkup?: unknown,
    quiet = false,
  ): Promise<number | null> {
    try {
      const sent = await this.callWithRetry<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: text.slice(0, telegramMessageLimit),
        ...threadOf(topicId),
        ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
        ...(quiet ? { disable_notification: true } : {}),
      });
      return sent.message_id;
    } catch (error) {
      this.logFailedCall("sendMessage", error);
      return null;
    }
  }

  /** Plain text of any length, in parts: `send` would cut it at Telegram's limit with no sign. */
  async sendPlain(chatId: number, topicId: number | null, text: string, quiet = false): Promise<void> {
    for (const part of splitForTelegram(text, messageLimit)) await this.send(chatId, topicId, part, undefined, quiet);
  }

  /** A call that only logs its failure. */
  async quietCall(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.callWithRetry(method, params, { waitBudgetMs: quietWaitBudgetMs });
    } catch (error) {
      this.logFailedCall(method, error);
    }
  }

  /**
   * A call that goes again after a 429 or a network error, at most three times, while the waits
   * stay within the policy's budget. Any other error throws at once. Telegram refuses a call
   * before its 429 wait ends, so a retry that would come early gives up instead.
   */
  async callWithRetry<Result>(
    method: string,
    params: Record<string, unknown>,
    policy: RetryPolicy = { waitBudgetMs: sendWaitBudgetMs },
  ): Promise<Result> {
    let waitedMs = 0;
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.options.api.call<Result>(method, params);
      } catch (error) {
        const waitMs = sendRetryMs(error, retry);
        if (waitMs === null || retry >= sendRetries || waitedMs + waitMs > policy.waitBudgetMs) throw error;
        waitedMs += waitMs;
        await this.options.sleep(waitMs);
      }
    }
  }

  logFailedCall(method: string, error: unknown): void {
    this.options.logger?.log("warn", "A Telegram call failed.", { method, reason: String(error) });
  }
}

/**
 * The wait before a retry of a sending call, or null when a retry cannot help. A 429 waits what
 * Telegram asks for. A network error (code 0) waits 1, 2, then 4 seconds.
 */
function sendRetryMs(error: unknown, retry: number): number | null {
  if (!(error instanceof TelegramError)) return null;
  if (error.code === 429) return (error.retryAfterSeconds ?? 1) * 1_000;
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
export function isTopicNotModified(error: unknown): boolean {
  return error instanceof TelegramError && error.code === 400 && error.description.includes("TOPIC_NOT_MODIFIED");
}

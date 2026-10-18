/**
 * The health of the bot's poll loop: the 409 conflict window (lesson 56), the retry backoff,
 * and the alert that a poll which cannot work raises.
 */
import type { AlertProblem } from "../../core/alerts/alert-center.ts";
import type { Clock } from "../../shared/clock.ts";
import type { Logger } from "../../shared/logger.ts";
import { TelegramError } from "./telegram-api.ts";
import { firstRetryMs } from "./telegram-sender.ts";

/** What the poll loop does now, for a status line. */
export type TelegramPollState =
  | { readonly kind: "polling" }
  | { readonly kind: "failing"; readonly since: string; readonly reason: string }
  /** Another program polls this bot; Eva pauses the poll loop, and the core runs on. */
  | { readonly kind: "conflict"; readonly since: string };

/**
 * Lesson 56: count 409 conflicts in a window, and never let a success reset the count. Past
 * the limit, only the poll loop pauses: the owner reaches Eva from a phone, so Eva never exits.
 */
const conflictLimit = 3;
const conflictWindowMs = 2 * 60_000;
const conflictPauseMs = 10 * 60_000;
const maxPollRetryMs = 60_000;
/** A short Telegram outage heals by itself; only a long one needs the owner. */
const pollFailingAlertMs = 15 * 60_000;

export interface PollHealthOptions {
  readonly clock: Clock;
  readonly logger?: Logger;
  /** Tells the core about the poll's problem, or null when there is none. */
  readonly report: (problem: AlertProblem | null) => void;
  /** An error for a person, with the secrets removed. */
  readonly describeError: (error: unknown) => string;
}

export class PollHealth {
  private readonly options: PollHealthOptions;
  /** The times (ms) of the recent 409 conflicts, inside the conflict window. */
  private conflictTimes: number[];
  private nextPollRetryMs: number;
  private currentState: TelegramPollState;

  constructor(options: PollHealthOptions) {
    this.conflictTimes = [];
    this.nextPollRetryMs = firstRetryMs;
    this.currentState = { kind: "polling" };
    this.options = options;
  }

  state(): TelegramPollState {
    return this.currentState;
  }

  succeeded(): void {
    this.nextPollRetryMs = firstRetryMs;
    this.currentState = { kind: "polling" };
    this.report();
  }

  /** Records a failed poll and returns the wait before the next one. */
  failed(error: unknown): number {
    const now = this.options.clock.now();
    if (error instanceof TelegramError && error.code === 409) {
      this.conflictTimes = [
        ...this.conflictTimes.filter((time) => now.getTime() - time < conflictWindowMs),
        now.getTime(),
      ];
      if (this.conflictTimes.length >= conflictLimit) {
        this.conflictTimes = [];
        this.currentState = { kind: "conflict", since: now.toISOString() };
        this.options.logger?.log(
          "error",
          "Another program polls this Telegram bot. Eva pauses Telegram for 10 minutes.",
        );
        this.report();
        return conflictPauseMs;
      }
    }
    this.options.logger?.log("warn", "Telegram poll failed.", { reason: String(error) });
    if (this.currentState.kind !== "failing")
      this.currentState = { kind: "failing", since: now.toISOString(), reason: this.options.describeError(error) };
    this.report();
    if (error instanceof TelegramError && error.retryAfterSeconds !== null) return error.retryAfterSeconds * 1_000;
    return this.takeRetryMs();
  }

  /** The exponential backoff of the poll loop: 1 second, doubled after each failure, up to 60 seconds. */
  takeRetryMs(): number {
    const waitMs = this.nextPollRetryMs;
    this.nextPollRetryMs = Math.min(waitMs * 2, maxPollRetryMs);
    return waitMs;
  }

  /**
   * Tells the core about a poll that cannot work. The bot cannot say it over Telegram, so the
   * problem must reach the status and the web UI.
   */
  private report(): void {
    this.options.report(pollProblem(this.currentState, this.options.clock.now()));
  }
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

/** Waits, but returns at once when the signal aborts, so a stop never waits. */
export function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
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

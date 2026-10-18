/**
 * Problem alerts. The owner runs Eva unattended and has only a phone, so a failure must reach
 * the owner without a /status. Each problem has a stable key: Eva sends an alert when the
 * problem starts, again at most once in 24 hours while it lasts, and one "resolved" alert when it clears.
 */
import type { Logger } from "../../shared/logger.ts";
import type { Redactor } from "../../shared/redaction.ts";

export type AlertLevel = "warn" | "error";

export interface Alert {
  readonly key: string;
  /** "resolved" when the problem cleared; "news" for a one-off message that is no problem. */
  readonly level: AlertLevel | "resolved" | "news";
  /** What happened and what to do, in one line. */
  readonly message: string;
  readonly at: string;
}

export interface AlertProblem {
  readonly level: AlertLevel;
  readonly message: string;
  /** The line that the resolved alert carries. */
  readonly resolvedMessage: string;
}

type AlertListener = (alert: Alert) => Promise<void> | void;

export interface AlertCenterOptions {
  readonly now: () => Date;
  readonly logger?: Logger;
  readonly redactor?: Redactor;
}

interface OpenProblem {
  readonly problem: AlertProblem;
  readonly lastSentAt: number;
}

const repeatAfterMs = 24 * 60 * 60_000;

export class AlertCenter {
  private readonly options: AlertCenterOptions;
  private readonly listeners: Set<AlertListener>;
  private readonly open: Map<string, OpenProblem>;

  constructor(options: AlertCenterOptions) {
    this.options = options;
    this.listeners = new Set();
    this.open = new Map();
  }

  /** Returns an unsubscribe. */
  onAlert(listener: AlertListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The current state of one problem: a problem, or null when it is gone. */
  report(key: string, reported: AlertProblem | null): void {
    const current = this.open.get(key);
    if (reported === null) {
      if (current === undefined) return;
      this.open.delete(key);
      this.emit(key, "resolved", current.problem.resolvedMessage);
      return;
    }
    const problem = { ...reported, message: this.redact(reported.message) };
    const now = this.options.now().getTime();
    if (current !== undefined && now - current.lastSentAt < repeatAfterMs) {
      this.open.set(key, { problem, lastSentAt: current.lastSentAt });
      return;
    }
    this.open.set(key, { problem, lastSentAt: now });
    this.emit(key, problem.level, problem.message);
  }

  /** A one-off alert, such as a start after an unclean exit, or news. It never stays open. */
  notify(key: string, level: AlertLevel | "news", message: string): void {
    this.emit(key, level, message);
  }

  /** The message of each open problem, for the status. */
  openProblems(): string[] {
    return [...this.open.values()].map((entry) => entry.problem.message);
  }

  private emit(key: string, level: Alert["level"], message: string): void {
    const alert: Alert = { key, level, message: this.redact(message), at: this.options.now().toISOString() };
    this.options.logger?.log(level === "resolved" || level === "news" ? "info" : level, alert.message, { alert: key });
    // A listener runs in sync and scheduler code, so its failure must never reach the caller.
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(alert)).catch((error: unknown) => {
          this.logListenerFailure(error);
        });
      } catch (error) {
        this.logListenerFailure(error);
      }
    }
  }

  private logListenerFailure(error: unknown): void {
    this.options.logger?.log("warn", "An alert listener failed.", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  private redact(text: string): string {
    return this.options.redactor?.redact(text) ?? text;
  }
}

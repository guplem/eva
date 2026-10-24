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

export interface OpenAlert extends AlertProblem {
  readonly key: string;
}

/**
 * An open problem as the status shows it: the key tells a front end which button fixes it.
 * A hidden problem is one that the person closed; the web page shows no notice for it.
 */
export interface ProblemDetail extends Pick<OpenAlert, "key" | "level" | "message"> {
  readonly hidden: boolean;
}

/** The level of each problem that the person hid, by key. A higher level shows the problem again. */
export type HiddenProblems = Readonly<Record<string, AlertLevel>>;

type AlertListener = (alert: Alert) => Promise<void> | void;

export interface AlertCenterOptions {
  readonly now: () => Date;
  readonly logger?: Logger;
  readonly redactor?: Redactor;
  /** The marks saved before a restart, so a hidden problem stays hidden. */
  readonly hidden?: HiddenProblems;
  /** Saves the marks; the center does no file work. */
  readonly onHiddenChange?: (hidden: HiddenProblems) => void;
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
  private readonly hidden: Map<string, AlertLevel>;

  constructor(options: AlertCenterOptions) {
    this.options = options;
    this.listeners = new Set();
    this.open = new Map();
    this.hidden = new Map(Object.entries(options.hidden ?? {}));
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
      // A problem that starts again later is news, so it must show again.
      this.forgetHidden(key);
      if (current === undefined) return;
      this.open.delete(key);
      this.emit(key, "resolved", current.problem.resolvedMessage);
      return;
    }
    const problem = {
      ...reported,
      message: this.redact(reported.message),
      resolvedMessage: this.redact(reported.resolvedMessage),
    };
    const now = this.options.now().getTime();
    const hiddenLevel = this.hidden.get(key);
    // A new reason alone keeps it hidden: a relayed reason changes between failures, such as a timeout and then DNS.
    if (hiddenLevel === "error" || (hiddenLevel === "warn" && problem.level === "warn")) {
      this.open.set(key, { problem, lastSentAt: current?.lastSentAt ?? now });
      return;
    }
    // A problem that rose from warn to error is news, so it alerts at once.
    if (hiddenLevel !== undefined) this.forgetHidden(key);
    else if (current !== undefined && now - current.lastSentAt < repeatAfterMs) {
      this.open.set(key, { problem, lastSentAt: current.lastSentAt });
      return;
    }
    this.open.set(key, { problem, lastSentAt: now });
    this.emit(key, problem.level, problem.message);
  }

  /**
   * The person closed the notice of an open problem: no reminder, and no notice on the web page,
   * until the problem rises to an error or clears. False when no such problem is open.
   */
  hide(key: string): boolean {
    const current = this.open.get(key);
    if (current === undefined) return false;
    this.hidden.set(key, current.problem.level);
    this.saveHidden();
    return true;
  }

  /**
   * Forgets one problem with no resolved alert, such as a relayed problem on a hub that moved away.
   * The new hub sends it, so a "resolved" line here would be false.
   */
  dismiss(key: string): void {
    this.open.delete(key);
    this.forgetHidden(key);
  }

  /** A one-off alert, such as a start after an unclean exit, or news. It never stays open. */
  notify(key: string, level: AlertLevel | "news", message: string): void {
    this.emit(key, level, message);
  }

  /** The message of each open problem, for the status. */
  openProblems(): string[] {
    return [...this.open.values()].map((entry) => entry.problem.message);
  }

  /** Each open problem with its key, for the report that the hub reads. */
  openAlerts(): OpenAlert[] {
    return [...this.open].map(([key, entry]) => ({ key, ...entry.problem }));
  }

  /** Each open problem for a front end, with its hidden mark. */
  problemDetails(): ProblemDetail[] {
    return [...this.open].map(([key, { problem }]) => ({
      key,
      level: problem.level,
      message: problem.message,
      hidden: this.hidden.has(key),
    }));
  }

  /**
   * Forgets each saved mark whose problem is not open. Eva calls it once, after her first round of
   * checks: a problem that cleared while she was off reports no "resolved", so its mark would stay
   * and silence the next real failure.
   */
  forgetHiddenUnlessOpen(): void {
    const stale = [...this.hidden.keys()].filter((key) => !this.open.has(key));
    for (const key of stale) this.hidden.delete(key);
    if (stale.length > 0) this.saveHidden();
  }

  private forgetHidden(key: string): void {
    if (this.hidden.delete(key)) this.saveHidden();
  }

  private saveHidden(): void {
    this.options.onHiddenChange?.(Object.fromEntries(this.hidden));
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

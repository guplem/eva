/**
 * Eva's automatic updates (plan §10): a check at the frequency in the settings, and an install
 * only when no chat runs a turn, so a restart never cuts a turn off. A manual update waits for
 * the same moment.
 */
import type { Logger } from "../../shared/logger.ts";
import type { EvaConfig } from "../instance/home.ts";

export type UpdateFrequency = EvaConfig["updates"]["frequency"];

/** What one channel found: versions for a release, short commit ids for a source checkout. */
export interface UpdateCheck {
  readonly current: string;
  readonly latest: string;
  readonly available: boolean;
}

/** Where updates come from: signed releases for the executable, git for a source checkout. */
export interface UpdateChannel {
  readonly kind: "executable" | "source";
  check(): Promise<UpdateCheck>;
  /** Installs the latest version. Returns the version before and after. */
  apply(): Promise<UpdateCheck>;
}

export type UpdatePhase = "idle" | "checking" | "waiting_for_idle" | "updating" | "restarting";

/** The step that set `lastError`, so a failed install never reads as a failed check. */
export type UpdateStep = "check" | "install";

export interface UpdateStatus {
  readonly kind: UpdateChannel["kind"];
  readonly frequency: UpdateFrequency;
  readonly phase: UpdatePhase;
  readonly current: string | null;
  readonly latest: string | null;
  readonly available: boolean;
  readonly lastCheckAt: string | null;
  readonly lastError: string | null;
  readonly failedStep: UpdateStep | null;
}

export interface UpdaterOptions {
  readonly channel: UpdateChannel;
  readonly frequency: () => UpdateFrequency;
  /** True when no chat runs a turn. */
  readonly isIdle: () => boolean;
  /** Stops Eva so that the new version starts. */
  readonly restart: () => void;
  readonly now: () => Date;
  readonly logger?: Logger;
}

const hourMs = 60 * 60_000;
const frequencyMs: Readonly<Record<Exclude<UpdateFrequency, "off">, number>> = {
  hourly: hourMs,
  daily: 24 * hourMs,
  weekly: 7 * 24 * hourMs,
};

export class Updater {
  private readonly options: UpdaterOptions;
  private phase: UpdatePhase;
  private last: UpdateCheck | null;
  private lastCheckAt: Date | null;
  private lastError: string | null;
  private failedStep: UpdateStep | null;

  constructor(options: UpdaterOptions) {
    this.options = options;
    this.phase = "idle";
    this.last = null;
    this.lastCheckAt = null;
    this.lastError = null;
    this.failedStep = null;
  }

  status(): UpdateStatus {
    return {
      kind: this.options.channel.kind,
      frequency: this.options.frequency(),
      phase: this.phase,
      current: this.last?.current ?? null,
      latest: this.last?.latest ?? null,
      available: this.last?.available ?? false,
      lastCheckAt: this.lastCheckAt?.toISOString() ?? null,
      lastError: this.lastError,
      failedStep: this.failedStep,
    };
  }

  /** Looks for a newer version, and installs nothing. */
  async check(): Promise<UpdateStatus> {
    if (this.phase !== "idle") return this.status();
    this.phase = "checking";
    try {
      this.last = await this.options.channel.check();
      this.lastError = null;
      this.failedStep = null;
    } catch (error) {
      this.lastError = errorText(error);
      this.failedStep = "check";
    } finally {
      this.lastCheckAt = this.options.now();
      this.phase = "idle";
    }
    return this.status();
  }

  /** Checks, then installs a newer version as soon as no chat runs a turn. */
  async updateNow(): Promise<UpdateStatus> {
    if (this.phase === "waiting_for_idle") return this.status();
    await this.check();
    if (this.last?.available !== true || this.lastError !== null) return this.status();
    if (!this.options.isIdle()) {
      this.phase = "waiting_for_idle";
      return this.status();
    }
    return this.install();
  }

  /** Called once a minute: installs a waiting update, or checks when the frequency says so. */
  async tick(): Promise<void> {
    if (this.phase === "waiting_for_idle") {
      if (this.options.isIdle()) await this.install();
      return;
    }
    const frequency = this.options.frequency();
    if (frequency === "off" || this.phase !== "idle") return;
    const due =
      this.lastCheckAt === null || this.options.now().getTime() - this.lastCheckAt.getTime() >= frequencyMs[frequency];
    if (due) await this.updateNow();
  }

  private async install(): Promise<UpdateStatus> {
    this.phase = "updating";
    try {
      const installed = await this.options.channel.apply();
      this.last = installed;
      this.options.logger?.log("info", "Eva updated; she restarts.", { from: installed.current, to: installed.latest });
      this.phase = "restarting";
      this.options.restart();
    } catch (error) {
      this.lastError = errorText(error);
      this.failedStep = "install";
      this.options.logger?.log("warn", "The update failed.", { reason: this.lastError });
      this.phase = "idle";
    }
    return this.status();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Eva's automatic updates: a check at the frequency in the settings, and an install
 * only when no chat runs a turn, so a restart never cuts a turn off. A manual update waits for
 * the same moment. The person's policy decides which releases she installs by herself.
 */
import { EvaError } from "../../shared/errors.ts";
import type { Logger } from "../../shared/logger.ts";
import type { EvaConfig } from "../settings/home.ts";
import { pickUpdate, type NewerRelease, type ReleaseInfo, type UpdatePolicy } from "./release-policy.ts";
import { isNewerVersion } from "./release-verification.ts";

export type UpdateFrequency = EvaConfig["updates"]["frequency"];

/** What one channel found: versions for a release, short commit ids for a source checkout. */
export interface UpdateCheck {
  readonly current: string;
  readonly latest: string;
  readonly available: boolean;
  /** The newer releases, newest first. Null for a source checkout, which has no versions to pick. */
  readonly releases: readonly ReleaseInfo[] | null;
}

/** Where updates come from: signed releases for the executable, git for a source checkout. */
export interface UpdateChannel {
  readonly kind: "executable" | "source";
  check(): Promise<UpdateCheck>;
  /** Installs `version`, or the newest one when it is undefined. Returns the version before and after. */
  apply(version?: string): Promise<UpdateCheck>;
}

export type UpdatePhase = "idle" | "checking" | "waiting_for_idle" | "updating" | "restarting";

/** The step that set `lastError`, so a failed install never reads as a failed check. */
export type UpdateStep = "check" | "install";

export interface UpdateStatus {
  readonly kind: UpdateChannel["kind"];
  readonly frequency: UpdateFrequency;
  readonly install: UpdatePolicy;
  readonly phase: UpdatePhase;
  readonly current: string | null;
  readonly latest: string | null;
  /** True when a version waits that Eva installs: the policy's pick, or one chosen by hand. */
  readonly available: boolean;
  /** The version that Eva installs next, or null. */
  readonly target: string | null;
  /** The newest release, when the policy does not install it. */
  readonly heldBack: string | null;
  /** The newer releases, newest first. Empty for a source checkout. */
  readonly releases: readonly NewerRelease[];
  readonly lastCheckAt: string | null;
  readonly lastError: string | null;
  readonly failedStep: UpdateStep | null;
}

export interface UpdaterOptions {
  readonly channel: UpdateChannel;
  readonly frequency: () => UpdateFrequency;
  readonly policy: () => UpdatePolicy;
  /** The version that a vault from a newer Eva needs, or "newest". Eva installs at least that. */
  readonly requiredVersion?: () => string | undefined;
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
  /** A version chosen by hand, which waits for Eva to be idle. */
  private chosen: string | null;
  /** The new version is in place, and Eva restarts once no chat runs a turn. */
  private restartPending: boolean;

  constructor(options: UpdaterOptions) {
    this.options = options;
    this.phase = "idle";
    this.last = null;
    this.lastCheckAt = null;
    this.lastError = null;
    this.failedStep = null;
    this.chosen = null;
    this.restartPending = false;
  }

  status(): UpdateStatus {
    const policy = this.options.policy();
    const releases = this.last?.releases ?? null;
    const pick =
      releases === null || this.last === null
        ? null
        : pickUpdate(this.last.current, releases, policy, this.options.requiredVersion?.());
    const target = this.target();
    return {
      kind: this.options.channel.kind,
      frequency: this.options.frequency(),
      install: policy,
      phase: this.phase,
      current: this.last?.current ?? null,
      latest: this.last?.latest ?? null,
      available: target !== null,
      target,
      heldBack: this.heldBack(pick?.heldBack ?? null),
      releases: pick?.newer ?? [],
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

  /**
   * Checks, then installs as soon as no chat runs a turn: `version` when the person chose one,
   * else the newest release that the policy allows. Throws for a version that is not a newer release.
   */
  async updateNow(version?: string): Promise<UpdateStatus> {
    // One check or install at a time: a second download could replace the first one's file.
    if (this.phase === "checking" || this.phase === "updating" || this.phase === "restarting") {
      // A chosen version must never vanish without a word.
      if (version !== undefined)
        throw new EvaError(
          "update_failed",
          `Eva is busy with an update check or install. Try ${version} again in a moment.`,
        );
      return this.status();
    }
    if (this.phase !== "waiting_for_idle") {
      await this.check();
      if (this.lastError !== null) return this.status();
    }
    if (version !== undefined) this.choose(version);
    if (this.phase === "waiting_for_idle") return this.status();
    if (this.target() === null) return this.status();
    if (!this.options.isIdle()) {
      this.phase = "waiting_for_idle";
      return this.status();
    }
    return this.install();
  }

  private choose(version: string): void {
    const releases = this.last?.releases ?? null;
    if (releases === null)
      throw new EvaError("update_failed", "This Eva runs from a git checkout, so she cannot install a chosen version.");
    if (!releases.some((release) => release.version === version))
      throw new EvaError(
        "update_failed",
        `${version} is not a newer release than ${this.last?.current ?? "this version"}. Eva never installs an older version.`,
      );
    this.chosen = version;
  }

  /** Called once a minute: installs a waiting update, or checks when the frequency says so. */
  async tick(): Promise<void> {
    if (this.restartPending) {
      this.restartWhenIdle();
      return;
    }
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

  /** The version to install next: one chosen by hand, the policy's pick, or the newest commit of a checkout. */
  private target(): string | null {
    if (this.chosen !== null) return this.chosen;
    const last = this.last;
    if (last === null) return null;
    if (last.releases === null) return last.available ? last.latest : null;
    return pickUpdate(last.current, last.releases, this.options.policy(), this.options.requiredVersion?.()).install;
  }

  /** A version that the person chose is not held back, and neither is an older one. */
  private heldBack(version: string | null): string | null {
    if (version === null || this.chosen === null) return version;
    return isNewerVersion(version, this.chosen) ? version : null;
  }

  private restartWhenIdle(): void {
    if (!this.options.isIdle()) return;
    this.restartPending = false;
    this.options.restart();
  }

  private async install(): Promise<UpdateStatus> {
    const target = this.target();
    // The policy can change while Eva waits for the chats to end.
    if (target === null) {
      this.phase = "idle";
      return this.status();
    }
    this.phase = "updating";
    try {
      const installed = await this.options.channel.apply(this.last?.releases === null ? undefined : target);
      this.last = installed;
      this.chosen = null;
      this.options.logger?.log("info", "Eva updated; she restarts.", { from: installed.current, to: installed.latest });
      this.phase = "restarting";
      // A chat can start during a long download: the restart waits for it too (lesson 92).
      this.restartPending = true;
      this.restartWhenIdle();
    } catch (error) {
      this.lastError = errorText(error);
      this.failedStep = "install";
      this.chosen = null;
      this.options.logger?.log("warn", "The update failed.", { reason: this.lastError });
      this.phase = "idle";
    }
    return this.status();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

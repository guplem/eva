/**
 * The engine update of the settings page: `claude update`, only when no chat runs a turn,
 * because the update replaces the program that each turn starts. The result comes from the
 * exit code and the versions before and after, never from the output text (lesson 93).
 */
import type { Logger } from "../../shared/logger.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export type EngineUpdatePhase = "idle" | "waiting_for_idle" | "updating";

export interface EngineUpdateResult {
  readonly outcome: "updated" | "up_to_date" | "failed";
  /** The version that `claude --version` gives; null when it could not be read. */
  readonly before: string | null;
  readonly after: string | null;
  /** Why the update failed; null when it did not. */
  readonly detail: string | null;
  readonly at: string;
}

export interface EngineUpdateStatus {
  readonly phase: EngineUpdatePhase;
  readonly last: EngineUpdateResult | null;
}

export interface EngineUpdaterOptions {
  readonly executable: string;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  /** True when no chat runs a turn and no schedule fires. */
  readonly isIdle: () => boolean;
  readonly now: () => Date;
  readonly logger?: Logger;
}

const versionTimeoutMs = 30_000;
/** The update downloads a new program. */
const updateTimeoutMs = 5 * 60_000;

export class EngineUpdater {
  private readonly options: EngineUpdaterOptions;
  private phase: EngineUpdatePhase;
  private last: EngineUpdateResult | null;

  constructor(options: EngineUpdaterOptions) {
    this.options = options;
    this.phase = "idle";
    this.last = null;
  }

  status(): EngineUpdateStatus {
    return { phase: this.phase, last: this.last };
  }

  /** Updates at once, or as soon as no chat runs a turn. */
  async updateNow(): Promise<EngineUpdateStatus> {
    if (this.phase !== "idle") return this.status();
    if (!this.options.isIdle()) {
      this.phase = "waiting_for_idle";
      return this.status();
    }
    return this.run();
  }

  /** Called from Eva's background tick: runs a waiting update when no chat runs a turn. */
  async tick(): Promise<void> {
    if (this.phase === "waiting_for_idle" && this.options.isIdle()) await this.run();
  }

  private async run(): Promise<EngineUpdateStatus> {
    this.phase = "updating";
    try {
      const before = await this.version();
      const failure = await this.update();
      const after = await this.version();
      // With no version before, a clean exit can only say that the version now is the latest.
      const outcome =
        failure !== null || after === null ? "failed" : before === null || after === before ? "up_to_date" : "updated";
      const detail = outcome !== "failed" ? null : (failure ?? "claude did not say its version after the update.");
      this.last = { outcome, before, after, detail, at: this.options.now().toISOString() };
      if (outcome === "failed")
        this.options.logger?.log("warn", "The Claude Code update failed.", { reason: detail ?? "" });
      else if (outcome === "updated")
        this.options.logger?.log("info", "Claude Code was updated.", { from: before ?? "", to: after });
      else this.options.logger?.log("info", "Claude Code is already the latest version.", { version: after });
    } finally {
      this.phase = "idle";
    }
    return this.status();
  }

  /** Runs `claude update`. Returns why it failed, or null when it exited cleanly. */
  private async update(): Promise<string | null> {
    try {
      const result = await this.options.runner.run([this.options.executable, "update"], {
        cwd: process.cwd(),
        environment: this.options.environment,
        timeoutMs: updateTimeoutMs,
      });
      if (result.exitCode === 0) return null;
      // An install from a package manager, such as npm, refuses `claude update`.
      const reason =
        firstLine(result.stderr) ??
        firstLine(result.stdout) ??
        `claude update exited with code ${String(result.exitCode)}.`;
      return `${reason} Update Claude Code with the tool that installed it.`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The version that `claude --version` gives, or null; a version read never throws (lesson 94). */
  private async version(): Promise<string | null> {
    try {
      const result = await this.options.runner.run([this.options.executable, "--version"], {
        cwd: process.cwd(),
        environment: this.options.environment,
        timeoutMs: versionTimeoutMs,
      });
      // The output is "2.1.0 (Claude Code)"; the page already names Claude Code.
      return result.exitCode === 0 ? (firstLine(result.stdout)?.replace(/\s*\(Claude Code\)$/, "") ?? null) : null;
    } catch {
      return null;
    }
  }
}

function firstLine(text: string): string | null {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return line === "" ? null : line;
}

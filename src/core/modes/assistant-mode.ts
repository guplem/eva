/**
 * Assistant mode: Eva's own behaviour at the vault root.
 * Before a turn: pull the vault, snapshot it, build the prompt. After a turn: snapshot and save the vault, and keep
 * an open pskill run of this session going, since the vault has no hooks.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import type { McpServerSpec } from "../../shared/engine-port.ts";
import type { Logger } from "../../shared/logger.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import type { VaultSyncState } from "../vault/vault-sync.ts";
import { moveAssistantPersonality, withMovedSections } from "../migrations/assistant-rules-move.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { aboutMeProblemNote, readAboutMe } from "../vault/about-me.ts";
import { turnSnapshotRef } from "../vault/vault-snapshots.ts";

export interface VaultSyncPort {
  pull(): Promise<VaultSyncState>;
  save(): Promise<VaultSyncState>;
  /** Saves the files of the vault under a hidden ref. It never fails the turn. */
  snapshot(ref: string): Promise<void>;
}

export interface AssistantPreparerOptions {
  readonly vaultPath: string;
  readonly vaultSync: VaultSyncPort;
  /** Eva's base prompt, shipped with the engine. */
  readonly basePrompt: string;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
  /** An IANA time zone, such as Europe/Madrid. A server clock is often UTC (lesson 68). */
  readonly timeZone: string;
  /** The MCP servers of every Assistant turn, such as the Google tools. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** Where pskill's error output goes. */
  readonly logger?: Logger;
}

const pskillTimeoutMs = 30_000;

export class AssistantPreparer implements TurnPreparer {
  private readonly options: AssistantPreparerOptions;
  /** The appended prompt of each session, read at its first turn. */
  private readonly promptBySession: Map<string, string>;
  /** The index of the running turn of each session, from its start, for the snapshot after it. */
  private readonly turnBySession: Map<string, number>;

  constructor(options: AssistantPreparerOptions) {
    this.options = options;
    this.promptBySession = new Map();
    this.turnBySession = new Map();
  }

  async prepare(session: SessionRecord): Promise<PreparedTurn> {
    await this.options.vaultSync.pull();
    // After the pull: the remote's changes are not the answer's. The record gets the turn at its
    // end, so its index is the count of turns now (#525).
    const turnIndex = session.turns.length;
    this.turnBySession.set(session.id, turnIndex);
    await this.options.vaultSync.snapshot(turnSnapshotRef(session.id, turnIndex, "before"));
    const personalRulesPath = join(this.options.vaultPath, ".eva", "assistant.md");
    if (!existsSync(personalRulesPath)) {
      // An answer from an agent with no identity is worse than an error (lesson 11).
      throw new EvaError("vault_not_found", `${personalRulesPath} is missing, so Eva has no assistant rules.`);
    }
    const pluginFolder = join(this.options.vaultPath, ".eva");
    // Fixed for the session, even when the agent edits .eva/assistant.md in it (lesson 115), so the
    // appended text stays byte-identical and the prompt cache holds (lesson 40). A restart reads it again.
    const appendSystemPrompt =
      this.promptBySession.get(session.id) ?? `${this.options.basePrompt}\n\n${this.personalRules(personalRulesPath)}`;
    this.promptBySession.set(session.id, appendSystemPrompt);
    return {
      startFolder: session.startFolder,
      // The time goes in the message, never in the prompt (lesson 40).
      appendSystemPrompt,
      messagePrefix: this.messagePrefix(),
      pluginFolders: existsSync(join(pluginFolder, ".claude-plugin")) ? [pluginFolder] : [],
      mcpServers: this.options.mcpServers,
      trusted: true,
      // `eva work` reads it, so a project's result comes back to this chat.
      environment: { ...this.options.environment, EVA_SESSION_ID: session.id },
    };
  }

  /** The local time, and a note when `Life/About me.md` has a field that Eva must fix. */
  private messagePrefix(): string {
    const time = `[Local time: ${formatLocalTime(this.options.now(), this.options.timeZone)}, ${this.options.timeZone}]`;
    const note = aboutMeProblemNote(readAboutMe(this.options.vaultPath).problems);
    return note === null ? time : `${time}\n${note}`;
  }

  /**
   * Only the hub migrates the vault. Until it does, a satellite adds the sections that left the
   * built-in prompt itself, so its rules stay whole. Remove this after one release.
   */
  private personalRules(path: string): string {
    const text = readFileSync(path, "utf-8");
    const migrated = migrationApplied(vaultMigrationRecordPath(this.options.vaultPath), moveAssistantPersonality.id);
    return migrated ? text : (withMovedSections(text) ?? text);
  }

  async afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null> {
    const turnIndex = this.turnBySession.get(session.id);
    this.turnBySession.delete(session.id);
    if (turnIndex !== undefined) await this.options.vaultSync.snapshot(turnSnapshotRef(session.id, turnIndex, "after"));
    await this.options.vaultSync.save();
    // A stopped or failed turn must end the work: a usage limit would fail each follow-up again.
    if (!outcome.finished) return null;
    return this.pskillFollowUp(session);
  }

  /** Asks pskill, with the same input its Stop hook receives, whether this session must continue. */
  private async pskillFollowUp(session: SessionRecord): Promise<string | null> {
    if (!existsSync(join(this.options.vaultPath, ".pskill", "pskill.py"))) return null;
    try {
      const result = await this.options.runner.run(
        ["uv", "run", ".pskill/pskill.py", "hook", "stop", "--harness", "claude-code"],
        {
          cwd: this.options.vaultPath,
          environment: this.options.environment,
          timeoutMs: pskillTimeoutMs,
          // Always the session id: without one, pskill checks the runs of every session.
          stdin: JSON.stringify({ session_id: session.engineSessionId, cwd: this.options.vaultPath }),
        },
      );
      if (result.stderr.trim() !== "") {
        this.options.logger?.log("warn", "pskill wrote to stderr.", { stderr: result.stderr.trim() });
      }
      return readContinueMessage(result.stdout);
    } catch (error) {
      this.options.logger?.log("warn", "pskill could not run.", { reason: String(error) });
      return null;
    }
  }
}

function readContinueMessage(stdout: string): string | null {
  const text = stdout.trim();
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text) as { hookSpecificOutput?: { additionalContext?: unknown } };
    const message = parsed.hookSpecificOutput?.additionalContext;
    return typeof message === "string" && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

/** Such as `2026-10-14 12:30`, in the person's time zone. */
export function formatLocalTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

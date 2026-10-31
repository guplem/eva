/**
 * Assistant mode: Eva's own behaviour at the vault root.
 * Before a turn: pull the vault, snapshot it, build the prompt. After a turn: snapshot and save the vault, and keep
 * an open pskill run of this session going, since the vault has no hooks.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readTextTolerant } from "../../shared/files.ts";
import type { McpServerSpec } from "../../shared/engine-port.ts";
import type { Logger } from "../../shared/logger.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { ContextPart } from "../../shared/chat-context.ts";
import type { Project } from "../projects/project-catalog.ts";
import type { ModeContext, PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import { moveAssistantPersonality, withMovedSections } from "../migrations/assistant-rules-move.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { aboutMeProblemNote, readAboutMe } from "../vault/about-me.ts";
import { projectsBlock } from "./projects-block.ts";
import { VaultTurns, type VaultSyncPort } from "./vault-turns.ts";

export interface AssistantPreparerOptions {
  readonly vaultPath: string;
  readonly vaultSync: VaultSyncPort;
  /**
   * Writes Eva's own vault edits that waited for the turn, such as the last location, before the
   * snapshot after it. So an undo of the turn also undoes them. It never fails the turn.
   */
  readonly beforeEndSnapshot?: (sessionId: string) => Promise<void>;
  /** Eva's base prompt, shipped with the engine. */
  readonly basePrompt: string;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
  /** An IANA time zone, such as Europe/Madrid. A server clock is often UTC (lesson 68). */
  readonly timeZone: string;
  /** The MCP servers of every Assistant turn, such as the Google tools. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** The projects of the vault and of the extra roots, read at the first turn of each chat (#690). */
  readonly projects: () => readonly Project[];
  /** Where pskill's error output goes. */
  readonly logger?: Logger;
}

const pskillTimeoutMs = 30_000;

/** The parts of the appended prompt that Eva reads from the vault at the first turn of a chat. */
interface KeptPrompt {
  readonly rules: string;
  /** Null when no project is active or in use. */
  readonly projects: string | null;
}

export class AssistantPreparer implements TurnPreparer {
  private readonly options: AssistantPreparerOptions;
  /** The appended prompt of each session, read at its first turn. */
  private readonly promptBySession: Map<string, KeptPrompt>;
  private readonly vaultTurns: VaultTurns;

  constructor(options: AssistantPreparerOptions) {
    this.options = options;
    this.promptBySession = new Map();
    this.vaultTurns = new VaultTurns(options.vaultSync);
  }

  async prepare(session: SessionRecord): Promise<PreparedTurn> {
    await this.vaultTurns.before(session);
    const personalRulesPath = join(this.options.vaultPath, ".eva", "assistant.md");
    if (!existsSync(personalRulesPath)) {
      // An answer from an agent with no identity is worse than an error (lesson 11).
      throw new EvaError("vault_not_found", `${personalRulesPath} is missing, so Eva has no assistant rules.`);
    }
    // Fixed for the session, even when the agent edits .eva/assistant.md or a project's status in it
    // (lesson 115), so the appended text stays byte-identical and the prompt cache holds (lesson 40).
    // A restart reads it again.
    const kept = this.promptBySession.get(session.id) ?? {
      rules: this.personalRules(personalRulesPath),
      projects: projectsBlock(this.options.projects()),
    };
    this.promptBySession.set(session.id, kept);
    return {
      startFolder: session.startFolder,
      projectFolder: null,
      // The time goes in the message, never in the prompt (lesson 40).
      appendSystemPrompt: this.appendedPrompt(kept),
      messagePrefix: this.messagePrefix(),
      pluginFolders: this.pluginFolders(),
      mcpServers: this.options.mcpServers,
      trusted: true,
      // The engine turns both off in Assistant mode by itself; these say the same.
      harnessMemory: false,
      folderHooks: false,
      // `eva work` reads it, so a project's result comes back to this chat.
      environment: { ...this.options.environment, EVA_SESSION_ID: session.id },
    };
  }

  describe(session: SessionRecord): Promise<ModeContext> {
    const rulesPath = join(this.options.vaultPath, ".eva", "assistant.md");
    const kept = this.promptBySession.get(session.id);
    // A file that Eva cannot read must not break the whole details, so this read never throws.
    const onDisk = readTextTolerant(rulesPath);
    // A running chat keeps the rules and the projects of its first turn since Eva started, even when they changed.
    const rules = kept?.rules ?? (onDisk === null ? null : this.withPersonality(onDisk));
    const projects = kept === undefined ? projectsBlock(this.options.projects()) : kept.projects;
    const parts: ContextPart[] = [
      { group: "prompt", title: "Eva's prompt", source: null, text: this.options.basePrompt, note: null },
      {
        group: "prompt",
        title: "Your rules for Eva",
        source: rulesPath,
        text: rules,
        // `prepare` checks that the file exists before each turn, also when the chat keeps a copy.
        note: !existsSync(rulesPath)
          ? "The file is missing, so a new message fails."
          : rules === null
            ? "Eva cannot read the file."
            : null,
      },
      ...(projects === null
        ? []
        : [
            {
              group: "prompt" as const,
              title: "Your projects",
              source: null,
              text: projects,
              note: "Eva lists the projects with the status Active or In use at the start of each chat. A change shows in the next chat.",
            },
          ]),
      {
        group: "message",
        title: "Before each message",
        source: null,
        text: this.messagePrefix(),
        note: "Eva puts this text before each of your messages, with the time of that message.",
      },
    ];
    return Promise.resolve({
      parts,
      engine: {
        mode: "assistant",
        startFolder: session.startFolder,
        projectFolder: null,
        trusted: true,
        pluginFolders: this.pluginFolders(),
        environment: this.options.environment,
      },
    });
  }

  /** Eva's prompt, the person's rules, and then the projects, so the person's rules stay next to Eva's. */
  private appendedPrompt(kept: KeptPrompt): string {
    const head = `${this.options.basePrompt}\n\n${kept.rules}`;
    return kept.projects === null ? head : `${head.trimEnd()}\n\n${kept.projects}`;
  }

  /** The vault's `.eva/` folder gives the assistant skills, when it is a plugin. */
  private pluginFolders(): string[] {
    const pluginFolder = join(this.options.vaultPath, ".eva");
    return existsSync(join(pluginFolder, ".claude-plugin")) ? [pluginFolder] : [];
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
    return this.withPersonality(readFileSync(path, "utf-8"));
  }

  private withPersonality(text: string): string {
    const migrated = migrationApplied(vaultMigrationRecordPath(this.options.vaultPath), moveAssistantPersonality.id);
    return migrated ? text : (withMovedSections(text) ?? text);
  }

  async afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null> {
    await this.vaultTurns.after(session, () => this.options.beforeEndSnapshot?.(session.id));
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

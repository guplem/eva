/**
 * Assistant mode: Eva's own behaviour at the vault root.
 * Before a turn: pull the vault, snapshot it, build the prompt. After a turn: snapshot and save the vault, and keep
 * an open pskill run of this session going, since the vault has no hooks.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { aboutMeProblemNote, readAboutMe } from "../vault/about-me.ts";
import { pinFiles } from "../migrations/pinned-files.ts";
import { pinnedBlock, type PinnedBlock } from "./pinned-block.ts";
import { findPinnedFiles, readsOldImportant } from "./pinned-files.ts";
import { VaultTurns, type TurnSnapshots, type VaultSyncPort } from "./vault-turns.ts";
import { widgetsBlock } from "./widgets-block.ts";
import type { EvaCore } from "./eva-core.ts";
import { formatBlock, type FormatSettings } from "./format-block.ts";
import { clockTime, type Clock } from "../../shared/time-format.ts";

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
  /** Eva's own skills, loaded before the vault's (#771). */
  readonly evaCore: EvaCore;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
  /** An IANA time zone, such as Europe/Madrid. A server clock is often UTC (lesson 68). */
  readonly timeZone: string;
  /**
   * The zone of "today" for the case marks of the pinned block: the setting, or else the computer's
   * own zone, as the person decided. `timeZone` when not given.
   */
  readonly todayTimeZone?: string;
  /** The MCP servers of every Assistant turn, such as the Google tools. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** The projects of the vault and of the extra roots, read at the first turn of each chat for the pinned block. */
  readonly projects: () => readonly Project[];
  /**
   * The person's format settings, read at the first turn of each chat for the format block (#770),
   * and at each message for the clock of the local time.
   */
  readonly formatSettings?: () => FormatSettings;
  /** One line for each widget that is on, read at the first turn of each chat (#692). */
  readonly widgetLines?: () => readonly string[];
  /** Checks the data files that a turn changed against the widget schemas: one sentence for each problem. */
  readonly checkWidgetData?: (paths: readonly string[]) => readonly string[];
  /**
   * The line that tells the first new chat on the hub that a newer vault structure exists (#773).
   * Each call that returns a line uses it up.
   */
  readonly vaultStructureLine?: () => string | null;
  /** Where pskill's error output goes. */
  readonly logger?: Logger;
}

const pskillTimeoutMs = 30_000;

/** The parts of the appended prompt that Eva reads from the vault at the first turn of a chat. */
interface KeptFormat {
  readonly settings: FormatSettings;
  readonly text: string;
}

interface KeptPrompt {
  readonly rules: string;
  /** The pinned files (#769). Its text is null when nothing is pinned. */
  readonly pinned: PinnedBlock;
  /** The format settings of the chat's first turn, and their block. Null when the preparer has none. */
  readonly format: KeptFormat | null;
  /** Null when no widget is on. */
  readonly widgets: string | null;
  /** The vault structure line, which only the first new chat after the alert gets (#773). */
  readonly structureLine: string | null;
}

export class AssistantPreparer implements TurnPreparer {
  private readonly options: AssistantPreparerOptions;
  /** The appended prompt of each session, read at its first turn. */
  private readonly promptBySession: Map<string, KeptPrompt>;
  /** The plugin folders of each session's last turn, so its details list the skills that it got. */
  private readonly foldersBySession: Map<string, readonly string[]>;
  private readonly vaultTurns: VaultTurns;
  /** The sessions whose last turn was a fix of widget data that Eva asked for. */
  private readonly fixingData: Set<string>;

  constructor(options: AssistantPreparerOptions) {
    this.options = options;
    this.promptBySession = new Map();
    this.foldersBySession = new Map();
    this.vaultTurns = new VaultTurns(options.vaultSync);
    this.fixingData = new Set();
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
      rules: readFileSync(personalRulesPath, "utf-8"),
      pinned: this.pinnedBlockNow(),
      format: this.formatBlockNow(),
      widgets: this.widgetsBlockNow(),
      // Only a new chat that a person started: a chat with turns started before the alert, and a schedule's chat has nobody to agree.
      structureLine:
        session.turns.length === 0 && session.source !== "schedule"
          ? (this.options.vaultStructureLine?.() ?? null)
          : null,
    };
    this.promptBySession.set(session.id, kept);
    const pluginFolders = this.pluginFolders();
    this.foldersBySession.set(session.id, pluginFolders);
    return {
      startFolder: session.startFolder,
      projectFolder: null,
      // The time goes in the message, never in the prompt (lesson 40).
      appendSystemPrompt: this.appendedPrompt(kept),
      messagePrefix: this.messagePrefix(kept.format),
      pluginFolders,
      mcpServers: this.options.mcpServers,
      trusted: true,
      // The engine turns both off in Assistant mode by itself; these say the same.
      harnessMemory: false,
      folderHooks: false,
      // The outer level may know the inner ones, so the Assistant keeps the whole vault (#711).
      fileWall: null,
      // `eva work` reads it, so a project's result comes back to this chat.
      environment: { ...this.options.environment, EVA_SESSION_ID: session.id },
    };
  }

  describe(session: SessionRecord): Promise<ModeContext> {
    const rulesPath = join(this.options.vaultPath, ".eva", "assistant.md");
    const kept = this.promptBySession.get(session.id);
    // A file that Eva cannot read must not break the whole details, so this read never throws.
    const onDisk = readTextTolerant(rulesPath);
    // A running chat keeps the rules and the pinned files of its first turn since Eva started, even when they changed.
    const rules = kept?.rules ?? onDisk;
    const pinned = kept === undefined ? this.pinnedBlockNow() : kept.pinned;
    const format = kept === undefined ? this.formatBlockNow() : kept.format;
    const widgets = kept === undefined ? this.widgetsBlockNow() : kept.widgets;
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
      ...(pinned.text === null
        ? []
        : [
            {
              group: "prompt" as const,
              title: "Your pinned files",
              source: null,
              text: pinned.text,
              note: pinnedNote(pinned),
            },
          ]),
      ...(format === null
        ? []
        : [
            {
              group: "prompt" as const,
              title: "Your format settings",
              source: null,
              text: format.text,
              note: "Eva reads the answer language, the time zone, the units, the clock and the first day of the week from Settings at the start of each chat. A change shows in the next chat.",
            },
          ]),
      ...(widgets === null
        ? []
        : [
            {
              group: "prompt" as const,
              title: "Your widgets",
              source: null,
              text: widgets,
              note: "Eva lists the widgets that are on at the start of each chat. A change shows in the next chat.",
            },
          ]),
      ...(kept?.structureLine === null || kept?.structureLine === undefined
        ? []
        : [
            {
              group: "prompt" as const,
              title: "Vault structure",
              source: null,
              text: kept.structureLine,
              note: "Eva tells the first new chat after the notice that a newer vault structure exists. Later chats do not get this line.",
            },
          ]),
      {
        group: "message",
        title: "Before each message",
        source: null,
        text: this.messagePrefix(format),
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
        // A chat with no turn since Eva started shows what its next turn gets.
        pluginFolders: this.foldersBySession.get(session.id) ?? this.pluginFolders(),
        environment: this.options.environment,
      },
    });
  }

  /**
   * Eva's prompt, the person's rules, then the pinned files, the format settings, the widgets and the
   * vault structure line, so the person's rules stay next to Eva's.
   */
  private appendedPrompt(kept: KeptPrompt): string {
    let prompt = `${this.options.basePrompt}\n\n${kept.rules}`;
    for (const block of [kept.pinned.text, kept.format?.text ?? null, kept.widgets, kept.structureLine])
      if (block !== null) prompt = `${prompt.trimEnd()}\n\n${block}`;
    return prompt;
  }

  /** The walk runs in the core, also for the details of a chat that has not started, so it is bounded. */
  private pinnedBlockNow(): PinnedBlock {
    const vaultPath = this.options.vaultPath;
    // While the vault follows the old rule, a `> Important:` line still pins its note.
    const oldForm = readsOldImportant(vaultPath, migrationApplied(vaultMigrationRecordPath(vaultPath), pinFiles.id));
    const block = pinnedBlock({
      files: findPinnedFiles(vaultPath, { oldForm }),
      projects: this.options.projects(),
      today: formatLocalTime(this.options.now(), this.options.todayTimeZone ?? this.options.timeZone).slice(0, 10),
    });
    if (!block.complete)
      this.options.logger?.log("warn", "The walk for pinned files stopped before it saw the whole vault.", {});
    return block;
  }

  private formatBlockNow(): KeptFormat | null {
    const settings = this.options.formatSettings?.();
    return settings === undefined ? null : { settings, text: formatBlock(settings) };
  }

  private widgetsBlockNow(): string | null {
    return widgetsBlock(this.options.widgetLines?.() ?? []);
  }

  /**
   * Eva's own skills first, without each one that the vault replaces, then the vault's `.eva/` folder,
   * when it has a `skills/` folder. Both engines load the vault's folder with no manifest: a vault
   * from before the manifest still gets its skills. `describe` and the turn share this, so the
   * details list the skills that the turn gets.
   */
  private pluginFolders(): string[] {
    const pluginFolder = join(this.options.vaultPath, ".eva");
    const skillsFolder = join(pluginFolder, "skills");
    const vaultFolder = existsSync(skillsFolder) ? [pluginFolder] : [];
    try {
      return [this.options.evaCore.folderFor(skillNames(skillsFolder)), ...vaultFolder];
    } catch (error) {
      // A broken engines folder must not stop every chat: the turn runs without Eva's skills.
      this.options.logger?.log("warn", "Eva could not write her own skills.", { reason: String(error) });
      return vaultFolder;
    }
  }

  /**
   * The local time, and a note when `Life/About me.md` has a field that Eva must fix. The zone and
   * the clock are the chat's, as its format block says them.
   */
  private messagePrefix(format: KeptFormat | null): string {
    const zone = format?.settings.timeZone ?? this.options.timeZone;
    const time = `[Local time: ${formatLocalTime(this.options.now(), zone, format?.settings.clock ?? null)}, ${zone}]`;
    const note = aboutMeProblemNote(readAboutMe(this.options.vaultPath).problems);
    return note === null ? time : `${time}\n${note}`;
  }

  async afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null> {
    const snapshots = await this.vaultTurns.after(session, () => this.options.beforeEndSnapshot?.(session.id));
    const problems = snapshots === null ? [] : await this.widgetDataProblems(snapshots);
    const fixing = this.fixingData.delete(session.id);
    if (problems.length > 0) {
      // One fix by the agent first. A stopped turn gets no follow-up: the person wants the work to end.
      if (outcome.finished && !fixing) {
        this.fixingData.add(session.id);
        return widgetDataFixMessage(problems);
      }
      outcome.addNote(widgetDataNote(problems));
    }
    // A stopped or failed turn must end the work: a usage limit would fail each follow-up again.
    if (!outcome.finished) return null;
    return this.pskillFollowUp(session);
  }

  /** The problems of the widget data files that the turn changed. A missing snapshot skips the check. */
  private async widgetDataProblems(snapshots: TurnSnapshots): Promise<readonly string[]> {
    const check = this.options.checkWidgetData;
    if (check === undefined) return [];
    try {
      const paths = await this.options.vaultSync.changedFiles?.(snapshots.before, snapshots.after);
      return paths === undefined || paths === null || paths.length === 0 ? [] : check(paths);
    } catch (error) {
      this.options.logger?.log("warn", "Eva could not check the widget data of a turn.", { reason: String(error) });
      return [];
    }
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

/**
 * The names of the skills in a folder: the name of each subfolder with a `SKILL.md`, also through a
 * link, and the `name:` in its header. Claude Code and pi name a skill by its header.
 */
function skillNames(folder: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const text = readTextTolerant(join(folder, entry, "SKILL.md"));
    if (text === null) return [];
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    const name = /^name:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/m.exec(header)?.[1];
    return name === undefined || name === "" || name === entry ? [entry] : [entry, name];
  });
}

/** How Eva picks the pinned files, and what the caps or the walk left out. */
function pinnedNote(block: PinnedBlock): string {
  const notes = [
    "Eva pins the files with `pinned: full` or `pinned: summary`, the open and waiting cases, the open period, and the active and in-use projects, at the start of each chat. A change shows in the next chat.",
  ];
  if (block.notShown > 0)
    notes.push(
      `${String(block.notShown)} more ${block.notShown === 1 ? "file is" : "files are"} pinned than the limit lets in.`,
    );
  if (!block.complete) notes.push("The search stopped before it saw the whole vault, so a pinned file can be missing.");
  return notes.join(" ");
}

/** The follow-up to the agent: each file and field, so it can fix the file. */
function widgetDataFixMessage(problems: readonly string[]): string {
  return [
    "Eva checked the data files that your last answer changed. These files do not fit the format of a widget, so the widget cannot read them:",
    ...problems.map((problem) => `- ${problem}`),
    "Fix each file now. Read the DATA_FORMAT.md of its folder first, write every required field, and keep the fields that you do not know.",
  ].join("\n");
}

/** The note in the chat when the fix failed too, or the turn stopped. */
function widgetDataNote(problems: readonly string[]): string {
  return `A data file does not fit the format of its widget, so the widget may not show it. ${problems.join(" ")}`;
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

/** Such as `2026-10-14 12:30`, or `2026-10-14 12:30 PM` on a 12-hour clock, in the person's time zone. */
export function formatLocalTime(date: Date, timeZone: string, clock: Clock | null = null): string {
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
  const time = clockTime(Number(part("hour")), Number(part("minute")), clock);
  return `${part("year")}-${part("month")}-${part("day")} ${time}`;
}

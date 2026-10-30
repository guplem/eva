/**
 * Runs conversations: one turn at a time per session, with message gathering and queueing,
 * forks and retries, approvals, and exactly one end event per turn
 * (lessons 44, 47, 48, 49, 51, 114).
 */
import {
  takesEffort,
  type ApprovalAnswer,
  type CarryHistoryInput,
  type EffortLevel,
  type EngineName,
  type EnginePort,
  type McpServerSpec,
  type ModelAlias,
  type QuestionsOutcome,
  type SessionMode,
  type TurnHistory,
} from "../../shared/engine-port.ts";
import { contextGroups, type ContextPart, type EngineContextInput } from "../../shared/chat-context.ts";
import { EvaError } from "../../shared/errors.ts";
import {
  isTurnEnd,
  type ApprovalQuestion,
  type CoreEventPayload,
  type EngineEventPayload,
  type MessageOrigin,
  type QuestionAnswers,
  type SessionEvent,
  type TaskState,
} from "../../shared/events.ts";
import { SequenceCounter } from "../../shared/clock.ts";
import { answerFits } from "../../shared/questions.ts";
import type { Logger } from "../../shared/logger.ts";
import type { ProjectReport } from "../../shared/project-report.ts";
import { TextStreamRedactor, type Redactor } from "../../shared/redaction.ts";
import { boundedDetail, maxTurnDetailLength, redactedJsonText } from "../../shared/tool-details.ts";
import {
  addNote,
  addStep,
  stepDetails,
  storedSteps,
  withoutDetails,
  type StepDetail,
  type TurnStep,
} from "../../shared/turn-steps.ts";
import type { SessionRecord, SessionStore } from "./session-store.ts";
import type { StepDetailsStore } from "./step-details-store.ts";

export interface PreparedTurn {
  readonly startFolder: string;
  /** Project mode: the project folder. The engine hides each instruction file above it (#702). */
  readonly projectFolder: string | null;
  readonly appendSystemPrompt: string | null;
  /** Put before the person's message, such as the local time (lesson 40). */
  readonly messagePrefix: string | null;
  readonly pluginFolders: readonly string[];
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  readonly trusted: boolean;
  readonly environment: Readonly<Record<string, string>>;
}

export interface TurnOutcome {
  readonly finished: boolean;
}

/**
 * The answer to a question of a mode. `expired`: nobody answered in time, or the turn stopped.
 * A mode may remember only an answer of the person, never an expired question.
 */
export type PrepareAnswer = ApprovalAnswer | "expired";

/** What a preparer may do during its step: ask the person, as a tool approval does. */
export interface PrepareContext {
  readonly ask: (question: string, detail: string) => Promise<PrepareAnswer>;
}

/** The parts of a chat's context that a mode adds, and what the engine needs to list its own. */
export interface ModeContext {
  readonly parts: readonly ContextPart[];
  readonly engine: EngineContextInput;
}

/** What each mode does around a turn (Assistant: pull, prompt, save, skill runs; Project: trust). */
export interface TurnPreparer {
  prepare(session: SessionRecord, context: PrepareContext): Promise<PreparedTurn>;
  /**
   * The text that the engine gets for a turn's text, such as a chat in a clone, which gets copies
   * in place of vault paths (#706). Eva calls it after `prepare`, while the turn holds the folder.
   * The turn record keeps the text as sent, so a retry runs this again.
   */
  engineMessage?(session: SessionRecord, text: string): string;
  /** The context of the chat's next turn, for the chat details. It changes nothing and asks nobody. */
  describe?(session: SessionRecord): Promise<ModeContext>;
  /** Returns a message to send to the same session as its next turn, or null. */
  afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null>;
  /**
   * Keeps the files of the chat's folder under the id, and gives false when it cannot (issue 523).
   * Eva calls it while the turn holds the folder, before and after the engine runs.
   */
  snapshot?(session: SessionRecord, id: string): Promise<boolean>;
  /** Brings back the files of a snapshot. Eva calls it while the turn holds the folder. */
  restore?(session: SessionRecord, id: string): Promise<void>;
  /** Deletes the snapshots of a deleted chat. It runs in the background and never throws. */
  forget?(session: SessionRecord, ids: readonly string[]): void;
}

/** Where a branch's history goes on from: a message of an engine session. */
export interface HistoryPoint {
  readonly engineSessionId: string;
  readonly atMessageId: string;
}

/** What a retry does with the files of a Project chat's clone (issue 523). */
export type RetryFiles = "keep" | "undo";

export interface NewSessionInput {
  readonly mode: SessionMode;
  readonly engine: EngineName;
  /** Without one, the settings' model for new chats. */
  readonly model?: ModelAlias;
  /** Without one, the settings' effort for new chats. */
  readonly effort?: EffortLevel;
  readonly startFolder: string;
  readonly source: SessionRecord["source"];
  readonly projectId?: string;
  readonly clone?: string;
  readonly telegramTopicId?: number;
  /** A fixed title, such as a schedule's name. Without one, the first message names the chat. */
  readonly title?: string;
  /** The Assistant chat that this Project chat does a work for. */
  readonly reportsTo?: string;
}

/** What the person's settings choose for a new chat. */
export interface ChatDefaults {
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
}

/** A chat's first finished turn, for a name from a model. */
export interface FirstTurn {
  readonly engine: EngineName;
  readonly model: ModelAlias;
  /** Already redacted. */
  readonly userText: string;
  /** Already redacted. */
  readonly answerText: string;
}

export interface SessionManagerOptions {
  /**
   * Gives a chat a better name after its first turn, or null to keep the first line. The turn
   * never waits for it, and a title that the person gave wins over it.
   */
  readonly nameChat?: (turn: FirstTurn) => Promise<string | null>;
  readonly engines: readonly EnginePort[];
  /** The model and the effort of a new chat that names none, read at each new chat. Default: Smart, Medium. */
  readonly chatDefaults?: () => ChatDefaults;
  readonly store: SessionStore;
  /** Keeps the whole input and output of each tool step. Without it, Eva keeps none. */
  readonly stepDetails?: StepDetailsStore;
  readonly preparers: Readonly<Record<SessionMode, TurnPreparer>>;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly redactor: Redactor;
  /** How long a first message waits for more messages to join its turn (lesson 51). */
  readonly gatherMs: number;
  /** An approval nobody answers is denied after this time. */
  readonly approvalTimeoutMs: number;
  /** A turn that runs longer is stopped, so a hung engine never keeps a chat busy for good. */
  readonly turnTimeoutMs: number;
  /** Where an error of the work after a turn goes. The turn has its end event already. */
  readonly logger?: Logger;
}

/** An approval that waits for an answer. The summary is already redacted. */
export interface PendingApproval {
  readonly requestId: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly summary: string;
  /** The model's questions, also redacted. The person answers them, and allows or denies nothing. */
  readonly questions?: readonly ApprovalQuestion[];
}

/** How an approval ends: the person's answer, the answers to its questions, or no answer in time. */
type ApprovalOutcome = PrepareAnswer | { readonly answers: QuestionAnswers };

/** A background task of a running turn, in its last state. The description is already redacted. */
export interface BackgroundTask {
  readonly taskId: string;
  readonly sessionId: string;
  readonly description: string;
  readonly state: TaskState;
}

export interface TaskSnapshot {
  /**
   * The `seq` of the last event before the snapshot. The reply and the events travel apart, so
   * a front end keeps its own tasks of a chat with a newer event (lesson 83).
   */
  readonly seq: number;
  readonly tasks: readonly BackgroundTask[];
}

/** The steps of each running turn so far, so a page that missed the events shows the answer again. */
export interface TurnSnapshot {
  /** The `seq` of the last event in the steps. The page applies its newer events again (lesson 83). */
  readonly seq: number;
  /** The steps are already redacted. */
  readonly turns: readonly {
    readonly sessionId: string;
    readonly steps: readonly TurnStep[];
    /** The sent text of the block that the engine writes now, or "". An older Eva sends none. */
    readonly draft?: string;
  }[];
}

type EventListener = (event: SessionEvent) => void;

/** `stopped`: the person stopped a turn of this run. */
type IdleListener = (sessionId: string, state: { readonly stopped: boolean }) => void;

interface PendingBatch {
  readonly texts: string[];
  /** The messages that people and Eva sent, for the front ends. A follow-up of the mode is no message. */
  readonly messages: ({ readonly text: string; readonly origin: MessageOrigin } & MessageOptions)[];
  /** The result of this batch's own turn, kept in memory: the record can fail to save. */
  readonly outcome: TurnResult;
  readonly done: Promise<void>;
  readonly resolve: () => void;
}

/** What a message carries besides its text. */
export interface MessageOptions {
  /** The facts of a project work result. The batch keeps them redacted. */
  readonly projectReport?: ProjectReport;
  /** Eva sends the person's own words again, as a retry does, so the message stays the person's. */
  readonly fromPerson?: boolean;
  /** The stored sender of a turn that a retry sends again. A message alone in its turn keeps it. */
  readonly sender?: TurnSender;
}

/** Who sent the messages of a turn, for the record. */
export interface TurnSender {
  readonly fromEva: boolean;
  readonly projectReports: ProjectReport[];
  /** Already redacted. */
  readonly personText: string | null;
}

interface TurnResult {
  /** The failure reason of the turn, or null when it finished or has not run. */
  failure: string | null;
  /** The person stopped the turn. */
  stopped: boolean;
}

interface SessionRuntime {
  busy: boolean;
  /** From the start of a turn to its end event. The busy flag also covers the work after the turn, such as the vault sync. */
  turnRunning: boolean;
  /** Stops the running turn; null when no turn runs. */
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  pending: PendingBatch | null;
  /** True after a stop, until the session is free again. */
  stopped: boolean;
  /** Adds project work to the running turn as one of its tasks; null when no turn runs. */
  addProjectWork: ((work: ProjectWorkStarted) => void) | null;
}

type ProjectWorkStarted = Extract<CoreEventPayload, { kind: "project_work_started" }>;

const titleLength = 60;
/** What a turn did, for the activity chips and the step badges under its answer. */
interface TurnActivity {
  readonly toolCount: number;
  readonly commandCount: number;
  readonly taskCount: number;
  readonly steps: TurnStep[];
  readonly omittedSteps: number;
  /** The notices of the turn, apart from its answer. */
  readonly notes: string[];
}

const defaultTitle = "New chat";
const maxFollowUps = 20;

export class SessionManager {
  private readonly options: SessionManagerOptions;
  private readonly listeners = new Set<EventListener>();
  /** The listeners whose last call threw, so their error is logged once. */
  private readonly brokenListeners = new WeakSet<EventListener>();
  private readonly idleListeners = new Set<IdleListener>();
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly approvals = new Map<
    string,
    { readonly question: PendingApproval; readonly resolve: (outcome: ApprovalOutcome) => void }
  >();
  /**
   * The tasks of each running turn, by session id and task id. A task cannot outlive its turn.
   * The engine process ends with the turn. The stream drops each later event.
   */
  private readonly tasks = new Map<string, BackgroundTask>();
  /** The steps of each running turn, by session id. The record gets them only at the turn end. */
  private readonly turnSteps = new Map<string, readonly TurnStep[]>();
  private readonly turnDrafts = new Map<string, string>();
  private readonly sequence = new SequenceCounter();
  /** The last failure reason of each session, for the history. */
  private readonly lastFailure = new Map<string, string>();
  /** The last message or turn start of each chat, in ms. The record keeps only the turn ends. */
  private readonly lastActivity = new Map<string, number>();
  /** The running turn of each Project folder, so two chats never edit one clone at once (issue 356). */
  private readonly folderTurns = new Map<string, Promise<void>>();

  constructor(options: SessionManagerOptions) {
    this.options = options;
  }

  createSession(input: NewSessionInput): SessionRecord {
    const defaults = this.options.chatDefaults?.() ?? { model: "opus", effort: "medium" };
    const record: SessionRecord = {
      id: this.options.newId(),
      engineSessionId: this.options.newId(),
      engine: input.engine,
      mode: input.mode,
      modelAlias: input.model ?? defaults.model,
      effort: input.effort ?? defaults.effort,
      startFolder: input.startFolder,
      projectId: input.projectId ?? null,
      clone: input.clone ?? null,
      parentId: null,
      forkAtMessageId: null,
      forkFromEngineSessionId: null,
      title: input.title ?? defaultTitle,
      createdAt: this.options.now().toISOString(),
      lastTurnAt: null,
      source: input.source,
      telegramTopicId: input.telegramTopicId ?? null,
      historyLost: false,
      turns: [],
      seenTurns: 0,
      archived: false,
      closed: false,
      continuedFrom: null,
      firstMessageDraft: null,
      pendingRestore: null,
      forkedFrom: null,
      reportsTo: input.reportsTo ?? null,
      forkName: null,
    };
    this.options.store.save(record);
    return record;
  }

  get(sessionId: string): SessionRecord {
    const record = this.options.store.get(sessionId);
    if (record === undefined) throw new EvaError("session_not_found", `No session ${sessionId}.`);
    return record;
  }

  list(): SessionRecord[] {
    return this.options.store.list();
  }

  /**
   * Chooses the model of a chat's next turns. The engine session continues, so a change keeps the
   * history, but the next turn reads it again without the cache (lesson 41). A running turn keeps
   * the model it started with.
   */
  setModel(sessionId: string, model: ModelAlias): SessionRecord {
    const session = this.get(sessionId);
    this.assertOpen(session);
    if (this.isBusy(sessionId)) {
      throw new EvaError("session_busy", "The model of a chat cannot change while a turn runs.");
    }
    const updated = { ...session, modelAlias: model };
    this.options.store.save(updated);
    return updated;
  }

  /**
   * Chooses how much the model of a chat reasons. It changes no history and costs no cache, so it
   * can change at any time. A running turn keeps the effort it started with.
   */
  setEffort(sessionId: string, effort: EffortLevel): SessionRecord {
    const updated = { ...this.get(sessionId), effort };
    this.options.store.save(updated);
    return updated;
  }

  /** Chooses the engine of a chat before its first turn, as the composer's chip does. */
  setEngine(sessionId: string, engine: EngineName): SessionRecord {
    const session = this.get(sessionId);
    // The fork's first turn continues its parent's engine session, which only that engine knows.
    // A chat from another clone with no engine history, as after a summary, may still choose.
    if (session.parentId !== null || session.forkFromEngineSessionId !== null)
      throw new EvaError("session_busy", "A fork keeps the engine of its chat.");
    if (session.turns.length > 0 || this.isBusy(sessionId)) {
      throw new EvaError("session_busy", "The engine of a chat is chosen before its first message.");
    }
    if (!this.options.engines.some((candidate) => candidate.name === engine)) {
      throw new EvaError("engine_failed", `The engine ${engine} is not available.`);
    }
    const updated = { ...session, engine };
    this.options.store.save(updated);
    return updated;
  }

  /**
   * Gives a chat the person's title. A running turn keeps it, because its end reads the record
   * again. A first message names only a chat that still has the default title. A chat renamed to
   * exactly the default title also takes its first message as its title.
   */
  rename(sessionId: string, title: string): SessionRecord {
    return this.retitle(this.get(sessionId), title, false);
  }

  /**
   * Gives a branch the person's name (issue 637). It is apart from the title, which a fork copies
   * from its chat, so a rename of the chat leaves the branch name. The first branch takes one too (issue 647).
   */
  nameFork(sessionId: string, name: string): SessionRecord {
    const session = this.get(sessionId);
    const cleaned = cutTitle(this.options.redactor.redact(name).replace(/\s+/g, " ").trim());
    if (cleaned.length === 0) throw new EvaError("title_invalid", "A fork name needs at least one character.");
    const updated = { ...session, forkName: cleaned };
    this.options.store.save(updated);
    this.emit(sessionId, { kind: "fork_named", name: cleaned });
    return updated;
  }

  /**
   * Records that the person saw the first `turnCount` turns of a chat. A page that loaded before
   * an answer sends an old count, so the count never goes back. It never goes past the stored
   * turns either, so a turn that ends later stays unseen.
   */
  markSeen(sessionId: string, turnCount: number): SessionRecord {
    const session = this.get(sessionId);
    const seenTurns = Math.max(session.seenTurns, Math.min(turnCount, session.turns.length));
    if (seenTurns === session.seenTurns) return session;
    const updated = { ...session, seenTurns };
    this.options.store.save(updated);
    // Every device shows the chat as seen, not only the one where the person opened it.
    this.emit(sessionId, { kind: "session_seen", seenTurns });
    return updated;
  }

  /** Moves a chat to the archive, or brings it back. The web app archives the root chat, and its forks follow it. */
  setArchived(sessionId: string, archived: boolean): SessionRecord {
    const session = this.get(sessionId);
    if (session.archived === archived) return session;
    const updated = { ...session, archived };
    this.options.store.save(updated);
    this.emit(sessionId, { kind: "session_archived", archived });
    return updated;
  }

  /**
   * Makes a new, empty chat go on from an old one (issue 522). The summary becomes the draft of its
   * first message: a model wrote it from text of other people, so the person reads it before it goes.
   */
  continueFrom(sessionId: string, fromSessionId: string, summary: string | null): SessionRecord {
    const session = this.get(sessionId);
    const from = this.get(fromSessionId);
    if (session.turns.length > 0 || this.isActive(sessionId))
      throw new EvaError("session_busy", "Only a new chat can continue another chat.");
    const draft = summary === null ? null : this.options.redactor.redact(summary).trim();
    const updated: SessionRecord = {
      ...session,
      continuedFrom: from.id,
      firstMessageDraft: draft === null || draft.length === 0 ? null : draft,
      title: cutTitle(`${from.title} (continued)`),
    };
    this.options.store.save(updated);
    return updated;
  }

  private retitle(session: SessionRecord, title: string, automatic: boolean): SessionRecord {
    const cleaned = cutTitle(this.options.redactor.redact(title).replace(/\s+/g, " ").trim());
    if (cleaned.length === 0) throw new EvaError("title_invalid", "A chat title needs at least one character.");
    const updated = { ...session, title: cleaned };
    this.options.store.save(updated);
    this.emit(session.id, { kind: "session_renamed", title: cleaned, ...(automatic ? { automatic: true } : {}) });
    return updated;
  }

  /** Asks for a name in the background. A failed or empty answer keeps the first-line title. */
  private nameInBackground(sessionId: string, firstLineTitle: string, turn: FirstTurn): void {
    const nameChat = this.options.nameChat;
    if (nameChat === undefined) return;
    void nameChat(turn)
      .then((name) => {
        const current = this.options.store.get(sessionId);
        // Any other title came from the person, or the chat is gone.
        if (name === null || current?.title !== firstLineTitle) return;
        this.retitle(current, name, true);
      })
      .catch(() => undefined);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Calls the listener each time a session is free again: its turn, the queued turns and the
   * follow-ups of the mode have ended. A turn end alone does not say that Eva is done.
   */
  onIdle(listener: IdleListener): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  isBusy(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.busy ?? false;
  }

  /** A front end reads the list again on a turn end event, so this is already false when that event goes out. */
  isTurnRunning(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.turnRunning ?? false;
  }

  /** Busy, or holding a gathered message whose turn has not started yet. */
  isActive(sessionId: string): boolean {
    const runtime = this.runtimes.get(sessionId);
    return runtime !== undefined && (runtime.busy || runtime.pending !== null);
  }

  /** True when the chat was created, got a message, or started or ended a turn in the last `ms`. */
  hadActivityWithin(sessionId: string, ms: number): boolean {
    const record = this.options.store.get(sessionId);
    if (record === undefined) return false;
    const times = [Date.parse(record.createdAt), this.lastActivity.get(sessionId) ?? Number.NaN];
    if (record.lastTurnAt !== null) times.push(Date.parse(record.lastTurnAt));
    const last = Math.max(...times.filter((time) => !Number.isNaN(time)));
    return this.options.now().getTime() - last < ms;
  }

  /** Stops the running turn of a chat. False when no turn runs. */
  stop(sessionId: string): boolean {
    const controller = this.runtimes.get(sessionId)?.controller ?? null;
    if (controller === null) return false;
    const runtime = this.runtimes.get(sessionId);
    if (runtime !== undefined) runtime.stopped = true;
    controller.abort();
    return true;
  }

  /** Sends a message. It resolves when the session is free again: its turn, queued turns and follow-ups have ended. */
  send(sessionId: string, text: string, origin: MessageOrigin = "eva", options: MessageOptions = {}): Promise<void> {
    return this.enqueue(sessionId, text, origin, options).done;
  }

  /** Sends the message of a stored turn again, as a retry does, with the sender that the turn had. */
  sendAgain(sessionId: string, turn: SessionRecord["turns"][number]): Promise<void> {
    const { fromEva, projectReports, personText } = turn;
    // The live event names one result, so a front end shows its summary instead of the raw text.
    const report = fromEva ? projectReports[0] : undefined;
    return this.send(sessionId, turn.userText, "eva", {
      sender: { fromEva, projectReports, personText },
      ...(report === undefined ? {} : { projectReport: report }),
      ...(fromEva ? {} : { fromPerson: true }),
    });
  }

  /**
   * Sends a message, as `send` does. It resolves to the failure reason of the turn that carried
   * the message, or null. A send never rejects, and a later turn of the chat must not count.
   * A stop of the person is null too: the person chose it, so it is no failure.
   */
  async sendWithResult(sessionId: string, text: string, origin: MessageOrigin): Promise<string | null> {
    const batch = this.enqueue(sessionId, text, origin);
    await batch.done;
    return batch.outcome.stopped ? null : batch.outcome.failure;
  }

  private enqueue(sessionId: string, text: string, origin: MessageOrigin, options: MessageOptions = {}): PendingBatch {
    this.assertOpen(this.get(sessionId));
    // A new answer must not hide in the archive.
    this.setArchived(this.rootOf(this.get(sessionId)).id, false);
    const runtime = this.runtimeOf(sessionId);
    const batch = runtime.pending ?? createBatch();
    runtime.pending = batch;
    batch.texts.push(text);
    const { projectReport } = options;
    batch.messages.push({
      text,
      origin,
      ...(options.fromPerson === true ? { fromPerson: true } : {}),
      ...(options.sender === undefined ? {} : { sender: options.sender }),
      ...(projectReport === undefined ? {} : { projectReport: redactReport(projectReport, this.options.redactor) }),
    });
    this.lastActivity.set(sessionId, this.options.now().getTime());
    if (!runtime.busy) this.startGathering(sessionId, runtime);
    return batch;
  }

  /** Who sent the messages of a batch. A follow-up of the mode has no message, so Eva sent all of it. */
  private senderOf(batch: PendingBatch): TurnSender {
    const [only] = batch.messages;
    if (only?.sender !== undefined && batch.messages.length === 1 && batch.texts.length === 1) return only.sender;
    const fromEva = (message: PendingBatch["messages"][number]): boolean =>
      message.origin === "eva" && message.fromPerson !== true;
    const personTexts = batch.messages.filter((message) => !fromEva(message)).map((message) => message.text);
    // A follow-up of the mode is a text with no message, and Eva wrote it.
    const evaParts = batch.texts.length - personTexts.length;
    const mixed = evaParts > 0 && personTexts.length > 0;
    return {
      fromEva: personTexts.length === 0,
      projectReports: batch.messages.flatMap((message) => message.projectReport ?? []),
      personText: mixed ? this.options.redactor.redact(personTexts.join("\n\n")) : null,
    };
  }

  /** Waits a moment for more messages, then runs the turn (lesson 51). */
  private startGathering(sessionId: string, runtime: SessionRuntime): void {
    if (runtime.timer !== null) return;
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      void this.drain(sessionId);
    }, this.options.gatherMs);
  }

  private logAfterTurnError(sessionId: string, error: unknown): void {
    this.options.logger?.log("error", "The work after a turn failed.", {
      sessionId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Deletes a chat and every fork of it, and returns their ids. A fork left behind would point
   * at a parent that is gone. The engine keeps its own transcript. The snapshots of their turns go
   * too, unless the caller deletes the whole folder: git must not run in a folder that goes.
   */
  delete(sessionId: string, options: { readonly forgetSnapshots?: boolean } = {}): string[] {
    const ids = this.treeOf(sessionId);
    // A queued message would run on a deleted record, so a gathered one refuses the delete too.
    if (ids.some((id) => this.isActive(id)))
      throw new EvaError("session_busy", "Eva is still working in this chat. Try again when she finishes.");
    for (const id of options.forgetSnapshots === false ? [] : ids) this.forgetSnapshots(this.get(id));
    const moved = new Map(ids.map((id) => [id, this.get(id).turns]));
    for (const id of ids) this.dropRecord(id);
    // Only after the whole tree is gone: a front end that reloads the list must not find a fork.
    for (const id of ids) this.emit(id, { kind: "session_deleted", ...this.snapshotsOf(id, moved.get(id) ?? []) });
    return ids;
  }

  /**
   * Deletes one branch of a chat, and keeps its forks (issue 647). The oldest fork that shares its
   * history takes its place, with the turns that it shared. A later fork takes the turns that only it
   * shared, and forks from the heir. A branch with no fork goes as a whole chat.
   */
  deleteBranch(sessionId: string): { deleted: string[]; heirId: string | null } {
    const branch = this.get(sessionId);
    // A stable sort: forks made in the same millisecond keep the order of the list.
    const forks = this.list()
      .filter((session) => session.parentId === branch.id)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    const [oldest] = forks;
    if (oldest === undefined) return { deleted: this.delete(sessionId), heirId: null };
    // A running turn would end on a record whose turns moved.
    if ([branch, ...forks].some((session) => this.isActive(session.id)))
      throw new EvaError("session_busy", "Eva is still working in this chat. Try again when she finishes.");
    const heir = forks.find((fork) => fork.forkAtMessageId !== null) ?? oldest;
    // The heir shares the turns up to this index; -1 when it shares none.
    const shared = heir.forkAtMessageId === null ? -1 : sharedEnd(branch, heir.forkAtMessageId);
    const isRoot = branch.parentId === null;
    const updates: SessionRecord[] = [
      {
        ...movedTo(heir, branch, 0, shared),
        ...(isRoot ? chatFields(branch, heir) : {}),
        parentId: branch.parentId,
        forkAtMessageId: shared === -1 ? null : branch.forkAtMessageId,
        createdAt: branch.createdAt,
      },
    ];
    // The branches that took turns, each with the last turn that it shares, in the order of the history.
    // A later fork forks from the one before it, so no two branches hold the same moved turn.
    const receivers = [{ id: heir.id, end: shared }];
    const later = forks
      .filter((fork) => fork !== heir)
      .map((fork) => ({ fork, end: fork.forkAtMessageId === null ? -1 : sharedEnd(branch, fork.forkAtMessageId) }))
      .sort((first, second) => first.end - second.end);
    for (const { fork, end } of later) {
      if (end <= shared) {
        updates.push({ ...fork, parentId: heir.id });
        continue;
      }
      const parent = receivers.at(-1) ?? { id: heir.id, end: shared };
      // A fork at the same answer as the one before it takes no turn, so it holds no fork point of a later fork.
      if (end === parent.end) {
        updates.push({ ...fork, parentId: parent.id });
        continue;
      }
      receivers.push({ id: fork.id, end });
      updates.push({
        ...movedTo(fork, branch, parent.end + 1, end),
        parentId: parent.id,
        forkAtMessageId: branch.turns[parent.end]?.lastMessageId ?? heir.forkAtMessageId,
      });
    }
    const kept = Math.max(...receivers.map((receiver) => receiver.end));
    for (const update of updates) this.options.store.save(update);
    // Other chats that name the branch, such as a Project chat that reports to it, now name the heir.
    for (const session of this.list()) {
      const moved = {
        ...session,
        reportsTo: session.reportsTo === branch.id ? heir.id : session.reportsTo,
        continuedFrom: session.continuedFrom === branch.id ? heir.id : session.continuedFrom,
        forkedFrom:
          session.forkedFrom?.sessionId === branch.id
            ? { ...session.forkedFrom, sessionId: heir.id }
            : session.forkedFrom,
      };
      if (
        moved.reportsTo !== session.reportsTo ||
        moved.continuedFrom !== session.continuedFrom ||
        moved.forkedFrom !== session.forkedFrom
      )
        this.options.store.save(moved);
    }
    for (const { id, end } of receivers) if (end >= 0) this.options.stepDetails?.copy(branch.id, id);
    this.forgetSnapshots({ ...branch, turns: branch.turns.slice(kept + 1) }, this.pendingRestores());
    this.dropRecord(branch.id);
    this.emit(branch.id, {
      kind: "session_deleted",
      heirId: heir.id,
      ...this.snapshotsOf(branch.id, branch.turns.slice(kept + 1)),
    });
    return { deleted: [branch.id], heirId: heir.id };
  }

  /**
   * The gone branches where some of these dropped turns ran (issue 647), so the vault can delete the
   * snapshots that no turn names any more. Empty when every turn ran in a branch that stays.
   */
  private snapshotsOf(ownId: string, dropped: SessionRecord["turns"]): { snapshotsOf?: string[] } {
    const gone = new Set(
      dropped.flatMap((turn) =>
        turn.ranIn === undefined ||
        turn.ranIn.sessionId === ownId ||
        this.options.store.get(turn.ranIn.sessionId) !== undefined
          ? []
          : [turn.ranIn.sessionId],
      ),
    );
    return gone.size === 0 ? {} : { snapshotsOf: [...gone] };
  }

  /** The snapshots that a branch still waits to bring back. */
  private pendingRestores(): Set<string> {
    return new Set(this.list().flatMap((session) => (session.pendingRestore === null ? [] : [session.pendingRestore])));
  }

  private dropRecord(id: string): void {
    this.options.store.delete(id);
    this.options.stepDetails?.delete(id);
    this.runtimes.delete(id);
    this.lastFailure.delete(id);
    this.lastActivity.delete(id);
  }

  /**
   * Every turn that a branch's engine session holds, oldest first: the parent's turns up to the
   * fork point, then the branch's own. A retry from the start keeps none of its parent's turns.
   */
  branchTurns(sessionId: string): SessionRecord["turns"] {
    const chain: SessionRecord[] = [];
    // The bound stops a loop of parents, which only a damaged file can hold.
    for (let session: SessionRecord | undefined = this.get(sessionId); session !== undefined && chain.length < 1000;) {
      chain.unshift(session);
      session = session.parentId === null ? undefined : this.options.store.get(session.parentId);
    }
    const turns: SessionRecord["turns"][number][] = [];
    for (const [index, session] of chain.entries()) {
      const forkAt = chain[index + 1]?.forkAtMessageId;
      if (forkAt === undefined) turns.push(...session.turns);
      else if (forkAt === null) turns.length = 0;
      else {
        const end = session.turns.findIndex((turn) => turn.lastMessageId === forkAt);
        turns.push(...session.turns.slice(0, end + 1));
      }
    }
    return turns;
  }

  /**
   * Closes a chat and every fork of it, and returns their ids. Eva closes a chat when she reuses its
   * clone (issue 521): a later message would run on another task. The history stays.
   */
  close(sessionId: string): string[] {
    const ids = this.treeOf(sessionId);
    if (ids.some((id) => this.isActive(id)))
      throw new EvaError("session_busy", "Eva is still working in this chat. Try again when she finishes.");
    const closed = ids.filter((id) => !this.get(id).closed);
    for (const id of closed) this.options.store.save({ ...this.get(id), closed: true });
    for (const id of closed) this.emit(id, { kind: "session_closed" });
    return ids;
  }

  private assertOpen(session: SessionRecord): void {
    if (session.closed)
      throw new EvaError("session_closed", "This chat is closed, because Eva reused its clone. Start a new chat.");
  }

  /** A chat and every fork of it, through every level. */
  private treeOf(sessionId: string): string[] {
    this.get(sessionId);
    const ids = [sessionId];
    // The loop also visits the ids that it adds, so it walks the whole tree.
    for (const parentId of ids) {
      for (const session of this.list()) if (session.parentId === parentId) ids.push(session.id);
    }
    return ids;
  }

  /** The chat that a fork branches from, through every level. A missing parent ends the walk. */
  private rootOf(session: SessionRecord): SessionRecord {
    let root = session;
    // The bound stops a loop of parents, which only a damaged file can hold.
    for (let depth = 0; root.parentId !== null && depth < 1000; depth += 1) {
      const parent = this.options.store.get(root.parentId);
      if (parent === undefined) break;
      root = parent;
    }
    return root;
  }

  /** Tells the front ends that a chat gave work to a project, and which Project chat runs it. */
  announceProjectWork(sessionId: string, work: { projectId: string; projectSessionId: string; request: string }): void {
    // The turn keeps the request, so it gets the redaction that `emit` gives the event.
    const payload: ProjectWorkStarted = {
      kind: "project_work_started",
      ...work,
      request: this.options.redactor.redact(work.request),
    };
    // `eva work` runs in the shell of a turn, so the work is a task of the answer that started it.
    this.runtimes.get(sessionId)?.addProjectWork?.(payload);
    this.emit(sessionId, payload);
  }

  /** A new branch of a conversation, up to and including one message. Its first message starts it. */
  fork(sessionId: string, atMessageId: string): SessionRecord {
    const parent = this.get(sessionId);
    this.assertOpen(parent);
    const record: SessionRecord = {
      ...this.createSession({
        mode: parent.mode,
        engine: parent.engine,
        model: parent.modelAlias,
        effort: parent.effort,
        startFolder: parent.startFolder,
        source: parent.source,
        ...(parent.projectId === null ? {} : { projectId: parent.projectId }),
        ...(parent.clone === null ? {} : { clone: parent.clone }),
      }),
      parentId: parent.id,
      forkAtMessageId: atMessageId,
      forkFromEngineSessionId: pointAt(parent, atMessageId).engineSessionId,
      title: parent.title,
    };
    this.options.store.save(record);
    return record;
  }

  /**
   * Runs a turn again on a new branch; the old answer stays in its own branch. It returns the
   * branch at once: a long turn must not hold the request past the idle time-out of the server.
   */
  retry(sessionId: string, turnIndex: number, files: RetryFiles = "keep"): Promise<SessionRecord> {
    // A refusal still comes as a rejection, as the caller awaits it.
    return Promise.resolve().then(() => {
      const session = this.get(sessionId);
      this.assertOpen(session);
      const turn = this.turnOf(session, turnIndex);
      // Only a Project chat has a clone whose files a snapshot keeps.
      const restore = files === "undo" && session.mode === "project" ? this.startSnapshotOf(session, turnIndex) : null;
      const created = this.retryBranch(session, turnIndex);
      const branch = restore === null ? created : { ...created, pendingRestore: restore };
      if (branch !== created) this.options.store.save(branch);
      // The send never rejects: a failure of the turn is its turn_failed event.
      void this.sendAgain(branch.id, turn);
      return this.get(branch.id);
    });
  }

  private turnOf(session: SessionRecord, turnIndex: number): SessionRecord["turns"][number] {
    const turn = session.turns[turnIndex];
    if (turn === undefined)
      throw new EvaError("session_not_found", `Session ${session.id} has no turn ${String(turnIndex)}.`);
    return turn;
  }

  /** The snapshot of the files before a turn, for a retry that undoes it. */
  startSnapshotOf(session: SessionRecord, turnIndex: number): string {
    const snapshot = this.turnOf(session, turnIndex).startSnapshot;
    if (snapshot === null)
      throw new EvaError("snapshot_missing", "Eva kept no snapshot of the files before this answer.");
    return snapshot;
  }

  /** The snapshot of the files after the answer with this message, for a fork at it. */
  endSnapshotAt(sessionId: string, atMessageId: string): string {
    const turn = this.get(sessionId).turns.find((candidate) => candidate.lastMessageId === atMessageId);
    if (turn?.endSnapshot === null || turn?.endSnapshot === undefined)
      throw new EvaError("snapshot_missing", "Eva kept no snapshot of the files at this answer.");
    return turn.endSnapshot;
  }

  /**
   * Where a retry of a turn goes on from: the newest answer before it in the branch, or the point
   * that the branch itself started from. Null: the retry starts with no history.
   */
  retryPoint(sessionId: string, turnIndex: number): HistoryPoint | null {
    const session = this.get(sessionId);
    this.turnOf(session, turnIndex);
    const earlier = session.turns.slice(0, turnIndex).findLast((turn) => turn.lastMessageId !== null)?.lastMessageId;
    if (earlier !== undefined && earlier !== null) return pointAt(session, earlier);
    const parent = session.parentId === null ? undefined : this.options.store.get(session.parentId);
    if (parent !== undefined && session.forkAtMessageId !== null) return pointAt(parent, session.forkAtMessageId);
    return this.movedPoint(session);
  }

  /** The history point at an answer of a branch, in the engine session that holds it (issue 647). */
  historyPointAt(sessionId: string, atMessageId: string): HistoryPoint {
    return pointAt(this.get(sessionId), atMessageId);
  }

  /** The history point of a chat that came from another clone, or of a branch of it that starts at the start. */
  private movedPoint(session: SessionRecord): HistoryPoint | null {
    const from = session.forkedFrom;
    if (from?.engineSessionId === undefined || from.engineSessionId === null || from.atMessageId === null) return null;
    return { engineSessionId: from.engineSessionId, atMessageId: from.atMessageId };
  }

  /**
   * A new chat in another clone that goes on from a point of a chat (issue 523). It is the root of
   * the chat tree of its clone, so closing or deleting the chat it came from leaves it.
   */
  createMovedBranch(
    fromSessionId: string,
    point: HistoryPoint | null,
    place: { readonly startFolder: string; readonly clone: string },
  ): SessionRecord {
    const from = this.get(fromSessionId);
    this.assertOpen(from);
    const record: SessionRecord = {
      ...this.createSession({
        mode: from.mode,
        engine: from.engine,
        model: from.modelAlias,
        effort: from.effort,
        startFolder: place.startFolder,
        source: from.source,
        ...(from.projectId === null ? {} : { projectId: from.projectId }),
        clone: place.clone,
      }),
      forkFromEngineSessionId: point?.engineSessionId ?? null,
      title: from.title,
      forkedFrom: {
        sessionId: from.id,
        clone: from.clone,
        engineSessionId: point?.engineSessionId ?? null,
        atMessageId: point?.atMessageId ?? null,
      },
    };
    this.options.store.save(record);
    return record;
  }

  /**
   * Each part of the chat's context that the agent reads before the conversation, for the chat
   * details: the engine's parts and the mode's parts, grouped. Each group keeps the engine's parts first.
   */
  async context(sessionId: string): Promise<ContextPart[]> {
    const session = this.get(sessionId);
    const mode = await this.options.preparers[session.mode].describe?.(session);
    if (mode === undefined) return [];
    const engine = this.options.engines.find((candidate) => candidate.name === session.engine);
    // A file outside the vault, such as the engine's own CLAUDE.md, can hold a token, as any text that leaves the core.
    const parts = [...(engine?.describeContext?.(mode.engine) ?? []), ...mode.parts].map((part) =>
      part.text === null ? part : { ...part, text: boundedDetail(this.options.redactor.redact(part.text)) },
    );
    return contextGroups.flatMap((group) => parts.filter((part) => part.group === group));
  }

  /**
   * Makes the history of an engine session readable from another folder, before a chat there goes on
   * from it. False when the engine could not. An engine without the step needs none.
   */
  carryHistory(engineName: EngineName, input: CarryHistoryInput): boolean {
    const engine = this.options.engines.find((candidate) => candidate.name === engineName);
    if (engine === undefined) return false;
    if (engine.carryHistory === undefined) return true;
    try {
      return engine.carryHistory(input);
    } catch {
      return false;
    }
  }

  /**
   * The first answer wins. An approval with questions takes "deny" as a skip, and "allow" only with
   * one fitting answer for each question: a plain "allow" would give the model no answers (issue #544).
   */
  answerApproval(requestId: string, answer: ApprovalAnswer, answers?: QuestionAnswers): void {
    const pending = this.approvals.get(requestId);
    if (pending === undefined) return;
    const questions = pending.question.questions;
    if (questions === undefined) {
      if (answers !== undefined) throw new EvaError("approval_invalid", "This approval has no questions to answer.");
      this.resolveApproval(requestId, answer);
      return;
    }
    if (answer === "deny") {
      this.resolveApproval(requestId, "deny");
      return;
    }
    if (answers === undefined || !answersFit(questions, answers)) {
      throw new EvaError("approval_invalid", "Answer each question with one of its options or your own text.");
    }
    this.resolveApproval(requestId, { answers });
  }

  /** Front ends see an expired question as denied; only the asker learns that it expired. */
  private resolveApproval(requestId: string, outcome: ApprovalOutcome): void {
    const pending = this.approvals.get(requestId);
    if (pending === undefined) return;
    this.approvals.delete(requestId);
    pending.resolve(outcome);
    const answered = typeof outcome === "object";
    this.emit(pending.question.sessionId, {
      kind: "approval_resolved",
      requestId,
      answer: answered ? "allow" : outcome === "expired" ? "deny" : outcome,
      // Nobody answered: the time ran out, or the turn stopped.
      timedOut: outcome === "expired",
      ...(answered ? { answers: outcome.answers } : {}),
    });
  }

  /** The approvals that wait for an answer, so a front end that missed the event still shows them. */
  pendingApprovals(): PendingApproval[] {
    return [...this.approvals.values()].map((pending) => pending.question);
  }

  /** The tasks of the running turns, so a front end that missed the events still shows them. */
  backgroundTasks(): TaskSnapshot {
    return { seq: this.sequence.current(), tasks: [...this.tasks.values()] };
  }

  /** The steps of the running turns, so a front end that missed the events still shows the answer. */
  runningTurns(): TurnSnapshot {
    const turns = [...this.turnSteps].map(([sessionId, steps]) => ({
      sessionId,
      steps,
      draft: this.turnDrafts.get(sessionId) ?? "",
    }));
    return { seq: this.sequence.current(), turns };
  }

  private forgetRunningTurn(sessionId: string): void {
    for (const [key, task] of this.tasks) if (task.sessionId === sessionId) this.tasks.delete(key);
    this.turnSteps.delete(sessionId);
    this.turnDrafts.delete(sessionId);
  }

  private expireApprovals(sessionId: string): void {
    for (const [requestId, pending] of this.approvals) {
      if (pending.question.sessionId === sessionId) this.resolveApproval(requestId, "expired");
    }
  }

  /**
   * The branch for a retry, with all the history before the turn. A failed turn has no message
   * to branch at, so the branch starts at the newest answer before it. A fork's history before
   * its own turns is in its parent.
   */
  private retryBranch(session: SessionRecord, turnIndex: number): SessionRecord {
    const earlier = session.turns.slice(0, turnIndex).findLast((turn) => turn.lastMessageId !== null);
    const atMessageId = earlier?.lastMessageId ?? null;
    if (atMessageId !== null) return this.fork(session.id, atMessageId);
    const parent = session.parentId === null ? undefined : this.options.store.get(session.parentId);
    if (parent !== undefined && session.forkAtMessageId !== null) return this.fork(parent.id, session.forkAtMessageId);
    return this.retryFromStart(session);
  }

  /** A chat that came from another clone keeps its history point, so its branch from the start keeps it too. */
  private retryFromStart(session: SessionRecord): SessionRecord {
    const moved = this.movedPoint(session);
    const record: SessionRecord = {
      ...this.createSession({
        mode: session.mode,
        engine: session.engine,
        model: session.modelAlias,
        effort: session.effort,
        startFolder: session.startFolder,
        source: session.source,
      }),
      projectId: session.projectId,
      clone: session.clone,
      parentId: session.id,
      title: session.title,
      ...(moved === null ? {} : { forkFromEngineSessionId: moved.engineSessionId, forkedFrom: session.forkedFrom }),
    };
    this.options.store.save(record);
    return record;
  }

  private async drain(sessionId: string): Promise<void> {
    const runtime = this.runtimeOf(sessionId);
    if (runtime.busy) return;
    const handled: PendingBatch[] = [];
    let followUps = 0;
    // The busy flag is set with no await before it, so a second drain can never start (lesson 49).
    runtime.busy = true;
    try {
      while (runtime.pending !== null) {
        const batch = runtime.pending;
        runtime.pending = null;
        handled.push(batch);
        // A new message after a stop is new work, so the stop no longer counts. A follow-up of the mode has no message.
        if (batch.messages.length > 0) runtime.stopped = false;
        // When the turn starts, not at the send: a message sent during a turn joins the next one
        // (lesson 114), so a front end shows each message just before its own answer.
        for (const { text, origin, projectReport } of batch.messages)
          this.emit(sessionId, {
            kind: "message_received",
            text,
            origin,
            ...(projectReport === undefined ? {} : { projectReport }),
          });
        let followUp: string | null = null;
        try {
          const sender = this.senderOf(batch);
          followUp = await this.runTurn(sessionId, batch.texts.join("\n\n"), sender, batch.outcome);
          // Telegram showed the answer where the person asked, so the web app must not show it as unread.
          // A follow-up of the mode has no message, so its answer stays unread.
          const fromTelegram =
            batch.messages.length > 0 && batch.messages.every((message) => message.origin === "telegram");
          const recorded = this.options.store.get(sessionId);
          if (fromTelegram && recorded !== undefined) this.markSeen(sessionId, recorded.turns.length);
        } catch (error) {
          // The turn sent its end event already. Only the work after it failed, such as a save, so
          // the messages that wait still get their turn.
          this.logAfterTurnError(sessionId, error);
        }
        // After a stop, the person wants Eva to end the work, not to go on with the mode's next step.
        if (followUp !== null && !runtime.stopped && followUps < maxFollowUps) {
          followUps += 1;
          runtime.pending ??= createBatch();
          runtime.pending.texts.unshift(followUp);
        }
      }
    } catch (error) {
      // Nobody awaits the drain, so a rejection would go nowhere.
      this.logAfterTurnError(sessionId, error);
    } finally {
      runtime.busy = false;
      // A batch that came while the chat was busy set no timer. Without one, it waits for good,
      // and the chat stays active, which blocks a delete and a restart for an update.
      if (runtime.pending !== null) this.startGathering(sessionId, runtime);
      const stopped = runtime.stopped;
      runtime.stopped = false;
      for (const listener of this.idleListeners) {
        // A listener's failure must never keep the senders waiting.
        try {
          listener(sessionId, { stopped });
        } catch {
          // The listener logs its own problems.
        }
      }
      for (const batch of handled) batch.resolve();
    }
  }

  /** Runs one turn, writes its failure into `result`, and returns the follow-up message of the mode, if any. */
  private async runTurn(
    sessionId: string,
    prompt: string,
    sender: TurnSender,
    result: TurnResult,
  ): Promise<string | null> {
    // The record is read once at the start, so a change made during the turn cannot move it (lesson 48).
    const session = this.get(sessionId);
    const engine = this.options.engines.find((candidate) => candidate.name === session.engine);
    const preparer = this.options.preparers[session.mode];
    const turn = { ended: false };
    let finished: Extract<EngineEventPayload, { kind: "turn_finished" }> | null = null;
    let lastText: string | null = null;
    const answerParts: string[] = [];
    const activity = { toolCount: 0, commandCount: 0, taskCount: 0 };
    // A task sends several events as its state changes, so each task counts once.
    const taskIds = new Set<string>();
    let steps: readonly TurnStep[] = [];
    let notes: readonly string[] = [];
    // The characters of tool details that the turn kept so far.
    let detailLength = 0;
    const draft = new TextStreamRedactor(this.options.redactor);
    let blockStarts = false;

    const runtime = this.runtimeOf(sessionId);
    const emit = (payload: EngineEventPayload): void => {
      if (turn.ended) return;
      if (isTurnEnd(payload)) {
        turn.ended = true;
        runtime.turnRunning = false;
        // Before the event: a front end that reads the tasks or steps after it must not get them back.
        this.forgetRunningTurn(sessionId);
      }
      this.emit(sessionId, payload);
    };

    const controller = new AbortController();
    runtime.controller = controller;
    runtime.turnRunning = true;
    this.turnSteps.set(sessionId, steps);
    runtime.addProjectWork = (work) => {
      if (turn.ended) return;
      taskIds.add(work.projectSessionId);
      activity.taskCount = taskIds.size;
      steps = addStep(steps, work);
      this.turnSteps.set(sessionId, steps);
    };
    // A stopped turn waits for no answer any more, so its open questions end now.
    controller.signal.addEventListener("abort", () => {
      this.expireApprovals(sessionId);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // An object, as only the timer callback sets it.
    const timeLimit = { reached: false };
    let releaseFolder = (): void => undefined;
    let historyLost = false;
    let startSnapshot: string | null = null;
    let endSnapshot: string | null = null;
    let engineRan = false;
    try {
      releaseFolder = await this.takeFolder(session, controller.signal);
      this.lastActivity.set(sessionId, this.options.now().getTime());
      // After the wait: the other turn may itself run up to the time-out.
      timeout = setTimeout(() => {
        timeLimit.reached = true;
        controller.abort();
      }, this.options.turnTimeoutMs);
      if (engine === undefined) throw new EvaError("engine_failed", `The engine ${session.engine} is not available.`);
      const prepared = await preparer.prepare(session, {
        ask: async (question, detail) => {
          const outcome = await this.requestApproval(sessionId, question, detail, null, controller.signal);
          // A mode's question has no questions of the model, so it never ends with answers.
          return typeof outcome === "object" ? "allow" : outcome;
        },
      });
      if (controller.signal.aborted) {
        // A stop of the person wins: after a time-out alone, nobody pressed Stop, so the reason must not say so.
        throw new Error(
          timeLimit.reached && !runtime.stopped
            ? "The turn ran past its time limit before the engine started."
            : "The turn stopped before the engine started.",
        );
      }
      await this.restorePending(session, preparer);
      startSnapshot = await this.takeSnapshot(session, preparer);
      const engineText = preparer.engineMessage?.(session, prompt) ?? prompt;
      engineRan = true;
      const history = this.historyOf(session);
      // A continue after failed turns only: the engine may never have created its session. Its
      // lost-history retry then starts one, and nothing was lost, so the person sees no notice.
      const isContinueAfterFailure =
        history.kind === "continue" && !session.turns.some((past) => past.failure === null);
      const previousModel = session.turns.at(-1)?.modelAlias;
      const stream = engine.runTurn({
        mode: session.mode,
        history,
        startFolder: prepared.startFolder,
        projectFolder: prepared.projectFolder,
        prompt:
          prepared.messagePrefix === null
            ? engineText
            : `${prepared.messagePrefix}

${engineText}`,
        model: session.modelAlias,
        ...(previousModel === undefined ? {} : { previousModel }),
        effort: takesEffort(session.engine, session.modelAlias) ? session.effort : null,
        appendSystemPrompt: prepared.appendSystemPrompt,
        pluginFolders: prepared.pluginFolders,
        mcpServers: prepared.mcpServers,
        trusted: prepared.trusted,
        environment: prepared.environment,
        requestApproval: async (request) =>
          (await this.requestApproval(sessionId, request.toolName, request.summary, null, controller.signal)) ===
          "allow"
            ? "allow"
            : "deny",
        askQuestions: async (toolName, questions): Promise<QuestionsOutcome> => {
          const summary = questions[0]?.question ?? toolName;
          const outcome = await this.requestApproval(sessionId, toolName, summary, questions, controller.signal);
          if (typeof outcome === "object") return outcome.answers;
          return outcome === "deny" ? "declined" : "expired";
        },
        signal: controller.signal,
      });
      for await (const raw of stream) {
        if (turn.ended) continue;
        // A piece is live only: the block's final text is what the record keeps.
        if (raw.kind === "text_delta") {
          if (raw.startsBlock === true) {
            draft.reset();
            blockStarts = true;
          }
          const text = draft.push(raw.text);
          if (text === "") continue;
          // The first sent piece carries the mark, even when the engine's first piece was held back.
          // A page that comes back reads the block so far, as the front ends build it from the pieces.
          this.turnDrafts.set(sessionId, (blockStarts ? "" : (this.turnDrafts.get(sessionId) ?? "")) + text);
          emit({ kind: "text_delta", text, ...(blockStarts ? { startsBlock: true } : {}) });
          blockStarts = false;
          continue;
        }
        if (raw.kind === "text") this.turnDrafts.delete(sessionId);
        // A final text does not reset the stream: the next block can start before it comes.
        // Redact before anything is kept, not only before it is sent: the history is shown again later (lesson 95).
        const redacted = redactPayload(raw, this.options.redactor);
        const payload = withinDetailBudget(redacted, detailLength);
        detailLength += detailLengthOf(payload);
        if (payload.kind === "history_lost") {
          historyLost = true;
          if (isContinueAfterFailure) continue;
        }
        if (payload.kind === "text") {
          lastText = payload.messageId;
          answerParts.push(payload.text);
        }
        if (payload.kind === "tool_started") {
          activity.toolCount += 1;
          if (payload.category === "command") activity.commandCount += 1;
        }
        if (payload.kind === "task_changed") {
          taskIds.add(payload.taskId);
          activity.taskCount = taskIds.size;
          const { taskId, description, state } = payload;
          // The engine names a task, so two chats may use the same id.
          this.tasks.set(`${sessionId}\n${taskId}`, { taskId, sessionId, description, state });
        }
        notes = addNote(notes, payload);
        steps = addStep(steps, payload);
        this.turnSteps.set(sessionId, steps);
        if (payload.kind === "turn_finished") {
          // Before the end event, so a front end that reloads the chat can fork at this answer at once.
          endSnapshot = await this.takeSnapshot(session, preparer);
          const recorded = {
            userText: this.options.redactor.redact(prompt),
            answerText: answerParts.join("\n\n"),
          };
          // Record first: a front end that reloads the list on this event must find the turn in it.
          const firstLineTitle = this.recordTurn(
            session,
            {
              ...recorded,
              ...sender,
              ...activity,
              ...this.keptSteps(sessionId, steps),
              notes: [...notes],
              contextTokens: payload.contextTokens,
              contextWindow: payload.contextWindow,
              model: payload.model,
              modelAlias: session.modelAlias,
              startSnapshot,
              endSnapshot,
            },
            payload,
            lastText,
          );
          // Only after the record: a save that throws makes the turn fail, and the front ends see turn_failed.
          finished = payload;
          if (firstLineTitle !== null) {
            this.nameInBackground(sessionId, firstLineTitle, {
              engine: session.engine,
              model: session.modelAlias,
              ...recorded,
            });
          }
        }
        emit(payload);
      }
      if (!turn.ended) emit({ kind: "turn_failed", reason: "The engine stopped without ending the turn." });
    } catch (error) {
      emit({ kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
      // While the turn still holds the folder, so no other turn changes the files first. A finished turn took it already.
      if (engineRan && finished === null) endSnapshot = await this.takeSnapshot(session, preparer);
      releaseFolder();
      runtime.controller = null;
      runtime.turnRunning = false;
      runtime.addProjectWork = null;
      this.forgetRunningTurn(sessionId);
    }
    // Before the work after the turn, which can throw. Each unfinished turn sent one turn_failed.
    result.failure = finished === null ? (this.lastFailure.get(sessionId) ?? "The turn failed.") : null;
    // A batch with a message clears the flag at its start, so only a stop of this turn counts.
    result.stopped = runtime.stopped;
    if (finished === null)
      this.recordFailure(
        session.id,
        prompt,
        sender,
        answerParts,
        { ...activity, ...this.keptSteps(sessionId, steps), notes: [...notes] },
        historyLost,
        { startSnapshot, endSnapshot },
      );

    return preparer.afterTurn(this.get(sessionId), { finished: finished !== null });
  }

  /**
   * Waits until no other chat runs a turn in the folder of a Project chat, then holds the folder.
   * Two agents in one clone would pull, commit and push against each other (issue 356). Every
   * Assistant chat runs at the vault root, and Eva's vault sync handles them, so they never wait.
   */
  private async takeFolder(session: SessionRecord, signal: AbortSignal): Promise<() => void> {
    if (session.mode !== "project") return () => undefined;
    const folder = session.startFolder;
    let told = false;
    // Several turns can wait. The first to wake takes the folder, and the others wait again.
    for (let held = this.folderTurns.get(folder); held !== undefined; held = this.folderTurns.get(folder)) {
      if (!told) {
        told = true;
        this.emit(session.id, {
          kind: "notice",
          text: "Another chat runs a turn in this clone. This turn starts when that turn ends.",
        });
      }
      // A front end can stop the turn inside the notice event, before the listener exists.
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const onAbort = (): void => resolve();
          signal.addEventListener("abort", onAbort, { once: true });
          void held.then(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });
      }
      if (signal.aborted) throw new Error("The turn stopped while it waited for another chat in this clone.");
    }
    let release = (): void => undefined;
    this.folderTurns.set(
      folder,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.folderTurns.delete(folder);
      release();
    };
  }

  /**
   * Brings back the files that an undo retry asked for, while the turn holds the folder (issue 523).
   * A failed restore fails the turn and keeps the request, so the next message tries again.
   */
  private async restorePending(session: SessionRecord, preparer: TurnPreparer): Promise<void> {
    const snapshot = this.get(session.id).pendingRestore;
    if (snapshot === null || preparer.restore === undefined) return;
    // The files now can hold changes that the person made after the last turn: keep them first.
    const before = await this.takeSnapshot(session, preparer);
    if (before === null) throw new Error("Eva could not keep the files as they are now, so she did not undo them.");
    this.options.logger?.log("info", "Eva kept the files of a clone before an undo.", {
      sessionId: session.id,
      snapshot: before,
    });
    try {
      await preparer.restore(session, snapshot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Eva could not bring back the files of this answer: ${reason}`, { cause: error });
    }
    this.options.store.save({ ...this.get(session.id), pendingRestore: null });
  }

  /**
   * Lets the mode delete the snapshots of a chat's own turns. A branch's pending restore names a turn
   * of another chat, which may stay, so it is not among them. `keep` names the snapshots that another
   * branch still uses.
   */
  private forgetSnapshots(session: SessionRecord, keep: ReadonlySet<string> = new Set()): void {
    const preparer = this.options.preparers[session.mode];
    const ids = session.turns
      .flatMap((turn) => [turn.startSnapshot, turn.endSnapshot])
      .filter((id): id is string => id !== null && !keep.has(id));
    if (preparer.forget === undefined || ids.length === 0) return;
    try {
      preparer.forget(session, ids);
    } catch {
      // A snapshot left behind costs only a ref, which a reuse of the clone deletes.
    }
  }

  /** A new snapshot of the chat's folder, or null when the mode keeps none or it failed. The turn goes on. */
  private async takeSnapshot(session: SessionRecord, preparer: TurnPreparer): Promise<string | null> {
    if (preparer.snapshot === undefined) return null;
    const id = this.options.newId();
    try {
      if (await preparer.snapshot(session, id)) return id;
    } catch (error) {
      this.options.logger?.log("warn", "Eva could not keep a snapshot of the files of a chat.", {
        sessionId: session.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  private historyOf(session: SessionRecord): TurnHistory {
    if (session.historyLost) return { kind: "new", engineSessionId: session.engineSessionId };
    const own = session.turns.filter(ranHere);
    if (own.some((turn) => turn.failure === null)) {
      return { kind: "continue", engineSessionId: session.engineSessionId };
    }
    // A fork that took turns from a deleted branch, and ran none yet, goes on from the last one.
    const moved = session.turns.findLast((turn) => !ranHere(turn) && turn.lastMessageId !== null);
    if (moved !== undefined && moved.lastMessageId !== null)
      return { kind: "fork", fromEngineSessionId: engineOf(session, moved), atMessageId: moved.lastMessageId };
    // A fork learns its engine id only from a finished turn, so after a failed fork turn it forks again.
    // A chat from another clone keeps its point in `forkedFrom`: it is no branch of a chat here.
    const forkAt = session.forkAtMessageId ?? session.forkedFrom?.atMessageId ?? null;
    if (session.forkFromEngineSessionId !== null && forkAt !== null) {
      return { kind: "fork", fromEngineSessionId: session.forkFromEngineSessionId, atMessageId: forkAt };
    }
    // A failed or stopped turn may have created the engine session already. A second "new"
    // with the same id would then fail on every later message.
    if (own.length > 0) return { kind: "continue", engineSessionId: session.engineSessionId };
    return { kind: "new", engineSessionId: session.engineSessionId };
  }

  /** Returns the first-line title when this turn named the chat, or null. */
  private recordTurn(
    session: SessionRecord,
    turn: {
      userText: string;
      fromEva: boolean;
      projectReports: ProjectReport[];
      personText: string | null;
      answerText: string;
      contextTokens: number | null;
      contextWindow: number | null;
      model: string | null;
      modelAlias: ModelAlias;
      startSnapshot: string | null;
      endSnapshot: string | null;
    } & TurnActivity,
    finished: Extract<EngineEventPayload, { kind: "turn_finished" }>,
    lastText: string | null,
  ): string | null {
    const at = this.options.now().toISOString();
    const current = this.get(session.id);
    const firstLineTitle =
      current.turns.length === 0 && current.parentId === null && current.title === defaultTitle
        ? titleOf(turn.userText)
        : null;
    this.options.store.save({
      ...current,
      engineSessionId: finished.engineSessionId,
      forkFromEngineSessionId: null,
      historyLost: false,
      lastTurnAt: at,
      title: firstLineTitle ?? current.title,
      turns: [...current.turns, { ...turn, failure: null, lastMessageId: finished.lastMessageId ?? lastText, at }],
    });
    return firstLineTitle;
  }

  /** The steps for the session record. Their details go to their own file, so the session list stays small. */
  private keptSteps(sessionId: string, steps: readonly TurnStep[]): { steps: TurnStep[]; omittedSteps: number } {
    const kept = storedSteps(steps);
    try {
      this.options.stepDetails?.addTurn(sessionId, stepDetails(kept.steps));
    } catch {
      // The details only serve the step dialog, so a failed write must not lose the turn. The dialog then says Eva kept none.
    }
    return { ...kept, steps: kept.steps.map(withoutDetails) };
  }

  /** The whole input and output of one step, or null when Eva kept none. */
  stepDetail(sessionId: string, stepId: string): StepDetail | null {
    this.get(sessionId);
    return this.options.stepDetails?.get(sessionId, stepId) ?? null;
  }

  /** Keeps a failed turn, with its reason, so the person sees it after a reload. */
  private recordFailure(
    sessionId: string,
    prompt: string,
    sender: TurnSender,
    answerParts: readonly string[],
    activity: TurnActivity,
    historyLost: boolean,
    snapshots: { readonly startSnapshot: string | null; readonly endSnapshot: string | null },
  ): void {
    const current = this.options.store.get(sessionId);
    if (current === undefined) return;
    const last = this.lastFailure.get(sessionId) ?? "The turn failed.";
    const at = this.options.now().toISOString();
    this.options.store.save({
      ...current,
      // A lost history that the retry could not replace: start a new engine session next time,
      // instead of finding it lost again on every message (lesson 46).
      ...(historyLost ? { historyLost: true, engineSessionId: this.options.newId() } : {}),
      lastTurnAt: at,
      turns: [
        ...current.turns,
        {
          userText: this.options.redactor.redact(prompt),
          ...sender,
          answerText: answerParts.join("\n\n"),
          ...activity,
          contextTokens: null,
          contextWindow: null,
          model: null,
          modelAlias: current.modelAlias,
          failure: last,
          lastMessageId: null,
          at,
          ...snapshots,
        },
      ],
    });
  }

  private requestApproval(
    sessionId: string,
    toolName: string,
    summary: string,
    questions: readonly ApprovalQuestion[] | null,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> {
    // The stop already expired the open questions, so a later one would wait for nobody.
    if (signal.aborted) return Promise.resolve("expired");
    const requestId = this.options.newId();
    const redactor = this.options.redactor;
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveApproval(requestId, "expired");
      }, this.options.approvalTimeoutMs);
      this.approvals.set(requestId, {
        question: {
          requestId,
          sessionId,
          toolName,
          summary: redactor.redact(summary),
          ...(questions === null ? {} : { questions: redactedQuestions(questions, redactor) }),
        },
        resolve: (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        },
      });
      this.emit(sessionId, {
        kind: "approval_needed",
        requestId,
        toolName,
        summary,
        ...(questions === null ? {} : { questions }),
      });
    });
  }

  private emit(sessionId: string, payload: EngineEventPayload | CoreEventPayload): void {
    const event = redactPayload(payload, this.options.redactor);
    if (event.kind === "turn_failed") this.lastFailure.set(sessionId, event.reason);
    const stamped: SessionEvent = {
      ...event,
      sessionId,
      seq: this.sequence.next(),
      at: this.options.now().toISOString(),
    };
    for (const listener of this.listeners) {
      // One broken front end must not break a turn, or keep the event from the other front ends.
      try {
        listener(stamped);
        this.brokenListeners.delete(listener);
      } catch (error) {
        // Once until it works again: a listener that fails on each event would fill the log.
        if (this.brokenListeners.has(listener)) continue;
        this.brokenListeners.add(listener);
        this.options.logger?.log("error", "A front end failed on a chat event.", {
          sessionId,
          kind: stamped.kind,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private runtimeOf(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (runtime === undefined) {
      runtime = {
        busy: false,
        turnRunning: false,
        controller: null,
        timer: null,
        pending: null,
        stopped: false,
        addProjectWork: null,
      };
      this.runtimes.set(sessionId, runtime);
    }
    return runtime;
  }
}

function createBatch(): PendingBatch {
  let resolve: () => void = () => undefined;
  const done = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { texts: [], messages: [], outcome: { failure: null, stopped: false }, done, resolve };
}

/** Every text of a result, as the same values are redacted in the message text. */
function redactReport(report: ProjectReport, redactor: Redactor): ProjectReport {
  const redact = (text: string): string => redactor.redact(text);
  return {
    ...report,
    projectId: redact(report.projectId),
    projectTitle: redact(report.projectTitle),
    request: redact(report.request),
    clone: redact(report.clone),
    repositories: report.repositories.map((repository) => ({
      ...repository,
      name: redact(repository.name),
      branch: repository.branch === null ? null : redact(repository.branch),
    })),
    result: redact(report.result),
  };
}

type Turn = SessionRecord["turns"][number];

/** False for a turn that a delete moved here from another engine session (issue 647). */
function ranHere(turn: Turn): boolean {
  return (turn.ranIn?.engineSessionId ?? null) === null;
}

/** The engine session that holds a turn: where a moved turn ran, or the branch's own. */
function engineOf(session: SessionRecord, turn: Turn): string {
  return turn.ranIn?.engineSessionId ?? session.engineSessionId;
}

/** The history point at a message of a branch, in the engine session that holds it. */
function pointAt(session: SessionRecord, messageId: string): HistoryPoint {
  const turn = session.turns.find((candidate) => candidate.lastMessageId === messageId);
  return {
    engineSessionId: turn === undefined ? session.engineSessionId : engineOf(session, turn),
    atMessageId: messageId,
  };
}

/**
 * The index of the branch's turn with the message. Only a damaged file has a fork at a message that
 * the branch does not hold. The web app then shows the fork after the whole branch, so the fork takes it all.
 */
function sharedEnd(branch: SessionRecord, messageId: string): number {
  const index = branch.turns.findIndex((turn) => turn.lastMessageId === messageId);
  return index === -1 ? branch.turns.length - 1 : index;
}

/**
 * The fork with the branch's turns `from` to `to` before its own. Every moved turn keeps where it
 * ran, so its vault snapshots and its engine session stay found.
 */
function movedTo(fork: SessionRecord, branch: SessionRecord, from: number, to: number): SessionRecord {
  const taken = branch.turns.slice(from, to + 1).map((turn, offset) => ({
    ...turn,
    ranIn: {
      sessionId: turn.ranIn?.sessionId ?? branch.id,
      turnIndex: turn.ranIn?.turnIndex ?? from + offset,
      engineSessionId: turn.ranIn?.engineSessionId ?? branch.engineSessionId,
    },
  }));
  if (taken.length === 0) return fork;
  const own = fork.turns.map((turn, index): Turn => ({
    ...turn,
    ranIn: turn.ranIn ?? { sessionId: fork.id, turnIndex: index, engineSessionId: null },
  }));
  // The seen count is a count of first turns: an unseen moved turn makes the turns after it unseen too.
  const seenTaken = Math.max(0, Math.min(branch.seenTurns - from, taken.length));
  return {
    ...fork,
    turns: [...taken, ...own],
    // Its own turns are newer than the moved ones. With none yet, the moved turns are its activity,
    // so its chat keeps its place in the list.
    lastTurnAt: fork.lastTurnAt ?? taken.at(-1)?.at ?? null,
    seenTurns: seenTaken < taken.length ? seenTaken : taken.length + fork.seenTurns,
  };
}

/** The fields of a whole chat, which the heir of its first branch takes. */
function chatFields(branch: SessionRecord, heir: SessionRecord): Partial<SessionRecord> {
  return {
    title: branch.title,
    source: branch.source,
    telegramTopicId: branch.telegramTopicId,
    archived: branch.archived,
    continuedFrom: branch.continuedFrom,
    firstMessageDraft: branch.firstMessageDraft,
    reportsTo: branch.reportsTo,
    // An heir that shares no turn shares no history point either.
    forkedFrom: heir.forkAtMessageId === null ? heir.forkedFrom : branch.forkedFrom,
  };
}

function titleOf(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return cutTitle(firstLine) || defaultTitle;
}

/** Counts code points, not UTF-16 units, so a cut never leaves half an emoji. */
function cutTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length > titleLength ? `${characters.slice(0, titleLength - 1).join("")}…` : title;
}

function redactedQuestions(questions: readonly ApprovalQuestion[], redactor: Redactor): ApprovalQuestion[] {
  return questions.map((question) => ({
    ...question,
    question: redactor.redact(question.question),
    header: redactor.redact(question.header),
    options: question.options.map((option) => ({
      label: redactor.redact(option.label),
      description: redactor.redact(option.description),
    })),
  }));
}

/** One fitting answer for each question. */
function answersFit(questions: readonly ApprovalQuestion[], answers: QuestionAnswers): boolean {
  return (
    answers.length === questions.length &&
    answers.every((answer, index) => {
      const question = questions[index];
      return question !== undefined && answerFits(question, answer);
    })
  );
}

function redactPayload(payload: EngineEventPayload, redactor: Redactor): EngineEventPayload;
function redactPayload(
  payload: EngineEventPayload | CoreEventPayload,
  redactor: Redactor,
): EngineEventPayload | CoreEventPayload;
function redactPayload(
  payload: EngineEventPayload | CoreEventPayload,
  redactor: Redactor,
): EngineEventPayload | CoreEventPayload {
  switch (payload.kind) {
    // The stream redactor of the turn already redacted the whole block of a text_delta. This pass is cheap.
    case "text":
    case "text_delta":
    case "notice":
    case "message_received":
      return { ...payload, text: redactor.redact(payload.text) };
    case "turn_failed":
      return { ...payload, reason: redactor.redact(payload.reason) };
    case "tool_started": {
      const { input } = payload;
      return {
        ...payload,
        summary: redactor.redact(payload.summary),
        ...(input === undefined
          ? {}
          : { input: boundedDetail(redactedJsonText(input, (text) => redactor.redact(text))) }),
      };
    }
    case "approval_needed": {
      const { questions } = payload;
      return {
        ...payload,
        summary: redactor.redact(payload.summary),
        ...(questions === undefined ? {} : { questions: redactedQuestions(questions, redactor) }),
      };
    }
    case "approval_resolved": {
      const { answers } = payload;
      if (answers === undefined) return payload;
      // The person's own text can hold a secret. The option indexes cannot.
      return {
        ...payload,
        answers: answers.map((answer) =>
          answer.other === undefined ? answer : { ...answer, other: redactor.redact(answer.other) },
        ),
      };
    }
    case "task_changed":
      return { ...payload, description: redactor.redact(payload.description) };
    case "session_renamed":
      return { ...payload, title: redactor.redact(payload.title) };
    case "fork_named":
      return { ...payload, name: redactor.redact(payload.name) };
    case "tool_finished": {
      const { output } = payload;
      return output === undefined
        ? payload
        : { ...payload, output: boundedDetail(redactedJsonText(output, (text) => redactor.redact(text))) };
    }
    case "history_lost":
    case "usage_limit":
    case "turn_finished":
    case "session_deleted":
    case "session_seen":
    case "session_archived":
    case "session_closed":
      return payload;
    case "project_work_started":
      return { ...payload, request: redactor.redact(payload.request) };
  }
}

function detailLengthOf(payload: EngineEventPayload): number {
  if (payload.kind === "tool_started") return payload.input?.length ?? 0;
  if (payload.kind === "tool_finished") return payload.output?.length ?? 0;
  return 0;
}

/** Past the turn's budget, a tool event loses its details, and its step keeps only its summary. */
function withinDetailBudget(payload: EngineEventPayload, used: number): EngineEventPayload {
  if (used + detailLengthOf(payload) <= maxTurnDetailLength) return payload;
  if (payload.kind === "tool_started") {
    const { input: _input, ...rest } = payload;
    return rest;
  }
  if (payload.kind === "tool_finished") {
    const { output: _output, ...rest } = payload;
    return rest;
  }
  return payload;
}

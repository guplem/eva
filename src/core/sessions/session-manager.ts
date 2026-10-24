/**
 * Runs conversations: one turn at a time per session, with message gathering and queueing,
 * forks and retries, approvals, and exactly one end event per turn
 * (lessons 44, 47, 48, 49, 51, 114).
 */
import type {
  ApprovalAnswer,
  EffortLevel,
  EngineName,
  EnginePort,
  McpServerSpec,
  ModelAlias,
  SessionMode,
  TurnHistory,
} from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import {
  isTurnEnd,
  type CoreEventPayload,
  type EngineEventPayload,
  type MessageOrigin,
  type SessionEvent,
  type TaskState,
} from "../../shared/events.ts";
import { SequenceCounter } from "../../shared/clock.ts";
import type { Logger } from "../../shared/logger.ts";
import { TextStreamRedactor, type Redactor } from "../../shared/redaction.ts";
import { boundedDetail, maxTurnDetailLength, redactedJsonText } from "../../shared/tool-details.ts";
import {
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

/** What each mode does around a turn (Assistant: pull, prompt, save, skill runs; Project: trust). */
export interface TurnPreparer {
  prepare(session: SessionRecord, context: PrepareContext): Promise<PreparedTurn>;
  /** Returns a message to send to the same session as its next turn, or null. */
  afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null>;
}

export interface NewSessionInput {
  readonly mode: SessionMode;
  readonly engine: EngineName;
  readonly model: ModelAlias;
  readonly effort?: EffortLevel;
  readonly startFolder: string;
  readonly source: SessionRecord["source"];
  readonly projectId?: string;
  readonly clone?: string;
  readonly telegramTopicId?: number;
  /** A fixed title, such as a schedule's name. Without one, the first message names the chat. */
  readonly title?: string;
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
}

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
  readonly messages: { readonly text: string; readonly origin: MessageOrigin }[];
  readonly done: Promise<void>;
  readonly resolve: () => void;
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
}

const titleLength = 60;
/** What a turn did, for the activity chips and the step badges under its answer. */
interface TurnActivity {
  readonly toolCount: number;
  readonly commandCount: number;
  readonly taskCount: number;
  readonly steps: TurnStep[];
  readonly omittedSteps: number;
}

const defaultTitle = "New chat";
const maxFollowUps = 20;

export class SessionManager {
  private readonly options: SessionManagerOptions;
  private readonly listeners = new Set<EventListener>();
  private readonly idleListeners = new Set<IdleListener>();
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly approvals = new Map<
    string,
    { readonly question: PendingApproval; readonly resolve: (answer: PrepareAnswer) => void }
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
    const record: SessionRecord = {
      id: this.options.newId(),
      engineSessionId: this.options.newId(),
      engine: input.engine,
      mode: input.mode,
      modelAlias: input.model,
      effort: input.effort ?? "default",
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

  /** Chooses the model of a chat before its first turn. A model belongs to a conversation (lesson 41). */
  setModel(sessionId: string, model: ModelAlias): SessionRecord {
    const session = this.get(sessionId);
    if (session.turns.length > 0 || this.isBusy(sessionId)) {
      throw new EvaError("session_busy", "The model of a chat is chosen before its first message.");
    }
    const updated = { ...session, modelAlias: model };
    this.options.store.save(updated);
    return updated;
  }

  /**
   * Chooses how much the model of a chat reasons. Unlike the model, it can change between turns:
   * it changes no history. A running turn keeps the effort it started with.
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
    if (session.parentId !== null) throw new EvaError("session_busy", "A fork keeps the engine of its chat.");
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

  /**
   * The failure reason of a chat's last turn, or null after a good turn, before the first turn,
   * or for a missing chat. A send never rejects, so a caller that must know reads this after it.
   */
  lastTurnFailure(sessionId: string): string | null {
    return this.options.store.get(sessionId)?.turns.at(-1)?.failure ?? null;
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
  send(sessionId: string, text: string, origin: MessageOrigin = "eva"): Promise<void> {
    // A new answer must not hide in the archive.
    this.setArchived(this.rootOf(this.get(sessionId)).id, false);
    const runtime = this.runtimeOf(sessionId);
    const batch = runtime.pending ?? createBatch();
    runtime.pending = batch;
    batch.texts.push(text);
    batch.messages.push({ text, origin });
    this.lastActivity.set(sessionId, this.options.now().getTime());
    if (!runtime.busy) this.startGathering(sessionId, runtime);
    return batch.done;
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
   * at a parent that is gone. The engine keeps its own transcript.
   */
  delete(sessionId: string): string[] {
    this.get(sessionId);
    const ids = [sessionId];
    // The loop also visits the ids that it adds, so it walks the whole tree.
    for (const parentId of ids) {
      for (const session of this.list()) if (session.parentId === parentId) ids.push(session.id);
    }
    // A queued message would run on a deleted record, so a gathered one refuses the delete too.
    if (ids.some((id) => this.isActive(id)))
      throw new EvaError("session_busy", "Eva is still working in this chat. Try again when she finishes.");
    for (const id of ids) {
      this.options.store.delete(id);
      this.options.stepDetails?.delete(id);
      this.runtimes.delete(id);
      this.lastFailure.delete(id);
      this.lastActivity.delete(id);
    }
    // Only after the whole tree is gone: a front end that reloads the list must not find a fork.
    for (const id of ids) this.emit(id, { kind: "session_deleted" });
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
    this.emit(sessionId, { kind: "project_work_started", ...work });
  }

  /** A new branch of a conversation, up to and including one message. Its first message starts it. */
  fork(sessionId: string, atMessageId: string): SessionRecord {
    const parent = this.get(sessionId);
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
      forkFromEngineSessionId: parent.engineSessionId,
      title: parent.title,
    };
    this.options.store.save(record);
    return record;
  }

  /**
   * Runs a turn again on a new branch; the old answer stays in its own branch. It returns the
   * branch at once: a long turn must not hold the request past the idle time-out of the server.
   */
  retry(sessionId: string, turnIndex: number): Promise<SessionRecord> {
    // A refusal still comes as a rejection, as the caller awaits it.
    return Promise.resolve().then(() => {
      const session = this.get(sessionId);
      const turn = session.turns[turnIndex];
      if (turn === undefined)
        throw new EvaError("session_not_found", `Session ${sessionId} has no turn ${String(turnIndex)}.`);
      const branch = this.retryBranch(session, turnIndex);
      // The send never rejects: a failure of the turn is its turn_failed event.
      void this.send(branch.id, turn.userText);
      return this.get(branch.id);
    });
  }

  answerApproval(requestId: string, answer: ApprovalAnswer): void {
    this.resolveApproval(requestId, answer);
  }

  /** Front ends see an expired question as denied; only the asker learns that it expired. */
  private resolveApproval(requestId: string, answer: PrepareAnswer): void {
    const pending = this.approvals.get(requestId);
    if (pending === undefined) return;
    this.approvals.delete(requestId);
    pending.resolve(answer);
    this.emit(pending.question.sessionId, {
      kind: "approval_resolved",
      requestId,
      answer: answer === "expired" ? "deny" : answer,
      // Nobody answered: the time ran out, or the turn stopped.
      timedOut: answer === "expired",
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

  private retryFromStart(session: SessionRecord): SessionRecord {
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
        for (const message of batch.messages) this.emit(sessionId, { kind: "message_received", ...message });
        let followUp: string | null = null;
        try {
          followUp = await this.runTurn(sessionId, batch.texts.join("\n\n"));
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

  /** Runs one turn and returns the follow-up message of the mode, if any. */
  private async runTurn(sessionId: string, prompt: string): Promise<string | null> {
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
    // A stopped turn waits for no answer any more, so its open questions end now.
    controller.signal.addEventListener("abort", () => {
      this.expireApprovals(sessionId);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let releaseFolder = (): void => undefined;
    let historyLost = false;
    try {
      releaseFolder = await this.takeFolder(session, controller.signal);
      this.lastActivity.set(sessionId, this.options.now().getTime());
      // After the wait: the other turn may itself run up to the time-out.
      timeout = setTimeout(() => {
        controller.abort();
      }, this.options.turnTimeoutMs);
      if (engine === undefined) throw new EvaError("engine_failed", `The engine ${session.engine} is not available.`);
      const prepared = await preparer.prepare(session, {
        ask: (question, detail) => this.requestApproval(sessionId, question, detail),
      });
      const history = this.historyOf(session);
      // A continue after failed turns only: the engine may never have created its session. Its
      // lost-history retry then starts one, and nothing was lost, so the person sees no notice.
      const isContinueAfterFailure =
        history.kind === "continue" && !session.turns.some((past) => past.failure === null);
      const stream = engine.runTurn({
        mode: session.mode,
        history,
        startFolder: prepared.startFolder,
        prompt:
          prepared.messagePrefix === null
            ? prompt
            : `${prepared.messagePrefix}

${prompt}`,
        model: session.modelAlias,
        effort: session.effort,
        appendSystemPrompt: prepared.appendSystemPrompt,
        pluginFolders: prepared.pluginFolders,
        mcpServers: prepared.mcpServers,
        trusted: prepared.trusted,
        environment: prepared.environment,
        requestApproval: async (request) =>
          (await this.requestApproval(sessionId, request.toolName, request.summary)) === "allow" ? "allow" : "deny",
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
        steps = addStep(steps, payload);
        this.turnSteps.set(sessionId, steps);
        if (payload.kind === "turn_finished") {
          finished = payload;
          const recorded = {
            userText: this.options.redactor.redact(prompt),
            answerText: answerParts.join("\n\n"),
          };
          // Record first: a front end that reloads the list on this event must find the turn in it.
          const firstLineTitle = this.recordTurn(
            session,
            {
              ...recorded,
              ...activity,
              ...this.keptSteps(sessionId, steps),
              contextTokens: payload.contextTokens,
              contextWindow: payload.contextWindow,
              model: payload.model,
            },
            payload,
            lastText,
          );
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
      releaseFolder();
      runtime.controller = null;
      runtime.turnRunning = false;
      this.forgetRunningTurn(sessionId);
    }
    if (finished === null)
      this.recordFailure(
        session.id,
        prompt,
        answerParts,
        { ...activity, ...this.keptSteps(sessionId, steps) },
        historyLost,
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

  private historyOf(session: SessionRecord): TurnHistory {
    if (session.historyLost) return { kind: "new", engineSessionId: session.engineSessionId };
    if (session.turns.some((turn) => turn.failure === null)) {
      return { kind: "continue", engineSessionId: session.engineSessionId };
    }
    // A fork learns its engine id only from a finished turn, so after a failed fork turn it forks again.
    if (session.forkFromEngineSessionId !== null && session.forkAtMessageId !== null) {
      return {
        kind: "fork",
        fromEngineSessionId: session.forkFromEngineSessionId,
        atMessageId: session.forkAtMessageId,
      };
    }
    // A failed or stopped turn may have created the engine session already. A second "new"
    // with the same id would then fail on every later message.
    if (session.turns.length > 0) return { kind: "continue", engineSessionId: session.engineSessionId };
    return { kind: "new", engineSessionId: session.engineSessionId };
  }

  /** Returns the first-line title when this turn named the chat, or null. */
  private recordTurn(
    session: SessionRecord,
    turn: {
      userText: string;
      answerText: string;
      contextTokens: number | null;
      contextWindow: number | null;
      model: string | null;
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
    answerParts: readonly string[],
    activity: TurnActivity,
    historyLost: boolean,
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
          answerText: answerParts.join("\n\n"),
          ...activity,
          contextTokens: null,
          contextWindow: null,
          model: null,
          failure: last,
          lastMessageId: null,
          at,
        },
      ],
    });
  }

  private requestApproval(sessionId: string, toolName: string, summary: string): Promise<PrepareAnswer> {
    const requestId = this.options.newId();
    return new Promise<PrepareAnswer>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveApproval(requestId, "expired");
      }, this.options.approvalTimeoutMs);
      this.approvals.set(requestId, {
        question: { requestId, sessionId, toolName, summary: this.options.redactor.redact(summary) },
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
      });
      this.emit(sessionId, { kind: "approval_needed", requestId, toolName, summary });
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
    for (const listener of this.listeners) listener(stamped);
  }

  private runtimeOf(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (runtime === undefined) {
      runtime = { busy: false, turnRunning: false, controller: null, timer: null, pending: null, stopped: false };
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
  return { texts: [], messages: [], done, resolve };
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
    case "approval_needed":
      return { ...payload, summary: redactor.redact(payload.summary) };
    case "task_changed":
      return { ...payload, description: redactor.redact(payload.description) };
    case "session_renamed":
      return { ...payload, title: redactor.redact(payload.title) };
    case "tool_finished": {
      const { output } = payload;
      return output === undefined
        ? payload
        : { ...payload, output: boundedDetail(redactedJsonText(output, (text) => redactor.redact(text))) };
    }
    case "history_lost":
    case "usage_limit":
    case "approval_resolved":
    case "turn_finished":
    case "session_deleted":
    case "session_seen":
    case "session_archived":
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

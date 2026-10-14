/**
 * Runs conversations: one turn at a time per session, with message gathering and queueing,
 * forks and retries, approvals, and exactly one end event per turn (docs/plan.md §4.5,
 * §5.5; lessons 44, 47, 48, 49, 51, 114).
 */
import type {
  ApprovalAnswer,
  EngineName,
  EnginePort,
  ModelAlias,
  SessionMode,
  TurnHistory,
} from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import { isTurnEnd, type EngineEventPayload, type SessionEvent } from "../../shared/events.ts";
import { SequenceCounter } from "../../shared/clock.ts";
import type { Redactor } from "../../shared/redaction.ts";
import type { SessionRecord, SessionStore } from "./session-store.ts";

export interface PreparedTurn {
  readonly startFolder: string;
  readonly appendSystemPrompt: string | null;
  readonly pluginFolders: readonly string[];
  readonly trusted: boolean;
  readonly environment: Readonly<Record<string, string>>;
}

export interface TurnOutcome {
  readonly finished: boolean;
}

/** What each mode does around a turn (Assistant: pull, prompt, save, skill runs; Project: trust). */
export interface TurnPreparer {
  prepare(session: SessionRecord): Promise<PreparedTurn>;
  /** Returns a message to send to the same session as its next turn, or null. */
  afterTurn(session: SessionRecord, outcome: TurnOutcome): Promise<string | null>;
}

export interface NewSessionInput {
  readonly mode: SessionMode;
  readonly engine: EngineName;
  readonly model: ModelAlias;
  readonly startFolder: string;
  readonly source: SessionRecord["source"];
  readonly projectId?: string;
  readonly clone?: string;
  readonly telegramTopicId?: number;
}

export interface SessionManagerOptions {
  readonly engines: readonly EnginePort[];
  readonly store: SessionStore;
  readonly preparers: Readonly<Record<SessionMode, TurnPreparer>>;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly redactor: Redactor;
  /** How long a first message waits for more messages to join its turn (lesson 51). */
  readonly gatherMs: number;
  /** An approval nobody answers is denied after this time (plan §5.5). */
  readonly approvalTimeoutMs: number;
}

type EventListener = (event: SessionEvent) => void;

interface PendingBatch {
  readonly texts: string[];
  readonly done: Promise<void>;
  readonly resolve: () => void;
}

interface SessionRuntime {
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  pending: PendingBatch | null;
}

const titleLength = 60;
const maxFollowUps = 20;

export class SessionManager {
  private readonly options: SessionManagerOptions;
  private readonly listeners = new Set<EventListener>();
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly approvals = new Map<string, (answer: ApprovalAnswer) => void>();
  private readonly sequence = new SequenceCounter();

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
      startFolder: input.startFolder,
      projectId: input.projectId ?? null,
      clone: input.clone ?? null,
      parentId: null,
      forkAtMessageId: null,
      forkFromEngineSessionId: null,
      title: "New chat",
      createdAt: this.options.now().toISOString(),
      lastTurnAt: null,
      source: input.source,
      telegramTopicId: input.telegramTopicId ?? null,
      turns: [],
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

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isBusy(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.busy ?? false;
  }

  /** Sends a message. It resolves when the session is free again: its turn, queued turns and follow-ups have ended. */
  send(sessionId: string, text: string): Promise<void> {
    this.get(sessionId);
    const runtime = this.runtimeOf(sessionId);
    const batch = runtime.pending ?? createBatch();
    runtime.pending = batch;
    batch.texts.push(text);
    if (!runtime.busy && runtime.timer === null) {
      runtime.timer = setTimeout(() => {
        runtime.timer = null;
        void this.drain(sessionId);
      }, this.options.gatherMs);
    }
    return batch.done;
  }

  /** A new branch of a conversation, up to and including one message. Its first message starts it. */
  fork(sessionId: string, atMessageId: string): SessionRecord {
    const parent = this.get(sessionId);
    const record: SessionRecord = {
      ...this.createSession({
        mode: parent.mode,
        engine: parent.engine,
        model: parent.modelAlias,
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

  /** Runs a turn again on a new branch; the old answer stays in its own branch. */
  async retry(sessionId: string, turnIndex: number): Promise<SessionRecord> {
    const session = this.get(sessionId);
    const turn = session.turns[turnIndex];
    if (turn === undefined)
      throw new EvaError("session_not_found", `Session ${sessionId} has no turn ${String(turnIndex)}.`);
    const previous = session.turns[turnIndex - 1];
    const branch =
      previous === undefined || previous.lastMessageId === null
        ? this.retryFromStart(session)
        : this.fork(sessionId, previous.lastMessageId);
    await this.send(branch.id, turn.userText);
    return this.get(branch.id);
  }

  answerApproval(requestId: string, answer: ApprovalAnswer): void {
    const resolve = this.approvals.get(requestId);
    if (resolve === undefined) return;
    this.approvals.delete(requestId);
    resolve(answer);
  }

  private retryFromStart(session: SessionRecord): SessionRecord {
    const record: SessionRecord = {
      ...this.createSession({
        mode: session.mode,
        engine: session.engine,
        model: session.modelAlias,
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
        const followUp = await this.runTurn(sessionId, batch.texts.join("\n\n"));
        if (followUp !== null && followUps < maxFollowUps) {
          followUps += 1;
          runtime.pending ??= createBatch();
          runtime.pending.texts.unshift(followUp);
        }
      }
    } finally {
      runtime.busy = false;
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

    const emit = (payload: EngineEventPayload): void => {
      if (turn.ended) return;
      if (isTurnEnd(payload)) turn.ended = true;
      this.emit(sessionId, payload);
    };

    try {
      if (engine === undefined) throw new EvaError("engine_failed", `The engine ${session.engine} is not available.`);
      const prepared = await preparer.prepare(session);
      const controller = new AbortController();
      const stream = engine.runTurn({
        mode: session.mode,
        history: this.historyOf(session),
        startFolder: prepared.startFolder,
        prompt,
        model: session.modelAlias,
        appendSystemPrompt: prepared.appendSystemPrompt,
        pluginFolders: prepared.pluginFolders,
        trusted: prepared.trusted,
        environment: prepared.environment,
        requestApproval: (request) => this.requestApproval(sessionId, request.toolName, request.summary),
        signal: controller.signal,
      });
      for await (const payload of stream) {
        if (turn.ended) continue;
        if (payload.kind === "text") lastText = payload.messageId;
        if (payload.kind === "turn_finished") finished = payload;
        emit(payload);
      }
      if (!turn.ended) emit({ kind: "turn_failed", reason: "The engine stopped without ending the turn." });
    } catch (error) {
      emit({ kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) });
    }

    if (finished !== null) this.recordTurn(session, prompt, finished, lastText);
    return preparer.afterTurn(this.get(sessionId), { finished: finished !== null });
  }

  private historyOf(session: SessionRecord): TurnHistory {
    if (session.turns.length > 0) return { kind: "continue", engineSessionId: session.engineSessionId };
    if (session.forkFromEngineSessionId !== null && session.forkAtMessageId !== null) {
      return {
        kind: "fork",
        fromEngineSessionId: session.forkFromEngineSessionId,
        atMessageId: session.forkAtMessageId,
      };
    }
    return { kind: "new", engineSessionId: session.engineSessionId };
  }

  private recordTurn(
    session: SessionRecord,
    prompt: string,
    finished: Extract<EngineEventPayload, { kind: "turn_finished" }>,
    lastText: string | null,
  ): void {
    const at = this.options.now().toISOString();
    const current = this.get(session.id);
    this.options.store.save({
      ...current,
      engineSessionId: finished.engineSessionId,
      forkFromEngineSessionId: null,
      lastTurnAt: at,
      title: current.turns.length === 0 && current.parentId === null ? titleOf(prompt) : current.title,
      turns: [...current.turns, { userText: prompt, lastMessageId: finished.lastMessageId ?? lastText, at }],
    });
  }

  private requestApproval(sessionId: string, toolName: string, summary: string): Promise<ApprovalAnswer> {
    const requestId = this.options.newId();
    return new Promise<ApprovalAnswer>((resolve) => {
      const timer = setTimeout(() => {
        this.answerApproval(requestId, "deny");
      }, this.options.approvalTimeoutMs);
      this.approvals.set(requestId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      this.emit(sessionId, { kind: "approval_needed", requestId, toolName, summary });
    });
  }

  private emit(sessionId: string, payload: EngineEventPayload): void {
    const event = redactPayload(payload, this.options.redactor);
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
      runtime = { busy: false, timer: null, pending: null };
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
  return { texts: [], done, resolve };
}

function titleOf(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine || "New chat";
}

function redactPayload(payload: EngineEventPayload, redactor: Redactor): EngineEventPayload {
  switch (payload.kind) {
    case "text":
      return { ...payload, text: redactor.redact(payload.text) };
    case "notice":
      return { ...payload, text: redactor.redact(payload.text) };
    case "turn_failed":
      return { ...payload, reason: redactor.redact(payload.reason) };
    case "tool_started":
    case "approval_needed":
      return { ...payload, summary: redactor.redact(payload.summary) };
    case "task_changed":
      return { ...payload, description: redactor.redact(payload.description) };
    case "tool_finished":
    case "history_lost":
    case "turn_finished":
      return payload;
  }
}

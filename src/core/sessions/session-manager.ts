/**
 * Runs conversations: one turn at a time per session, with message gathering and queueing,
 * forks and retries, approvals, and exactly one end event per turn
 * (lessons 44, 47, 48, 49, 51, 114).
 */
import type {
  ApprovalAnswer,
  EngineName,
  EnginePort,
  McpServerSpec,
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
  readonly startFolder: string;
  readonly source: SessionRecord["source"];
  readonly projectId?: string;
  readonly clone?: string;
  readonly telegramTopicId?: number;
  /** A fixed title, such as a schedule's name. Without one, the first message names the chat. */
  readonly title?: string;
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
  /** An approval nobody answers is denied after this time. */
  readonly approvalTimeoutMs: number;
  /** A turn that runs longer is stopped, so a hung engine never keeps a chat busy for good. */
  readonly turnTimeoutMs: number;
}

/** An approval that waits for an answer. The summary is already redacted. */
export interface PendingApproval {
  readonly requestId: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly summary: string;
}

type EventListener = (event: SessionEvent) => void;

interface PendingBatch {
  readonly texts: string[];
  readonly done: Promise<void>;
  readonly resolve: () => void;
}

interface SessionRuntime {
  busy: boolean;
  /** Stops the running turn; null when no turn runs. */
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  pending: PendingBatch | null;
}

const titleLength = 60;
const defaultTitle = "New chat";
const maxFollowUps = 20;

export class SessionManager {
  private readonly options: SessionManagerOptions;
  private readonly listeners = new Set<EventListener>();
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly approvals = new Map<
    string,
    { readonly question: PendingApproval; readonly resolve: (answer: PrepareAnswer) => void }
  >();
  private readonly sequence = new SequenceCounter();
  /** The last failure reason of each session, for the history. */
  private readonly lastFailure = new Map<string, string>();

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
      title: input.title ?? defaultTitle,
      createdAt: this.options.now().toISOString(),
      lastTurnAt: null,
      source: input.source,
      telegramTopicId: input.telegramTopicId ?? null,
      historyLost: false,
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

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isBusy(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.busy ?? false;
  }

  /** Stops the running turn of a chat. False when no turn runs. */
  stop(sessionId: string): boolean {
    const controller = this.runtimes.get(sessionId)?.controller ?? null;
    if (controller === null) return false;
    controller.abort();
    return true;
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

  private expireApprovals(sessionId: string): void {
    for (const [requestId, pending] of this.approvals) {
      if (pending.question.sessionId === sessionId) this.resolveApproval(requestId, "expired");
    }
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
    const answerParts: string[] = [];
    let toolCount = 0;

    const emit = (payload: EngineEventPayload): void => {
      if (turn.ended) return;
      if (isTurnEnd(payload)) turn.ended = true;
      this.emit(sessionId, payload);
    };

    const runtime = this.runtimeOf(sessionId);
    const controller = new AbortController();
    runtime.controller = controller;
    // A stopped turn waits for no answer any more, so its open questions end now.
    controller.signal.addEventListener("abort", () => {
      this.expireApprovals(sessionId);
    });
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.options.turnTimeoutMs);
    let historyLost = false;
    try {
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
        // Redact before anything is kept, not only before it is sent: the history is shown again later (lesson 95).
        const payload = redactPayload(raw, this.options.redactor);
        if (payload.kind === "history_lost") {
          historyLost = true;
          if (isContinueAfterFailure) continue;
        }
        if (payload.kind === "text") {
          lastText = payload.messageId;
          answerParts.push(payload.text);
        }
        if (payload.kind === "tool_started") toolCount += 1;
        if (payload.kind === "turn_finished") {
          finished = payload;
          // Record first: a front end that reloads the list on this event must find the turn in it.
          this.recordTurn(
            session,
            { userText: this.options.redactor.redact(prompt), answerText: answerParts.join("\n\n"), toolCount },
            payload,
            lastText,
          );
        }
        emit(payload);
      }
      if (!turn.ended) emit({ kind: "turn_failed", reason: "The engine stopped without ending the turn." });
    } catch (error) {
      emit({ kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
      runtime.controller = null;
    }
    if (finished === null) this.recordFailure(session.id, prompt, answerParts, toolCount, historyLost);

    return preparer.afterTurn(this.get(sessionId), { finished: finished !== null });
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

  private recordTurn(
    session: SessionRecord,
    turn: { userText: string; answerText: string; toolCount: number },
    finished: Extract<EngineEventPayload, { kind: "turn_finished" }>,
    lastText: string | null,
  ): void {
    const at = this.options.now().toISOString();
    const current = this.get(session.id);
    this.options.store.save({
      ...current,
      engineSessionId: finished.engineSessionId,
      forkFromEngineSessionId: null,
      historyLost: false,
      lastTurnAt: at,
      title:
        current.turns.length === 0 && current.parentId === null && current.title === defaultTitle
          ? titleOf(turn.userText)
          : current.title,
      turns: [...current.turns, { ...turn, failure: null, lastMessageId: finished.lastMessageId ?? lastText, at }],
    });
  }

  /** Keeps a failed turn, with its reason, so the person sees it after a reload. */
  private recordFailure(
    sessionId: string,
    prompt: string,
    answerParts: readonly string[],
    toolCount: number,
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
          toolCount,
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

  private emit(sessionId: string, payload: EngineEventPayload): void {
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
      runtime = { busy: false, controller: null, timer: null, pending: null };
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
  return firstLine.length > titleLength ? `${firstLine.slice(0, titleLength - 1)}…` : firstLine || defaultTitle;
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
    case "approval_resolved":
    case "turn_finished":
      return payload;
  }
}

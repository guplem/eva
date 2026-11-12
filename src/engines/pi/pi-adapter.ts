/**
 * The pi engine: one `pi --mode rpc` child process per turn,
 * started on the turn's session file. Facts come from captured pi 0.73.1 output
 * (test/fixtures/pi/).
 *
 * - **Session handle:** Eva's engine session id names the file `<sessions>/<id>.jsonl`, so
 *   Eva knows the handle before the first turn (lesson 44).
 * - **Fork:** Eva writes the branch file herself (see pi-session-files.ts).
 * - **Turn end:** `agent_end` is final unless the last answer failed with a retryable error.
 *   pi emits `auto_retry_start` in the same tick as `agent_end`, so a `get_state` answer that
 *   arrives first means that no retry follows. After a good `agent_end`, Eva also asks for
 *   `get_state`, because only its model names the context window.
 * - **Approvals:** the extension in pi-approval-extension.ts asks before each tool call; the
 *   shared outward-action rule decides.
 * - **MCP servers:** pi has no MCP support, so the bridge in pi-mcp-bridge.ts runs Eva's
 *   servers and gives their tools Claude Code's names. The specs hold secrets. They go in a file
 *   that the bridge deletes at start. A shell command can read pi's environment, so never there.
 *   The bridge sends each problem, such as a server that did not start, as a `notify` with a
 *   fixed prefix. pi emits it before it reads the prompt.
 * - **Project chats:** the extension in pi-context-filter.ts removes from pi's prompt each
 *   instruction file above the project folder, such as the vault's map (#702). It gets the
 *   folder in a variable, which it deletes at start, and sends a problem as a `notify` too.
 * - **Stop:** Eva sends pi an RPC abort. If the turn has not ended after a grace time, Eva stops
 *   the process tree. A model call that ends at its deadline relies on this too.
 * - **Exit code:** ignored after the turn end. pi on Windows can crash on exit after a tool
 *   ran, with the session file complete.
 * - **Command-line flags only:** RPC commands such as `set_model` and `set_auto_retry` write
 *   the person's global pi settings, so Eva never sends them.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  lostHistoryPreamble,
  modelTierName,
  type ApprovalAnswer,
  type EnginePort,
  type ModelAlias,
  type TurnRequest,
} from "../../shared/engine-port.ts";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { wallRefusesCall } from "../../shared/path-area.ts";
import type { EngineEventPayload, TaskState, TurnUsage } from "../../shared/events.ts";
import type { EnginePermissions, PermissionContext } from "../../shared/permissions.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import {
  decideOutwardAction,
  outwardDenyMessage,
  summarizeToolCall,
  toolCategory,
} from "../../shared/outward-actions.ts";
import { toolInputText, toolOutputText } from "../../shared/tool-details.ts";
import { approvalExtensionSource, approvalReasonTitle, approvalTitle } from "./pi-approval-extension.ts";
import { questionExtensionSource, questionTitle } from "./pi-question-extension.ts";
import { subagentExtensionSource, subagentTitle } from "./pi-subagent-extension.ts";
import { askInTextMessage, collectAnswers } from "../../shared/questions.ts";
import { describePiContext } from "./pi-context.ts";
import { describePiPermissions } from "./pi-permissions.ts";
import { contextExtensionSource, contextNoticePrefix, projectFolderVariable } from "./pi-context-extension.ts";
import { mcpExtensionSource, mcpNoticePrefix, mcpServersFileVariable } from "./pi-mcp-extension.ts";
import { systemPiProcessStarter, type PiProcess, type PiProcessStarter } from "./pi-process.ts";
import { lastAnswerEntryId, writeBranchFile } from "./pi-session-files.ts";

export interface PiEngineOptions {
  /** The command that starts pi, such as `["pi"]`. */
  readonly command: readonly string[];
  /** Eva's own pi folder in the instance home: session files, prompts and the extension. */
  readonly workFolder: string;
  /** The pi model for each of Eva's model names; null for pi's own default. */
  readonly models: Readonly<Record<ModelAlias, string | null>>;
  readonly start?: PiProcessStarter;
  readonly newSessionId?: () => string;
  readonly now?: () => Date;
  readonly closeTimeoutMs?: number;
  /** How long pi has to answer a stop before Eva stops its process. */
  readonly stopGraceMs?: number;
  /** Subagents of one turn that run at once (#824). Default: 4. */
  readonly maxSubagents?: number;
  /** The wait before a refused round of background results goes again (#843). Default: 1 s. */
  readonly backgroundRetryMs?: number;
  /** The longest wait for `pi auth check` after a failed turn. */
  readonly loginCheckMs?: number;
}

interface PiMessage {
  readonly role?: string;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly model?: string;
  /** The provider that answered, such as `openai-codex`: its login is the one to check after a failure. */
  readonly provider?: string;
  readonly usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly cost?: { readonly total?: number };
  };
}

type TurnEnd = { readonly kind: "finished" } | { readonly kind: "failed"; readonly reason: string };

const promptRequestId = "eva-prompt";
const settleRequestId = "eva-settle";
/** The new round that gives pi the results of its background subagents (#843). */
const backgroundRequestId = "eva-background";
/** How often a refused round of background results goes again before the turn fails. */
const maxBackgroundRetries = 3;
/** Asks pi for its state after a good turn: pi names the context window there, not in its turn events. */
const stateRequestId = "eva-state";
/** Extension dialogs that wait for an answer; Eva answers the ones that are not hers with a cancel. */
const answeredDialogMethods: readonly string[] = ["confirm", "select", "input", "editor"];

export class PiEngine implements EnginePort {
  readonly name = "pi" as const;
  private readonly options: PiEngineOptions;

  constructor(options: PiEngineOptions) {
    this.options = options;
  }

  describePermissions(context: PermissionContext): EnginePermissions {
    return describePiPermissions(context);
  }

  describeContext(input: EngineContextInput): ContextPart[] {
    return describePiContext(input);
  }

  runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    return this.turn(request, false);
  }

  /** One pi turn. A subagent's turn gets no subagents and no question form of its own (#824). */
  private async *turn(request: TurnRequest, subagent: boolean): AsyncIterable<EngineEventPayload> {
    const sessionsFolder = join(this.options.workFolder, "sessions");
    mkdirSync(sessionsFolder, { recursive: true });
    const sessionFile = (id: string): string => join(sessionsFolder, `${id}.jsonl`);

    let engineSessionId: string;
    let historyLost: boolean;
    if (request.history.kind === "fork") {
      engineSessionId = (this.options.newSessionId ?? (() => crypto.randomUUID()))();
      historyLost = !writeBranchFile({
        sourceFile: sessionFile(request.history.fromEngineSessionId),
        atEntryId: request.history.atMessageId,
        targetFile: sessionFile(engineSessionId),
        cwd: request.startFolder,
        headerId: crypto.randomUUID(),
        now: (this.options.now ?? (() => new Date()))(),
      });
    } else {
      engineSessionId = request.history.engineSessionId;
      historyLost = request.history.kind === "continue" && !existsSync(sessionFile(engineSessionId));
    }
    // Lesson 46: the turn still runs, in a fresh conversation, and the person and the model are told.
    if (historyLost) yield { kind: "history_lost" };
    const prompt = historyLost ? lostHistoryPreamble + request.prompt : request.prompt;
    const model = this.options.models[request.model];
    // With no --model flag, pi goes on with the model that the session last used, not the new tier.
    if (model === null && request.previousModel !== undefined && request.previousModel !== request.model) {
      const tier = modelTierName(request.model);
      yield {
        kind: "notice",
        text:
          `pi has no model for the ${tier} tier, so this answer can come from the chat's last model. ` +
          `Choose a pi model for ${tier} in Settings, under Engines, pi.`,
      };
    }

    const extensionFile = this.writeIfChanged("eva-approval-extension.ts", approvalExtensionSource);
    // A model call has no session to continue, so its prompt file is named by its text, and calls share it.
    // A subagent's turn is never continued either, so its file is shared the same way.
    const promptName =
      request.mode === "model-call" || subagent
        ? `${subagent ? "subagent" : "model-call"}-${createHash("sha256")
            .update(request.appendSystemPrompt ?? "")
            .digest("hex")
            .slice(0, 16)}`
        : engineSessionId;
    const promptFile =
      request.appendSystemPrompt === null
        ? null
        : this.writeIfChanged(join("prompts", `${promptName}.md`), request.appendSystemPrompt);
    const hasMcpServers = Object.keys(request.mcpServers).length > 0;
    const mcpExtensionFile = hasMcpServers ? this.writeIfChanged("eva-mcp-extension.ts", mcpExtensionSource) : null;
    // A Project chat hides each instruction file above its project folder, such as the vault's map (#702).
    const contextExtensionFile =
      request.projectFolder === null ? null : this.writeIfChanged("eva-context-extension.ts", contextExtensionSource);
    // Claude Code's question form, in an Assistant chat (#813). A Project chat is pi as the person runs it.
    // A subagent's answer goes to its chat's model, never to the person, so it asks no question form.
    const assistant = request.mode === "assistant" && !subagent;
    const questionExtensionFile = assistant
      ? this.writeIfChanged("eva-question-extension.ts", questionExtensionSource)
      : null;
    // Claude Code's subagents, in an Assistant chat (#824). A subagent starts none of its own.
    const subagentExtensionFile = assistant
      ? this.writeIfChanged("eva-subagent-extension.ts", subagentExtensionSource)
      : null;
    // One file per turn: a stopped turn that still closes must not delete the file of the next one.
    const specsFile = hasMcpServers
      ? join(this.options.workFolder, "mcp-servers", `${engineSessionId}-${crypto.randomUUID()}.json`)
      : null;
    const args = buildPiArguments(request, {
      sessionFile: subagent ? null : sessionFile(engineSessionId),
      sessionsFolder,
      extensionFile,
      mcpExtensionFile,
      contextExtensionFile,
      questionExtensionFile,
      subagentExtensionFile,
      promptFile,
      model,
    });
    if (specsFile !== null) {
      try {
        mkdirSync(dirname(specsFile), { recursive: true });
        // A new name for each turn, so no atomic rename, and no temporary copy of the secrets can stay.
        writeFileSync(specsFile, JSON.stringify(request.mcpServers), { mode: 0o600, flag: "wx" });
      } catch (error) {
        removeSpecs(specsFile);
        yield {
          kind: "turn_failed",
          reason: `Eva could not write the MCP server list: ${error instanceof Error ? error.message : String(error)}`,
        };
        return;
      }
    }
    let pi: PiProcess;
    try {
      pi = (this.options.start ?? systemPiProcessStarter)([...this.options.command, ...args], {
        cwd: request.startFolder,
        environment: {
          ...request.environment,
          ...(specsFile === null ? {} : { [mcpServersFileVariable]: specsFile }),
          ...(request.projectFolder === null ? {} : { [projectFolderVariable]: request.projectFolder }),
        },
      });
    } catch (error) {
      removeSpecs(specsFile);
      yield {
        kind: "turn_failed",
        reason: `pi could not start: ${error instanceof Error ? error.message : String(error)}`,
      };
      return;
    }

    const state = { closed: false };
    const close = (timeoutMs: number): Promise<void> => {
      state.closed = true;
      // A failed stop must not replace the turn's one end event, or reject with nobody to catch it.
      return pi.close(timeoutMs).catch(() => undefined);
    };
    // A stuck pi never answers the abort and never ends its records, so only a hard stop ends the turn.
    let hardStop: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      pi.send({ type: "abort" });
      hardStop ??= setTimeout(() => {
        void close(0);
      }, this.options.stopGraceMs ?? 15_000);
    };
    request.signal.addEventListener("abort", onAbort);
    if (request.signal.aborted) onAbort();
    try {
      // Not a spread: a process can be a class, whose methods a spread drops.
      const tracked: PiProcess = {
        send: (record) => {
          pi.send(record);
        },
        records: pi.records,
        close,
        stderrTail: () => pi.stderrTail(),
      };
      yield* this.streamTurn(tracked, { ...request, prompt }, engineSessionId, sessionFile(engineSessionId));
    } finally {
      clearTimeout(hardStop);
      // A caller that leaves the stream early, such as a model call at its deadline, ends it at a
      // yield, before streamTurn closes pi. A pi left open waits on stdin for good.
      if (!state.closed) void close(0);
      request.signal.removeEventListener("abort", onAbort);
      // The bridge deletes the file at start. This covers a pi that stopped before it.
      removeSpecs(specsFile);
    }
  }

  private async *streamTurn(
    pi: PiProcess,
    request: TurnRequest,
    engineSessionId: string,
    file: string,
  ): AsyncIterable<EngineEventPayload> {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let costUsd = 0;
    let contextTokens: number | null = null;
    let contextWindow: number | null = null;
    let model: string | null = null;
    let provider: string | null = null;
    let answers = 0;
    // True from the start of an answer until its first text piece.
    let messageStarts = false;
    let pendingError: string | null = null;
    let end: TurnEnd | null = null;
    // The run ended well; the turn ends with pi's state answer.
    let finished = false;
    // The events of the subagents, which end while pi waits and so reach the stream at pi's next record.
    const side: EngineEventPayload[] = [];
    const subagents: SubagentRuns = {
      emit: (event) => {
        side.push(event);
      },
      count: (subagentUsage, subagentCost) => {
        usage.inputTokens += subagentUsage.inputTokens;
        usage.outputTokens += subagentUsage.outputTokens;
        usage.cacheReadTokens += subagentUsage.cacheReadTokens;
        usage.cacheWriteTokens += subagentUsage.cacheWriteTokens;
        costUsd += subagentCost;
      },
      slots: new Slots(this.options.maxSubagents ?? defaultMaxSubagents),
      ended: new AbortController(),
      running: new Set(),
      background: { pending: 0, results: [], waiting: false, sent: [], retries: 0 },
      deliver: () => {
        const background = subagents.background;
        if (!background.waiting || background.results.length === 0) return;
        background.waiting = false;
        // A stopped turn starts no new round: a closed pi ends the record stream, and so the turn.
        if (request.signal.aborted) {
          void pi.close(0);
          return;
        }
        // Every result that came in meanwhile goes in one message, so they start one round, not one each.
        background.sent = background.results.splice(0);
        pi.send({
          id: backgroundRequestId,
          type: "prompt",
          message: backgroundResultsPreamble + background.sent.join("\n\n"),
        });
      },
    };
    // pi ignores an abort while it waits with no run, so a stop then closes pi and ends the turn at once.
    const stopWaiting = (): void => {
      if (!subagents.background.waiting) return;
      subagents.background.waiting = false;
      subagents.ended.abort();
      void pi.close(0);
    };
    request.signal.addEventListener("abort", stopWaiting);

    pi.send({ id: promptRequestId, type: "prompt", message: request.prompt });
    for await (const record of pi.records) {
      yield* side.splice(0);
      const type = record["type"];
      if (type === "agent_start" && request.signal.aborted) {
        // pi drops an abort that comes before the run starts, such as while the MCP bridge loads.
        pi.send({ type: "abort" });
      }
      if (
        type === "response" &&
        record["id"] === backgroundRequestId &&
        record["success"] === false &&
        subagents.background.retries < maxBackgroundRetries
      ) {
        // pi can still be busy just after its run ended, such as with a compaction. The results wait, and go again.
        const background = subagents.background;
        background.retries += 1;
        background.results.unshift(...background.sent);
        background.sent = [];
        background.waiting = true;
        setTimeout(() => {
          subagents.deliver();
        }, this.options.backgroundRetryMs ?? 1_000);
      } else if (
        type === "response" &&
        (record["id"] === promptRequestId || record["id"] === backgroundRequestId) &&
        record["success"] === false
      ) {
        const error = record["error"];
        end = { kind: "failed", reason: typeof error === "string" ? error : "pi refused the message." };
      } else if (type === "response" && record["id"] === settleRequestId && pendingError !== null) {
        end = { kind: "failed", reason: pendingError };
      } else if (type === "response" && record["id"] === stateRequestId && finished) {
        contextWindow = contextWindowOf(record["data"]);
        end = { kind: "finished" };
      } else if (type === "message_start") {
        // The final text joins every text part of a message, so a new message starts the block.
        if ((record["message"] as PiMessage | undefined)?.role === "assistant") messageStarts = true;
      } else if (type === "message_update") {
        const update = record["assistantMessageEvent"] as { type?: unknown; delta?: unknown } | undefined;
        if (update?.type === "text_delta" && typeof update.delta === "string" && update.delta.length > 0) {
          yield { kind: "text_delta", text: update.delta, ...(messageStarts ? { startsBlock: true } : {}) };
          messageStarts = false;
        }
      } else if (type === "message_end") {
        const message = record["message"] as PiMessage | undefined;
        if (message === undefined) continue;
        if (message.role !== "assistant") continue;
        addUsage(usage, message);
        contextTokens = contextOf(message) ?? contextTokens;
        model = message.model ?? model;
        provider = message.provider ?? provider;
        costUsd += message.usage?.cost?.total ?? 0;
        const text = (message.content ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("");
        answers += 1;
        if (text.length > 0) yield { kind: "text", text, messageId: `${engineSessionId}:${String(answers)}` };
      } else if (type === "tool_execution_start") {
        const name = String(record["toolName"]);
        yield {
          kind: "tool_started",
          toolUseId: String(record["toolCallId"]),
          name,
          category: toolCategory(name),
          summary: summarizeToolCall(name, record["args"]),
          input: toolInputText(record["args"]),
        };
      } else if (type === "tool_execution_end") {
        const result = record["result"] as { content?: unknown } | undefined;
        yield {
          kind: "tool_finished",
          toolUseId: String(record["toolCallId"]),
          isError: record["isError"] === true,
          output: toolOutputText(result?.content ?? result),
        };
      } else if (type === "extension_ui_request") {
        const notice = extensionNotice(record);
        if (notice !== null) yield { kind: "notice", text: notice };
        else if (record["method"] === "editor" && record["title"] === subagentTitle)
          this.startSubagent(pi, request, record, subagents);
        else answerDialog(pi, request, record);
        // The task shows at once: pi may send nothing more until a subagent answers.
        yield* side.splice(0);
      } else if (type === "auto_retry_start") {
        pendingError = null;
      } else if (type === "agent_end") {
        const last = [...((record["messages"] ?? []) as PiMessage[])]
          .reverse()
          .find((item) => item.role === "assistant");
        if (last?.stopReason === "error") {
          pendingError = last.errorMessage ?? "The model answered with an error.";
          pi.send({ id: settleRequestId, type: "get_state" });
        } else if (last?.stopReason === "aborted") {
          end = { kind: "failed", reason: "The turn was stopped." };
        } else if (subagents.background.pending > 0 || subagents.background.results.length > 0) {
          // The model answered, but background subagents still work: pi stays open for their results (#843).
          subagents.background.waiting = true;
          subagents.deliver();
        } else {
          finished = true;
          pi.send({ id: stateRequestId, type: "get_state" });
        }
      }
      if (end !== null) break;
    }
    // A pi that ended has nobody to give a subagent's answer to.
    request.signal.removeEventListener("abort", stopWaiting);
    subagents.ended.abort();
    await Promise.allSettled([...subagents.running]);
    yield* side.splice(0);
    // The answers are complete without the state, so a pi that stops before it answers still finished.
    if (end === null && finished) end = { kind: "finished" };
    await pi.close(this.options.closeTimeoutMs ?? 5_000);

    if (request.signal.aborted && end?.kind !== "finished") {
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    } else if (end === null || end.kind === "failed") {
      // pi's error text differs by provider, so pi's own structured check tells a lost login apart (lesson 36).
      const target = this.checkTarget(request, provider);
      const missing = target !== null && (await this.loginMissing(request, target));
      if (request.signal.aborted) {
        yield { kind: "turn_failed", reason: "The turn was stopped." };
      } else if (missing) {
        const name = target[1];
        yield {
          kind: "turn_failed",
          reason: `The pi login of "${name}" expired or is missing. Log in again in Settings, AI engines, pi.`,
          loginExpired: true,
        };
      } else {
        const reason = end?.reason ?? `pi stopped before the turn ended. ${pi.stderrTail().trim()}`.trim();
        yield { kind: "turn_failed", reason };
      }
    } else {
      yield {
        kind: "turn_finished",
        engineSessionId,
        lastMessageId: lastAnswerEntryId(file),
        usage,
        costUsd,
        contextTokens,
        contextWindow,
        model,
      };
    }
  }

  /**
   * Runs one subagent of the Task tool as a fresh pi turn of this engine, and answers pi's dialog
   * with its last answer. The subagent shares the chat's request: its prompt, skills, MCP servers,
   * approvals and stop. Never throws: pi waits for an answer to every dialog.
   */
  private startSubagent(
    pi: PiProcess,
    request: TurnRequest,
    record: Readonly<Record<string, unknown>>,
    runs: SubagentRuns,
  ): void {
    const id = record["id"];
    if (typeof id !== "string") return;
    const answer = (reply: { result: string } | { failed: string }): void => {
      // A pi that ended, as after a hard stop, has no stdin: an answer then reaches nobody.
      if (runs.ended.signal.aborted) return;
      try {
        pi.send({ type: "extension_ui_response", id, value: JSON.stringify(reply) });
      } catch {
        // The same: a write to a pi that just died. The turn ends with pi's own end.
      }
    };
    // Only an Assistant chat loads the tool. Nobody waits for a model call's subagents.
    if (request.mode !== "assistant") {
      answer({ failed: "This chat cannot run subagents." });
      return;
    }
    const call = parseSubagentCall(record["prefill"]);
    if (call === null) {
      answer({ failed: "The Task call needs a description and a prompt." });
      return;
    }
    const task = (state: TaskState): void => {
      runs.emit({ kind: "task_changed", taskId: call.toolCallId, description: call.description, state });
    };
    task("running");
    // A background subagent returns at once, and its result comes in a new round of the same pi (#843).
    if (call.background) {
      runs.background.pending += 1;
      answer({ result: backgroundStartedNote });
    }
    const signal = AbortSignal.any([request.signal, runs.ended.signal]);
    const work = runs.slots
      .run(async () => {
        if (signal.aborted) return { failed: "The turn was stopped." };
        let last: string | null = null;
        let failure: string | null = null;
        const turn = this.turn(
          {
            ...request,
            history: { kind: "new", engineSessionId: crypto.randomUUID() },
            prompt: subagentPreamble + call.prompt,
            signal,
          },
          true,
        );
        for await (const event of turn) {
          if (event.kind === "text") last = event.text;
          else if (event.kind === "turn_failed") failure = event.reason;
          else if (event.kind === "turn_finished") runs.count(event.usage, event.costUsd ?? 0);
        }
        if (failure !== null) return { failed: failure };
        return last === null ? { failed: "The subagent gave no answer." } : { result: last };
      })
      .catch((error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) }))
      .then((reply) => {
        const done = "result" in reply;
        task(done ? "done" : "failed");
        if (!call.background) {
          answer(reply);
          return;
        }
        runs.background.pending -= 1;
        const text = "result" in reply ? reply.result : reply.failed;
        runs.background.results.push(`Task "${call.description}" (${done ? "done" : "failed"}):\n${text}`);
        runs.deliver();
      });
    runs.running.add(work);
    void work.finally(() => runs.running.delete(work)).catch(() => undefined);
  }

  /**
   * The target of `pi auth check`: the provider that answered, or the tier's model when pi gave no
   * answer. Null when there is none, or when the turn needs no check: a model call reports no login.
   */
  private checkTarget(request: TurnRequest, provider: string | null): readonly [string, string] | null {
    if (request.mode === "model-call") return null;
    const target = provider ?? this.options.models[request.model];
    // A name that starts with a dash would read as a flag of pi.
    if (target === null || !/^\w[\w./:-]*$/.test(target)) return null;
    return provider === null ? ["--model", target] : ["--provider", target];
  }

  /**
   * Asks `pi auth check` whether pi has a working login for the provider. True only for pi's
   * "credentials not configured": a refresh of an expired subscription login fails that way.
   * Never throws. A check that is slow or stopped counts as a working login.
   */
  private async loginMissing(request: TurnRequest, target: readonly [string, string]): Promise<boolean> {
    let check: PiProcess;
    try {
      check = (this.options.start ?? systemPiProcessStarter)(
        [...this.options.command, "auth", "check", ...target, "--json"],
        { cwd: request.startFolder, environment: request.environment },
      );
    } catch {
      return false;
    }
    const answer = (async (): Promise<boolean> => {
      for await (const record of check.records) {
        if (typeof record["status"] === "string")
          return record["status"] === "not_ready" && record["reason"] === "credentials_not_configured";
      }
      return false;
    })().catch(() => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = (): void => undefined;
    // The check may refresh a subscription login over a slow line, so it gets more time than a close.
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, this.options.loginCheckMs ?? 20_000);
      onAbort = () => {
        resolve(false);
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([answer, late]);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      // A grace time, not a kill: pi may still save a new refresh token, and a kill would lose it.
      await check.close(this.options.closeTimeoutMs ?? 5_000).catch(() => undefined);
    }
  }

  /** Writes a file in the work folder only when its text changed, and returns its path. */
  private writeIfChanged(relativePath: string, text: string): string {
    const path = join(this.options.workFolder, relativePath);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileAtomic(path, text);
    return path;
  }
}

export interface PiArgumentInputs {
  /** Null for a subagent's turn, which nobody continues (#824). */
  readonly sessionFile: string | null;
  readonly sessionsFolder: string;
  readonly extensionFile: string;
  /** Eva's MCP bridge, when the turn has MCP servers. */
  readonly mcpExtensionFile: string | null;
  /** Eva's filter of the instruction files above a Project chat's project folder. */
  readonly contextExtensionFile: string | null;
  /** Eva's question form tool, in an Assistant chat. */
  readonly questionExtensionFile: string | null;
  /** Eva's subagent tool, in an Assistant chat that is not itself a subagent. */
  readonly subagentExtensionFile: string | null;
  readonly promptFile: string | null;
  readonly model: string | null;
}

/** The pi command line for one turn (contract-tested like the Claude Code options). */
export function buildPiArguments(request: TurnRequest, inputs: PiArgumentInputs): string[] {
  const args = [
    "--mode",
    "rpc",
    // A model call and a subagent are never continued, so their text must not stay on disk.
    ...(request.mode === "model-call" || inputs.sessionFile === null
      ? ["--no-session"]
      : // Always a path: a bare name makes pi search every project and ask y/N on stdin.
        ["--session", inputs.sessionFile, "--session-dir", inputs.sessionsFolder]),
    // No update check or telemetry at each start.
    "--offline",
    "-e",
    inputs.extensionFile,
  ];
  if (inputs.mcpExtensionFile !== null) args.push("-e", inputs.mcpExtensionFile);
  if (inputs.contextExtensionFile !== null) args.push("-e", inputs.contextExtensionFile);
  if (inputs.questionExtensionFile !== null) args.push("-e", inputs.questionExtensionFile);
  if (inputs.subagentExtensionFile !== null) args.push("-e", inputs.subagentExtensionFile);
  if (inputs.model !== null) args.push("--model", inputs.model);
  // pi has no level above `xhigh`, so Max asks for pi's highest level.
  if (request.effort !== null) args.push("--thinking", request.effort === "max" ? "xhigh" : request.effort);
  if (request.mode === "model-call") {
    // Eva's own extension still loads with `-e`, so a tool that still appears gets a refusal.
    args.push("--no-extensions", "--no-tools", "--no-skills", "--no-prompt-templates", "--no-context-files");
    if (inputs.promptFile !== null) args.push("--system-prompt", inputs.promptFile);
  } else if (request.mode === "assistant") {
    // Assistant mode has no hooks; pi's hooks are extensions. Eva's own extension still loads.
    args.push("--no-extensions");
    if (inputs.promptFile !== null) args.push("--append-system-prompt", inputs.promptFile);
    for (const folder of request.pluginFolders) args.push("--skill", join(folder, "skills"));
  } else if (!request.trusted || !request.folderHooks) {
    // Project mode on an untrusted clone, or a specialist: none of the folder's own extensions.
    // pi keeps no memory of its own, so `harnessMemory` changes nothing here.
    args.push("--no-extensions");
  }
  return args;
}

/** Never throws: the turn has already ended with one event, and a stuck file never breaks Eva. */
function removeSpecs(file: string | null): void {
  if (file === null) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // Windows can hold a file for a moment. The file stays in the instance home, next to secrets.json.
  }
}

/** The text of a problem line from one of Eva's own extensions, or null for any other record. */
function extensionNotice(record: Record<string, unknown>): string | null {
  const message = record["message"];
  if (record["method"] !== "notify" || typeof message !== "string") return null;
  const prefix = [mcpNoticePrefix, contextNoticePrefix].find((candidate) => message.startsWith(candidate));
  return prefix === undefined ? null : message.slice(prefix.length);
}

/**
 * Answers Eva's approval dialog and question form through the person, and cancels any other
 * dialog. Never blocks the stream.
 */
function answerDialog(pi: PiProcess, request: TurnRequest, record: Record<string, unknown>): void {
  const id = record["id"];
  const method = String(record["method"]);
  if (typeof id !== "string" || !answeredDialogMethods.includes(method)) return;
  if (method === "editor" && record["title"] === questionTitle) {
    // A failure in the core must still answer pi: an open dialog holds the turn until a hard stop.
    void answerForm(request, record["prefill"])
      .catch(() => ({ refused: askInTextMessage }))
      .then((reply) => {
        pi.send({ type: "extension_ui_response", id, value: JSON.stringify(reply) });
      });
    return;
  }
  if (method === "editor" && record["title"] === approvalReasonTitle) {
    const call = parseToolCall(record["prefill"]);
    pi.send({ type: "extension_ui_response", id, value: denyReason(request, call.toolName, call.input) });
    return;
  }
  if (method !== "confirm" || record["title"] !== approvalTitle) {
    pi.send({ type: "extension_ui_response", id, cancelled: true });
    return;
  }
  const call = parseToolCall(record["message"]);
  void decide(request, call.toolName, call.input)
    .catch((): ApprovalAnswer => "deny")
    .then((answer) => {
      pi.send({ type: "extension_ui_response", id, confirmed: answer === "allow" });
    });
}

/** The reply to the question tool of pi-question-tool.ts: the answers, or why there are none. */
async function answerForm(
  request: TurnRequest,
  prefill: unknown,
): Promise<{ answers: Readonly<Record<string, string>> } | { refused: string }> {
  // Only an Assistant chat loads the tool, and nobody waits for a question in a model call.
  if (request.mode !== "assistant") return { refused: askInTextMessage };
  let input: unknown;
  try {
    input = JSON.parse(String(prefill));
  } catch {
    return { refused: askInTextMessage };
  }
  if (typeof input !== "object" || input === null) return { refused: askInTextMessage };
  const collected = await collectAnswers(input as Record<string, unknown>, request.askQuestions);
  return collected.kind === "answered" ? { answers: collected.answers } : { refused: collected.message };
}

/** pi's fields that hold a file pattern, by tool. Every path field of every tool is walled. */
const piPatternFields: Readonly<Record<string, readonly string[]>> = { find: ["pattern"], grep: ["glob"] };
/** pi's tools that write a file. A write to the folder's own settings could run code at the next turn. */
const piWriteTools = new Set(["write", "edit"]);
/** pi's tools that only read. Only they open a read-only folder, so an extension's tool cannot write there (#774). */
const piReadTools = new Set(["read", "grep", "find", "ls"]);

function decide(request: TurnRequest, toolName: string, input: Record<string, unknown>): Promise<ApprovalAnswer> {
  // A model call has no tools, and nobody waits for a question.
  if (request.mode === "model-call") return Promise.resolve("deny");
  // A Project chat's file tools may not open a closed folder, such as the vault (#711). pi has no shell wall.
  const wall = request.fileWall;
  const options = {
    patternKeys: piPatternFields[toolName] ?? [],
    write: piWriteTools.has(toolName),
    reads: piReadTools.has(toolName),
    lists: toolName === "ls",
    dropsAt: true,
  };
  if (wall !== null && wallRefusesCall(wall, request.startFolder, input, options)) return Promise.resolve("deny");
  // Project mode is pi exactly as the person runs it, and pi itself asks nothing.
  if (request.mode === "project") return Promise.resolve("allow");
  const decision = decideOutwardAction(toolName, input, request.outwardActionLevels());
  if (decision.level === "deny") return Promise.resolve("deny");
  if (decision.level === "allow") return Promise.resolve("allow");
  return request.requestApproval({
    requestId: "",
    toolName,
    summary: summarizeToolCall(toolName, input),
    ...(decision.categories.length === 0 ? {} : { categories: decision.categories }),
  });
}

/**
 * The reason that the model reads after a call on Deny, or an empty text for any other block. The
 * extension asks for it after a `false` answer: a confirm cannot carry it (see pi-approval-extension.ts).
 */
function denyReason(request: TurnRequest, toolName: string, input: Record<string, unknown>): string {
  if (request.mode !== "assistant") return "";
  const decision = decideOutwardAction(toolName, input, request.outwardActionLevels());
  return decision.level === "deny" ? outwardDenyMessage(decision.categories) : "";
}

function parseToolCall(message: unknown): { toolName: string; input: Record<string, unknown> } {
  try {
    const value = JSON.parse(String(message)) as { toolName?: unknown; input?: unknown };
    return {
      toolName: typeof value.toolName === "string" ? value.toolName : "unknown",
      input: typeof value.input === "object" && value.input !== null ? (value.input as Record<string, unknown>) : {},
    };
  } catch {
    return { toolName: "unknown", input: {} };
  }
}

/** Null when the provider reports no usage, so the web app says "Not known" instead of 0 tokens. */
function contextOf(message: PiMessage): number | null {
  const total = (message.usage?.input ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0);
  return total > 0 ? total : null;
}

/** The context window of pi's current model, from a `get_state` answer; null when pi names none. */
function contextWindowOf(state: unknown): number | null {
  const window = (state as { model?: { contextWindow?: unknown } } | undefined)?.model?.contextWindow;
  return typeof window === "number" && Number.isInteger(window) && window > 0 ? window : null;
}

function addUsage(usage: { -readonly [Key in keyof TurnUsage]: number }, message: PiMessage): void {
  usage.inputTokens += message.usage?.input ?? 0;
  usage.outputTokens += message.usage?.output ?? 0;
  usage.cacheReadTokens += message.usage?.cacheRead ?? 0;
  usage.cacheWriteTokens += message.usage?.cacheWrite ?? 0;
}

/**
 * The line before a subagent's task. The subagent sees none of its chat, and its answer goes to
 * the chat's model, never to the person.
 */
export const subagentPreamble =
  "You are a subagent of an Eva chat. Do the task below, then end your turn with an answer that holds " +
  "the whole result: the chat's model reads it, and the person never sees it. Ask no questions.\n\n";

/** Subagents of one turn that run at once. The others wait for a free place. */
const defaultMaxSubagents = 4;

/** What a turn gives its subagents: where their events go, the turn's totals, and their places. */
interface SubagentRuns {
  readonly emit: (event: EngineEventPayload) => void;
  readonly count: (usage: TurnUsage, costUsd: number) => void;
  readonly slots: Slots;
  /** Aborts when the turn's pi ended: nobody waits for a subagent's answer then. */
  readonly ended: AbortController;
  /** The work of each subagent, which the turn waits for, so no subagent's pi outlives its turn. */
  readonly running: Set<Promise<void>>;
  /** The background subagents: how many still work, their results that wait, and whether pi waits for them. */
  readonly background: {
    pending: number;
    readonly results: string[];
    waiting: boolean;
    /** The results of the last round prompt, which go back to the queue when pi refuses it. */
    sent: string[];
    retries: number;
  };
  /** Gives each waiting result to pi in a new round, once the model's answer ended. */
  readonly deliver: () => void;
}

/** A bound on the work that runs at once. Work past the bound waits, in order. */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[];

  constructor(size: number) {
    this.free = size;
    this.waiting = [];
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1;
    else
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    try {
      return await work();
    } finally {
      // The place passes straight to the next work, so it never counts as free between them.
      const next = this.waiting.shift();
      if (next === undefined) this.free += 1;
      else next();
    }
  }
}

/** The Task call of pi-subagent-tool.ts, or null for an input that Eva cannot run. */
function parseSubagentCall(prefill: unknown): {
  readonly toolCallId: string;
  readonly description: string;
  readonly prompt: string;
  /** Claude Code's run_in_background: the model goes on, and the result comes later (#843). */
  readonly background: boolean;
} | null {
  try {
    const value = JSON.parse(String(prefill)) as { toolCallId?: unknown; input?: unknown };
    const input = (typeof value.input === "object" && value.input !== null ? value.input : {}) as Record<
      string,
      unknown
    >;
    const { description, prompt } = input;
    if (typeof value.toolCallId !== "string" || typeof prompt !== "string" || prompt.trim() === "") return null;
    return {
      toolCallId: value.toolCallId,
      description: typeof description === "string" && description.trim() !== "" ? description : "Subagent",
      prompt,
      background: input["run_in_background"] === true,
    };
  } catch {
    return null;
  }
}

/** The tool's answer to a background Task call: the model goes on, and the result comes later. */
export const backgroundStartedNote =
  "The subagent works in the background. Eva gives you its result in a later message of this turn. " +
  "Go on with other work, or end your answer.";

/** The line before the results of background subagents, in the new round of the model. */
export const backgroundResultsPreamble =
  "(Eva: your background subagents ended. Their results follow. Go on with the task, and answer the person.)\n\n";

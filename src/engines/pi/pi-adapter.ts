/**
 * The pi engine (docs/plan.md §7, ADR 0006): one `pi --mode rpc` child process per turn,
 * started on the turn's session file. Facts come from captured pi 0.73.1 output
 * (test/fixtures/pi/, docs/spikes.md "pi RPC").
 *
 * - **Session handle:** Eva's engine session id names the file `<sessions>/<id>.jsonl`, so
 *   Eva knows the handle before the first turn (lesson 44).
 * - **Fork:** Eva writes the branch file herself (see pi-session-files.ts).
 * - **Turn end:** `agent_end` is final unless the last answer failed with a retryable error.
 *   pi emits `auto_retry_start` in the same tick as `agent_end`, so a `get_state` answer that
 *   arrives first means that no retry follows.
 * - **Approvals:** the extension in pi-approval-extension.ts asks before each tool call; the
 *   shared outward-action rule decides.
 * - **Exit code:** ignored after the turn end. pi on Windows can crash on exit after a tool
 *   ran, with the session file complete (spike).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalAnswer, EnginePort, ModelAlias, TurnRequest } from "../../shared/engine-port.ts";
import type { EngineEventPayload, TurnUsage } from "../../shared/events.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { reachesOtherPeople, summarizeToolCall } from "../../shared/outward-actions.ts";
import { approvalExtensionSource, approvalTitle } from "./pi-approval-extension.ts";
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
}

interface PiMessage {
  readonly role?: string;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
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
/** Extension dialogs that wait for an answer; Eva answers the ones that are not hers with a cancel. */
const answeredDialogMethods: readonly string[] = ["confirm", "select", "input", "editor"];

export class PiEngine implements EnginePort {
  readonly name = "pi" as const;
  private readonly options: PiEngineOptions;

  constructor(options: PiEngineOptions) {
    this.options = options;
  }

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload> {
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
    // Lesson 46: the turn still runs, in a fresh conversation, and the person is told.
    if (historyLost) yield { kind: "history_lost" };

    const extensionFile = this.writeIfChanged("eva-approval-extension.ts", approvalExtensionSource);
    const promptFile =
      request.appendSystemPrompt === null
        ? null
        : this.writeIfChanged(join("prompts", `${engineSessionId}.md`), request.appendSystemPrompt);
    const args = buildPiArguments(request, {
      sessionFile: sessionFile(engineSessionId),
      sessionsFolder,
      extensionFile,
      promptFile,
      model: this.options.models[request.model] ?? this.options.models.default,
    });
    let pi: PiProcess;
    try {
      pi = (this.options.start ?? systemPiProcessStarter)([...this.options.command, ...args], {
        cwd: request.startFolder,
        environment: request.environment,
      });
    } catch (error) {
      yield {
        kind: "turn_failed",
        reason: `pi could not start: ${error instanceof Error ? error.message : String(error)}`,
      };
      return;
    }

    const onAbort = (): void => {
      pi.send({ type: "abort" });
    };
    request.signal.addEventListener("abort", onAbort);
    try {
      yield* this.streamTurn(pi, request, engineSessionId, sessionFile(engineSessionId));
    } finally {
      request.signal.removeEventListener("abort", onAbort);
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
    let answers = 0;
    let pendingError: string | null = null;
    let end: TurnEnd | null = null;

    pi.send({ id: promptRequestId, type: "prompt", message: request.prompt });
    for await (const record of pi.records) {
      const type = record["type"];
      if (type === "response" && record["id"] === promptRequestId && record["success"] === false) {
        const error = record["error"];
        end = { kind: "failed", reason: typeof error === "string" ? error : "pi refused the message." };
      } else if (type === "response" && record["id"] === settleRequestId && pendingError !== null) {
        end = { kind: "failed", reason: pendingError };
      } else if (type === "message_end") {
        const message = record["message"] as PiMessage | undefined;
        if (message === undefined) continue;
        if (message.role !== "assistant") continue;
        addUsage(usage, message);
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
          summary: summarizeToolCall(name, record["args"]),
        };
      } else if (type === "tool_execution_end") {
        yield { kind: "tool_finished", toolUseId: String(record["toolCallId"]), isError: record["isError"] === true };
      } else if (type === "extension_ui_request") {
        answerDialog(pi, request, record);
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
        } else {
          end = { kind: "finished" };
        }
      }
      if (end !== null) break;
    }
    await pi.close(this.options.closeTimeoutMs ?? 5_000);

    if (end === null) {
      yield { kind: "turn_failed", reason: `pi stopped before the turn ended. ${pi.stderrTail().trim()}`.trim() };
    } else if (end.kind === "failed") {
      yield { kind: "turn_failed", reason: end.reason };
    } else {
      yield {
        kind: "turn_finished",
        engineSessionId,
        lastMessageId: lastAnswerEntryId(file),
        usage,
        costUsd,
      };
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
  readonly sessionFile: string;
  readonly sessionsFolder: string;
  readonly extensionFile: string;
  readonly promptFile: string | null;
  readonly model: string | null;
}

/** The pi command line for one turn (plan §5.1, contract-tested like the Claude Code options). */
export function buildPiArguments(request: TurnRequest, inputs: PiArgumentInputs): string[] {
  const args = [
    "--mode",
    "rpc",
    // Always a path: a bare name makes pi search every project and ask y/N on stdin.
    "--session",
    inputs.sessionFile,
    "--session-dir",
    inputs.sessionsFolder,
    // No update check or telemetry at each start.
    "--offline",
    "-e",
    inputs.extensionFile,
  ];
  if (inputs.model !== null) args.push("--model", inputs.model);
  if (request.mode === "assistant") {
    // Assistant mode has no hooks (D7); pi's hooks are extensions. Eva's own extension still loads.
    args.push("--no-extensions");
    if (inputs.promptFile !== null) args.push("--append-system-prompt", inputs.promptFile);
    for (const folder of request.pluginFolders) args.push("--skill", join(folder, "skills"));
  } else if (!request.trusted) {
    // Project mode on an untrusted clone: none of the clone's own extensions (plan §12).
    args.push("--no-extensions");
  }
  return args;
}

/** Answers Eva's approval dialog through the person, and cancels any other dialog. Never blocks the stream. */
function answerDialog(pi: PiProcess, request: TurnRequest, record: Record<string, unknown>): void {
  const id = record["id"];
  const method = String(record["method"]);
  if (typeof id !== "string" || !answeredDialogMethods.includes(method)) return;
  if (method !== "confirm" || record["title"] !== approvalTitle) {
    pi.send({ type: "extension_ui_response", id, cancelled: true });
    return;
  }
  const call = parseToolCall(record["message"]);
  void decide(request, call.toolName, call.input).then((answer) => {
    pi.send({ type: "extension_ui_response", id, confirmed: answer === "allow" });
  });
}

function decide(request: TurnRequest, toolName: string, input: Record<string, unknown>): Promise<ApprovalAnswer> {
  // Project mode is pi exactly as the person runs it, and pi itself asks nothing (D8).
  if (request.mode === "project" || !reachesOtherPeople(toolName, input)) return Promise.resolve("allow");
  return request.requestApproval({ requestId: "", toolName, summary: summarizeToolCall(toolName, input) });
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

function addUsage(usage: { -readonly [Key in keyof TurnUsage]: number }, message: PiMessage): void {
  usage.inputTokens += message.usage?.input ?? 0;
  usage.outputTokens += message.usage?.output ?? 0;
  usage.cacheReadTokens += message.usage?.cacheRead ?? 0;
  usage.cacheWriteTokens += message.usage?.cacheWrite ?? 0;
}

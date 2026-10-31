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
  modelTierName,
  type ApprovalAnswer,
  type EnginePort,
  type FileWall,
  type ModelAlias,
  type TurnRequest,
} from "../../shared/engine-port.ts";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { isInsideArea, isPatternInsideArea } from "../../shared/path-area.ts";
import type { EngineEventPayload, TurnUsage } from "../../shared/events.ts";
import type { EnginePermissions } from "../../shared/permissions.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { asksThePerson, summarizeToolCall, toolCategory } from "../../shared/outward-actions.ts";
import { toolInputText, toolOutputText } from "../../shared/tool-details.ts";
import { approvalExtensionSource, approvalTitle } from "./pi-approval-extension.ts";
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
}

interface PiMessage {
  readonly role?: string;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly model?: string;
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

  describePermissions(): EnginePermissions {
    return describePiPermissions();
  }

  describeContext(input: EngineContextInput): ContextPart[] {
    return describePiContext(input);
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
    const promptName =
      request.mode === "model-call"
        ? `model-call-${createHash("sha256")
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
    // One file per turn: a stopped turn that still closes must not delete the file of the next one.
    const specsFile = hasMcpServers
      ? join(this.options.workFolder, "mcp-servers", `${engineSessionId}-${crypto.randomUUID()}.json`)
      : null;
    const args = buildPiArguments(request, {
      sessionFile: sessionFile(engineSessionId),
      sessionsFolder,
      extensionFile,
      mcpExtensionFile,
      contextExtensionFile,
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
      yield* this.streamTurn(tracked, request, engineSessionId, sessionFile(engineSessionId));
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
    let answers = 0;
    // True from the start of an answer until its first text piece.
    let messageStarts = false;
    let pendingError: string | null = null;
    let end: TurnEnd | null = null;
    // The run ended well; the turn ends with pi's state answer.
    let finished = false;

    pi.send({ id: promptRequestId, type: "prompt", message: request.prompt });
    for await (const record of pi.records) {
      const type = record["type"];
      if (type === "agent_start" && request.signal.aborted) {
        // pi drops an abort that comes before the run starts, such as while the MCP bridge loads.
        pi.send({ type: "abort" });
      }
      if (type === "response" && record["id"] === promptRequestId && record["success"] === false) {
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
        else answerDialog(pi, request, record);
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
          finished = true;
          pi.send({ id: stateRequestId, type: "get_state" });
        }
      }
      if (end !== null) break;
    }
    // The answers are complete without the state, so a pi that stops before it answers still finished.
    if (end === null && finished) end = { kind: "finished" };
    await pi.close(this.options.closeTimeoutMs ?? 5_000);

    if (end === null && request.signal.aborted) {
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    } else if (end === null) {
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
        contextTokens,
        contextWindow,
        model,
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
  /** Eva's MCP bridge, when the turn has MCP servers. */
  readonly mcpExtensionFile: string | null;
  /** Eva's filter of the instruction files above a Project chat's project folder. */
  readonly contextExtensionFile: string | null;
  readonly promptFile: string | null;
  readonly model: string | null;
}

/** The pi command line for one turn (contract-tested like the Claude Code options). */
export function buildPiArguments(request: TurnRequest, inputs: PiArgumentInputs): string[] {
  const args = [
    "--mode",
    "rpc",
    // A model call is never continued, and its text must not stay on disk.
    ...(request.mode === "model-call"
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

/** pi's file tools, and the fields that name a path or a file pattern. Relative ones start at the chat's folder. */
const piPathFields: Readonly<Record<string, readonly string[]>> = {
  read: ["path"],
  write: ["path"],
  edit: ["path"],
  ls: ["path"],
  find: ["path"],
  grep: ["path"],
};
const piPatternFields: Readonly<Record<string, readonly string[]>> = { find: ["pattern"], grep: ["glob"] };

function isOutsidePiWall(
  wall: FileWall,
  startFolder: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const named = (keys: readonly string[] | undefined): string[] =>
    (keys ?? []).map((key) => input[key]).filter((value): value is string => typeof value === "string" && value !== "");
  return (
    named(piPathFields[toolName]).some((path) => !isInsideArea(wall.area, path, startFolder)) ||
    named(piPatternFields[toolName]).some((pattern) => !isPatternInsideArea(wall.area, pattern, startFolder))
  );
}
function decide(request: TurnRequest, toolName: string, input: Record<string, unknown>): Promise<ApprovalAnswer> {
  // A model call has no tools, and nobody waits for a question.
  if (request.mode === "model-call") return Promise.resolve("deny");
  // A Project chat's file tools stay inside its own folder (#711). pi has no shell wall.
  if (request.fileWall !== null && isOutsidePiWall(request.fileWall, request.startFolder, toolName, input))
    return Promise.resolve("deny");
  // Project mode is pi exactly as the person runs it, and pi itself asks nothing.
  if (request.mode === "project" || !asksThePerson(toolName, input)) return Promise.resolve("allow");
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

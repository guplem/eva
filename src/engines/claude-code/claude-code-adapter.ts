/**
 * The Claude Code engine, through the Claude Agent SDK and the person's own installed
 * `claude`. Two pure parts carry the logic so tests can pin them:
 * the SDK options for each mode, and the map from SDK messages to Eva's events.
 */
import {
  query as sdkQuery,
  type McpServerStatus,
  type Options,
  type SDKMessage,
  type SDKRateLimitInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { dirname, join, resolve } from "node:path";
import type { ApprovalAnswer, EnginePort, TurnRequest } from "../../shared/engine-port.ts";
import { readTextTolerant } from "../../shared/files.ts";
import { asksThePerson, summarizeToolCall, toolCategory } from "../../shared/outward-actions.ts";
import { toolInputText, toolOutputText } from "../../shared/tool-details.ts";
import type {
  ApprovalQuestion,
  EngineEventPayload,
  QuestionAnswer,
  TaskState,
  TurnUsage,
  UsageWindow,
} from "../../shared/events.ts";
import type { EnginePermissions, PermissionContext } from "../../shared/permissions.ts";
import { describeClaudePermissions, type ClaudePermissionMode } from "./claude-code-permissions.ts";

/** The SDK's query, with the one control request that Eva uses. */
type QueryRun = AsyncIterable<SDKMessage> & { mcpServerStatus?: () => Promise<McpServerStatus[]> };
type QueryFunction = (input: { prompt: string; options: Options }) => QueryRun;

/** How the stream checks the start of Eva's own MCP servers. */
export interface McpStartCheck {
  /** The names of Eva's servers. A server of the person's own is not Eva's to report. */
  readonly servers: readonly string[];
  /** The init message has no reason for a failure. This control request has it. */
  readonly status: () => Promise<McpServerStatus[]>;
  readonly waitMs: number;
}

/** The SDK's control request has no time bound of its own, so a slow answer must not hold the turn. */
const mcpStatusWaitMs = 5_000;

export interface ClaudeCodeEngineOptions {
  /** Absolute path of the person's `claude` program. Eva never embeds one. */
  readonly executable: string;
  /** How a chat asks before a tool runs. Default: `auto`. */
  readonly permissionMode?: ClaudePermissionMode;
  readonly query?: QueryFunction;
  readonly newSessionId?: () => string;
}

/**
 * The engine's message when a resumed session no longer exists. The SDK gives no structured
 * field for this case, so the text is the only signal (lessons 36, 46).
 */
const lostHistoryMarker = "No conversation found with session ID";

/**
 * Claude Code's question form. Through the SDK, its answers come only from canUseTool, and an
 * allow with no answers tells the model that the person did not answer (issue #544). So Eva
 * shows the form herself, in every chat, as a terminal shows it with no permission question.
 */
const askUserQuestionTool = "AskUserQuestion";

/** For a form that Eva cannot read or that nobody answered: the question then reaches the person as a reply. */
const askInTextMessage =
  "Eva could not show this question form, or nobody answered it in time. " +
  "Ask the same questions in your reply as plain text, with the options in a numbered list. " +
  "Then end your turn and wait for the person's answer in the chat.";

const lostHistoryPreamble =
  "(The earlier part of this conversation is lost, because the engine no longer has it. Say so if the message refers to it.)\n\n";

export class ClaudeCodeEngine implements EnginePort {
  readonly name = "claude-code" as const;
  private readonly options: ClaudeCodeEngineOptions;

  constructor(options: ClaudeCodeEngineOptions) {
    this.options = options;
  }

  describePermissions(context: PermissionContext): EnginePermissions {
    return describeClaudePermissions(this.options.permissionMode ?? "auto", context);
  }

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    let shown = false;
    let historyLost = false;
    for await (const event of this.runOnce(request)) {
      // A lost history fails before the engine sends anything else, so the retry never repeats shown events.
      historyLost =
        !shown &&
        request.history.kind !== "new" &&
        event.kind === "turn_failed" &&
        event.reason.includes(lostHistoryMarker);
      // The break closes the failed run before the retry starts.
      if (historyLost) break;
      shown = true;
      yield event;
    }
    if (!historyLost) return;
    // Lesson 46: retry once, in a fresh session, and tell the model the history is gone.
    yield { kind: "history_lost" };
    const engineSessionId = (this.options.newSessionId ?? (() => crypto.randomUUID()))();
    yield* this.runOnce({
      ...request,
      history: { kind: "new", engineSessionId },
      prompt: lostHistoryPreamble + request.prompt,
    });
  }

  /** Runs the SDK once and sends each event as it arrives. A thrown SDK error becomes the turn end. */
  private async *runOnce(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    const options: Options = {
      ...buildQueryOptions(request, this.options.executable, this.options.permissionMode),
      canUseTool: async (toolName, input) => {
        // A model call denies every tool, so its questions go to decidePermission and nobody sees them.
        if (toolName === askUserQuestionTool && request.mode !== "model-call") return answerQuestions(request, input);
        const decision = await decidePermission(request, toolName, input);
        return decision === "allow"
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "The person did not allow this action." };
      },
    };
    try {
      const run = (this.options.query ?? sdkQuery)({ prompt: request.prompt, options });
      const status = run.mcpServerStatus?.bind(run) ?? (() => Promise.resolve([]));
      yield* mapSdkMessages(run, { servers: Object.keys(request.mcpServers), status, waitMs: mcpStatusWaitMs });
    } catch (error) {
      yield { kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** The SDK options for one turn. `canUseTool` is added by the engine. */
export function buildQueryOptions(
  request: TurnRequest,
  executable: string,
  permissionMode: ClaudePermissionMode = "auto",
): Options {
  const options: Options = {
    cwd: request.startFolder,
    pathToClaudeCodeExecutable: executable,
    env: { ...request.environment },
    abortController: abortControllerFor(request.signal),
    plugins: request.pluginFolders.map((path) => ({ type: "local" as const, path })),
  };
  const servers = Object.entries(request.mcpServers);
  if (servers.length > 0) {
    options.mcpServers = Object.fromEntries(
      servers.map(([name, server]) => [
        name,
        { type: "stdio" as const, command: server.command, args: [...server.args], env: { ...server.environment } },
      ]),
    );
  }
  if (request.model !== "default") options.model = request.model;
  if (request.effort !== "default") options.effort = request.effort;
  // The pieces only change what the SDK reports to Eva, so Project mode stays a transparent wrapper.
  if (request.mode !== "model-call") options.includePartialMessages = true;

  switch (request.history.kind) {
    case "new":
      options.sessionId = request.history.engineSessionId;
      break;
    case "continue":
      options.resume = request.history.engineSessionId;
      break;
    case "fork":
      options.resume = request.history.fromEngineSessionId;
      options.resumeSessionAt = request.history.atMessageId;
      options.forkSession = true;
      break;
  }

  if (request.mode === "model-call") {
    // The call's text can come from other people, such as a chat message, so the model gets no tool to act with.
    options.systemPrompt = request.appendSystemPrompt ?? "";
    options.tools = [];
    options.settingSources = [];
    options.persistSession = false;
    options.strictMcpConfig = true;
    options.settings = { disableAllHooks: true, autoMemoryEnabled: false };
  } else if (request.mode === "assistant") {
    // Spike S4 (#55): the coding prompt made the assistant save facts to Claude Code's own memory
    // folder, not the vault, and miss notes. Eva's text alone did better. `claude` still adds its identity line.
    options.systemPrompt = request.appendSystemPrompt ?? { type: "preset", preset: "claude_code" };
    options.settingSources = ["user", "project"];
    // A person's own allow rule, such as `Bash(git push:*)`, would skip canUseTool and so Eva's
    // approval. An ask rule always beats an allow rule, so every shell call and every call of
    // Eva's own tools reaches canUseTool, which lets local actions through at once (issue #51).
    // Auto mode's classifier can skip a write in `.eva/`, Eva's own files, and auto mode then fails
    // it with no question. So such a write also reaches canUseTool (issue #428). An Edit rule also covers Write.
    const ask = ["Bash", "Edit(./.eva/**)", ...Object.keys(request.mcpServers).map((name) => `mcp__${name}`)];
    // Claude Code's memory folder stays on one machine, outside the vault, so a fact stored there
    // never reaches the person's other machines (issue #68).
    options.settings = { disableAllHooks: true, autoMemoryEnabled: false, permissions: { ask } };
    setPermissionMode(options, permissionMode);
  } else {
    // Project mode is a transparent wrapper: the same prompt and setting sources as a manual session.
    options.systemPrompt = { type: "preset", preset: "claude_code" };
    options.settingSources = ["user", "project", "local"];
    if (!request.trusted) {
      // An untrusted clone's own settings could allow every tool and skip the person's approval.
      options.settingSources = ["user"];
      // Without the `project` source, Claude Code reads no instruction file, so Eva gives it the same files (issue #535).
      const instructions = instructionFilesText(request.startFolder);
      if (instructions !== null) options.systemPrompt = { type: "preset", preset: "claude_code", append: instructions };
      options.settings = { disableAllHooks: true };
      options.strictMcpConfig = true;
    }
    // A bypass would let an untrusted clone's own text run any tool with no question.
    setPermissionMode(options, request.trusted ? permissionMode : "auto");
  }
  return options;
}

/**
 * The instruction files that Claude Code reads with the `project` source, outermost first, so
 * the nearest file comes last and wins. Claude Code reads each `CLAUDE.md` from the start folder
 * up to the root, and each `AGENTS.md` only when none of those folders has a `CLAUDE.md`.
 * Eva does not follow `@` imports: an untrusted file could import a secret from outside the clone.
 */
function instructionFilesText(startFolder: string): string | null {
  const folders: string[] = [];
  for (let folder = resolve(startFolder); ; folder = dirname(folder)) {
    folders.unshift(folder);
    if (dirname(folder) === folder) break;
  }
  const read = (names: readonly string[]): { path: string; text: string }[] =>
    folders.flatMap((folder) =>
      names.flatMap((name) => {
        const path = join(folder, name);
        const text = readTextTolerant(path)?.trim() ?? "";
        return text.length > 0 ? [{ path, text }] : [];
      }),
    );
  const claudeFiles = read(["CLAUDE.md", join(".claude", "CLAUDE.md")]);
  const files = claudeFiles.length > 0 ? claudeFiles : read(["AGENTS.md"]);
  if (files.length === 0) return null;
  return files
    .map(({ path, text }) => `Contents of ${path} (project instructions, checked into the codebase):\n\n${text}`)
    .join("\n\n");
}

function setPermissionMode(options: Options, mode: ClaudePermissionMode): void {
  options.permissionMode = mode;
  // The SDK refuses the bypass mode without this flag.
  if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
}

/**
 * Maps SDK messages to Eva's events, with one turn end. A background subagent makes the SDK send
 * a result, the subagent's work, and a second turn with its own result (issue #70). So a success
 * ends the turn only when the stream ends. An error result ends it at once. A throw, such as a
 * stop while the subagent works, fails the turn, so the person sees that the rest is lost.
 * With `mcp`, each of Eva's MCP servers that did not start becomes a notice.
 */
export async function* mapSdkMessages(
  messages: AsyncIterable<SDKMessage>,
  mcp: McpStartCheck | null = null,
): AsyncIterable<EngineEventPayload> {
  let finished: Extract<EngineEventPayload, { kind: "turn_finished" }> | null = null;
  for await (const event of mapEachTurn(messages, mcp)) {
    if (event.kind === "turn_finished") {
      finished = event;
      continue;
    }
    yield event;
    if (event.kind === "turn_failed") return;
  }
  if (finished !== null) yield finished;
}

/** Each SDK result becomes a turn end that covers the whole stream so far. */
async function* mapEachTurn(
  messages: AsyncIterable<SDKMessage>,
  mcp: McpStartCheck | null,
): AsyncIterable<EngineEventPayload> {
  // A background subagent's follow-up turn can send its own init, and the person needs one notice.
  let mcpChecked = false;
  // A server that `uvx` downloads on its first start can still connect at init, and fail later.
  let stillStarting: string[] = [];
  // The SDK closes the CLI's stdin at the result of a one-message turn, and a request after that gets
  // no answer. So the second check goes out at the first answer, and the result waits for it.
  let laterStatus: Promise<McpServerStatus[]> | null = null;
  let lastMessageId: string | null = null;
  // True from the start of a text block until its first piece.
  let textBlockStarts = false;
  let contextTokens: number | null = null;
  let answeringModel: string | null = null;
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  // After a refusal, the engine repeats the limit in its own words with a UTC time. Eva's line says it in local time.
  let refused = false;
  // The engine's own line after a failed login says "run /login", a fix that needs a terminal.
  let loginFailed = false;
  for await (const message of messages) {
    switch (message.type) {
      case "assistant": {
        if (mcp !== null && stillStarting.length > 0 && laterStatus === null) laterStatus = boundedStatus(mcp);
        if (message.parent_tool_use_id !== null) break;
        // Each block of one model call comes as its own message with the same usage, so take the last, never a sum.
        // A synthetic message has no usage and no real model, so only a real call names the model.
        const callContext = contextOf(message.message.usage);
        if (callContext !== null) {
          contextTokens = callContext;
          answeringModel = message.message.model;
        }
        if (message.error === "authentication_failed") loginFailed = true;
        if ((refused || loginFailed) && message.message.model === syntheticModel) break;
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.length > 0) {
            lastMessageId = message.uuid;
            yield { kind: "text", text: block.text, messageId: message.uuid };
          } else if (block.type === "tool_use") {
            yield {
              kind: "tool_started",
              toolUseId: block.id,
              name: block.name,
              category: toolCategory(block.name),
              summary: summarizeToolCall(block.name, block.input),
              input: toolInputText(block.input),
            };
          }
        }
        break;
      }
      case "stream_event": {
        // The finished assistant message follows with the whole block, so only text pieces matter here.
        if (message.parent_tool_use_id !== null) break;
        const event = message.event;
        if (event.type === "content_block_start" && event.content_block.type === "text") textBlockStarts = true;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text.length > 0) {
          yield { kind: "text_delta", text: event.delta.text, ...(textBlockStarts ? { startsBlock: true } : {}) };
          textBlockStarts = false;
        }
        break;
      }
      case "user": {
        if (message.parent_tool_use_id !== null || typeof message.message.content === "string") break;
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            yield {
              kind: "tool_finished",
              toolUseId: block.tool_use_id,
              isError: block.is_error === true,
              output: toolOutputText(block.content),
            };
          }
        }
        break;
      }
      case "system": {
        if (message.subtype === "init" && mcp !== null && !mcpChecked) {
          mcpChecked = true;
          const own = message.mcp_servers.filter((server) => mcp.servers.includes(server.name));
          stillStarting = own.filter((server) => server.status === "pending").map((server) => server.name);
          const failed = own.filter(isStartFailure);
          if (failed.length > 0) yield* startNotices(failed, await boundedStatus(mcp));
        }
        const task = taskEvent(message);
        if (task !== null) yield task;
        break;
      }
      case "rate_limit_event": {
        const limit = usageLimitEvent(message.rate_limit_info);
        if (limit !== null) yield limit;
        if (limit?.kind === "usage_limit" && limit.status === "rejected") refused = true;
        break;
      }
      case "result": {
        if (mcp !== null && stillStarting.length > 0) {
          const statuses = await (laterStatus ?? boundedStatus(mcp));
          const late = statuses.filter((status) => stillStarting.includes(status.name));
          stillStarting = [];
          yield* startNotices(late.filter(isStartFailure), statuses);
          for (const server of late.filter((status) => status.status === "pending")) {
            yield {
              kind: "notice",
              text: `Eva could not start the MCP server "${server.name}": it was still starting when the model answered.`,
            };
          }
        }
        if (loginFailed && (message.subtype !== "success" || message.is_error)) {
          yield {
            kind: "turn_failed",
            reason: "The Claude Code login expired. Log in again in Settings, AI engines, Claude Code.",
            loginExpired: true,
          };
          return;
        }
        if (refused && (message.subtype !== "success" || message.is_error)) {
          yield { kind: "turn_failed", reason: "Claude Code refused the turn at the usage limit." };
          return;
        }
        if (message.subtype !== "success") {
          // The SDK throws after an error result, and the lost-history retry needs the failure now.
          yield { kind: "turn_failed", reason: message.errors.join("; ") || message.subtype };
          return;
        }
        // Each result's usage counts only its own turn, but its cost is a running total.
        usage = addUsage(usage, usageOf(message.usage));
        yield {
          kind: "turn_finished",
          engineSessionId: message.session_id,
          lastMessageId,
          usage,
          costUsd: message.total_cost_usd,
          contextTokens,
          contextWindow: contextWindowOf(message.modelUsage, answeringModel),
          model: answeringModel,
        };
        break;
      }
      default:
        break;
    }
  }
}

function isStartFailure(server: { readonly status: string }): boolean {
  return server.status === "failed" || server.status === "needs-auth";
}

/** One notice for each server that did not start. The turn goes on without its tools. */
function* startNotices(
  failed: readonly { readonly name: string; readonly status: string }[],
  statuses: readonly McpServerStatus[],
): Iterable<EngineEventPayload> {
  for (const server of failed) {
    const reason =
      server.status === "needs-auth"
        ? "it needs a login."
        : (statuses.find((status) => status.name === server.name)?.error ?? "Claude Code gave no reason.");
    yield { kind: "notice", text: `Eva could not start the MCP server "${server.name}": ${reason}` };
  }
}

/** Never rejects: a status that fails or never comes only costs the reason. */
async function boundedStatus(mcp: McpStartCheck): Promise<McpServerStatus[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<McpServerStatus[]>((resolve) => {
    timer = setTimeout(() => {
      resolve([]);
    }, mcp.waitMs);
  });
  try {
    return await Promise.race([mcp.status(), timeout]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function taskEvent(message: Extract<SDKMessage, { type: "system" }>): EngineEventPayload | null {
  if (message.subtype === "task_started") {
    return { kind: "task_changed", taskId: message.task_id, description: message.description, state: "running" };
  }
  if (message.subtype === "task_notification") {
    const state: TaskState = message.status === "completed" ? "done" : "failed";
    return { kind: "task_changed", taskId: message.task_id, description: message.summary, state };
  }
  return null;
}

/** The model name of a message that the engine writes itself, with no model call. */
const syntheticModel = "<synthetic>";

const knownWindows: readonly UsageWindow[] = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "overage",
];

/** Null while the window is well inside its limit: the engine sends that state in each turn. */
function usageLimitEvent(info: SDKRateLimitInfo): EngineEventPayload | null {
  if (info.status === "allowed") return null;
  const window =
    info.rateLimitType === "seven_day_overage_included"
      ? "seven_day"
      : (knownWindows.find((known) => known === info.rateLimitType) ?? "other");
  return {
    kind: "usage_limit",
    status: info.status === "rejected" ? "rejected" : "warning",
    window,
    // The engine sends a fraction of the window and a time in Unix seconds.
    usedPercent: finite(info.utilization) ? Math.round(info.utilization * 100) : null,
    resetsAt: finite(info.resetsAt) ? isoTime(info.resetsAt * 1000) : null,
  };
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/** Null for a time out of the Date range, because toISOString throws there and would end the stream. */
function isoTime(ms: number): string | null {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Null for a message with no usage, such as the synthetic message after an API error. */
function contextOf(usage: {
  input_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}): number | null {
  const total = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return total > 0 ? total : null;
}

/**
 * The window of the model that answered. A subagent can use a smaller model, and its window
 * would give a wrong share. So a list that does not name the model gives null.
 */
function contextWindowOf(
  modelUsage: Readonly<Record<string, { readonly contextWindow: number }>> | undefined,
  model: string | null,
): number | null {
  const entries = Object.entries(modelUsage ?? {});
  const entry = entries.length === 1 ? entries[0] : entries.find(([name]) => name === model);
  const window = entry?.[1].contextWindow;
  return typeof window === "number" && window > 0 ? window : null;
}

function usageOf(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}): TurnUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  };
}

function addUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

type ToolDecision =
  { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string };

async function answerQuestions(request: TurnRequest, input: Record<string, unknown>): Promise<ToolDecision> {
  const questions = readQuestions(input);
  if (questions === null) return { behavior: "deny", message: askInTextMessage };
  const outcome = await request.askQuestions(askUserQuestionTool, questions);
  if (outcome === "declined") return { behavior: "deny", message: "The person chose not to answer these questions." };
  if (outcome === "expired" || outcome.length !== questions.length)
    return { behavior: "deny", message: askInTextMessage };
  const answers: Record<string, string> = {};
  for (const [index, question] of questions.entries()) {
    const text = answerText(question, outcome[index]);
    if (text === null) return { behavior: "deny", message: askInTextMessage };
    answers[question.question] = text;
  }
  return { behavior: "allow", updatedInput: { ...input, answers } };
}

/** Null for an input that Eva cannot show as a form. Eva keeps only the fields that she shows. */
function readQuestions(input: Record<string, unknown>): ApprovalQuestion[] | null {
  const raw = input["questions"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: ApprovalQuestion[] = [];
  for (const entry of raw as unknown[]) {
    const question = recordOf(entry);
    const options = question["options"];
    if (typeof question["question"] !== "string" || !Array.isArray(options) || options.length === 0) return null;
    const read = (options as unknown[]).map((option) => {
      const fields = recordOf(option);
      return { label: fields["label"], description: fields["description"] ?? "" };
    });
    if (read.some((option) => typeof option.label !== "string" || typeof option.description !== "string")) return null;
    questions.push({
      question: question["question"],
      header: typeof question["header"] === "string" ? question["header"] : "",
      options: read as { label: string; description: string }[],
      multiSelect: question["multiSelect"] === true,
    });
  }
  // The answers go back by question text, so two equal texts would lose one answer.
  if (new Set(questions.map((question) => question.question)).size !== questions.length) return null;
  return questions;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Claude Code's own form joins several labels with ", ". Null for an answer that does not fit the question. */
function answerText(question: ApprovalQuestion, answer: QuestionAnswer | undefined): string | null {
  const other = answer?.other?.trim() ?? "";
  if (other.length > 0) return other;
  const labels = (answer?.selected ?? []).map((index) => question.options[index]?.label);
  if (labels.length === 0 || labels.some((label) => label === undefined)) return null;
  if (!question.multiSelect && labels.length > 1) return null;
  return labels.join(", ");
}

async function decidePermission(
  request: TurnRequest,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ApprovalAnswer> {
  // A model call has no tools; a tool that still appears gets no question, because nobody waits for one.
  if (request.mode === "model-call") return "deny";
  const summary = summarizeToolCall(toolName, input);
  if (request.mode === "project" || asksThePerson(toolName, input)) {
    return request.requestApproval({ requestId: "", toolName, summary });
  }
  return "allow";
}

export function abortControllerFor(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else
    signal.addEventListener(
      "abort",
      () => {
        controller.abort();
      },
      { once: true },
    );
  return controller;
}

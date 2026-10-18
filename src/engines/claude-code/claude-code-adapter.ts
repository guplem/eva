/**
 * The Claude Code engine, through the Claude Agent SDK and the person's own installed
 * `claude`. Two pure parts carry the logic so tests can pin them:
 * the SDK options for each mode, and the map from SDK messages to Eva's events.
 */
import { query as sdkQuery, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalAnswer, EnginePort, TurnRequest } from "../../shared/engine-port.ts";
import { reachesOtherPeople, summarizeToolCall, toolCategory } from "../../shared/outward-actions.ts";
import type { EngineEventPayload, TaskState, TurnUsage } from "../../shared/events.ts";

type QueryFunction = (input: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeCodeEngineOptions {
  /** Absolute path of the person's `claude` program. Eva never embeds one. */
  readonly executable: string;
  readonly query?: QueryFunction;
  readonly newSessionId?: () => string;
}

/**
 * The engine's message when a resumed session no longer exists. The SDK gives no structured
 * field for this case, so the text is the only signal (lessons 36, 46).
 */
const lostHistoryMarker = "No conversation found with session ID";

const lostHistoryPreamble =
  "(The earlier part of this conversation is lost, because the engine no longer has it. Say so if the message refers to it.)\n\n";

export class ClaudeCodeEngine implements EnginePort {
  readonly name = "claude-code" as const;
  private readonly options: ClaudeCodeEngineOptions;

  constructor(options: ClaudeCodeEngineOptions) {
    this.options = options;
  }

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    let shown = false;
    for await (const event of this.runOnce(request)) {
      // A lost history fails before the engine sends anything else, so the retry never repeats shown events.
      const historyLost =
        !shown &&
        request.history.kind !== "new" &&
        event.kind === "turn_failed" &&
        event.reason.includes(lostHistoryMarker);
      if (!historyLost) {
        shown = true;
        yield event;
        continue;
      }
      // Lesson 46: retry once, in a fresh session, and tell the model the history is gone.
      yield { kind: "history_lost" };
      const engineSessionId = (this.options.newSessionId ?? (() => crypto.randomUUID()))();
      yield* this.runOnce({
        ...request,
        history: { kind: "new", engineSessionId },
        prompt: lostHistoryPreamble + request.prompt,
      });
      return;
    }
  }

  /** Runs the SDK once and sends each event as it arrives. A thrown SDK error becomes the turn end. */
  private async *runOnce(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    const options: Options = {
      ...buildQueryOptions(request, this.options.executable),
      canUseTool: async (toolName, input) => {
        const decision = await decidePermission(request, toolName, input);
        return decision === "allow"
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "The person did not allow this action." };
      },
    };
    try {
      const messages = (this.options.query ?? sdkQuery)({ prompt: request.prompt, options });
      yield* mapSdkMessages(messages);
    } catch (error) {
      yield { kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** The SDK options for one turn. `canUseTool` is added by the engine. */
export function buildQueryOptions(request: TurnRequest, executable: string): Options {
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

  if (request.mode === "assistant") {
    // Spike S4 (#55): the coding prompt made the assistant save facts to Claude Code's own memory
    // folder, not the vault, and miss notes. Eva's text alone did better. `claude` still adds its identity line.
    options.systemPrompt = request.appendSystemPrompt ?? { type: "preset", preset: "claude_code" };
    options.settingSources = ["user", "project"];
    // A person's own allow rule, such as `Bash(git push:*)`, would skip canUseTool and so Eva's
    // approval. An ask rule always beats an allow rule, so every shell call and every call of
    // Eva's own tools reaches canUseTool, which lets local actions through at once (issue #51).
    const ask = ["Bash", ...Object.keys(request.mcpServers).map((name) => `mcp__${name}`)];
    // Claude Code's memory folder stays on one machine, outside the vault, so a fact stored there
    // never reaches the person's other machines (issue #68).
    options.settings = { disableAllHooks: true, autoMemoryEnabled: false, permissions: { ask } };
  } else {
    // Project mode is a transparent wrapper: the same prompt and setting sources as a manual session.
    options.systemPrompt = { type: "preset", preset: "claude_code" };
    options.settingSources = ["user", "project", "local"];
    if (!request.trusted) {
      // An untrusted clone's own settings could allow every tool and skip the person's approval.
      options.settingSources = ["user"];
      options.settings = { disableAllHooks: true };
      options.strictMcpConfig = true;
    }
  }
  return options;
}

/** Maps SDK messages to Eva's events. The stream ends with one turn end when the SDK sends a result. */
export async function* mapSdkMessages(messages: AsyncIterable<SDKMessage>): AsyncIterable<EngineEventPayload> {
  let lastMessageId: string | null = null;
  for await (const message of messages) {
    switch (message.type) {
      case "assistant": {
        if (message.parent_tool_use_id !== null) break;
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
            };
          }
        }
        break;
      }
      case "user": {
        if (message.parent_tool_use_id !== null || typeof message.message.content === "string") break;
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            yield { kind: "tool_finished", toolUseId: block.tool_use_id, isError: block.is_error === true };
          }
        }
        break;
      }
      case "system": {
        const task = taskEvent(message);
        if (task !== null) yield task;
        break;
      }
      case "result": {
        if (message.subtype === "success") {
          yield {
            kind: "turn_finished",
            engineSessionId: message.session_id,
            lastMessageId,
            usage: usageOf(message.usage),
            costUsd: message.total_cost_usd,
          };
        } else {
          yield { kind: "turn_failed", reason: message.errors.join("; ") || message.subtype };
        }
        return;
      }
      default:
        break;
    }
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

async function decidePermission(
  request: TurnRequest,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ApprovalAnswer> {
  const summary = summarizeToolCall(toolName, input);
  if (request.mode === "project" || reachesOtherPeople(toolName, input)) {
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

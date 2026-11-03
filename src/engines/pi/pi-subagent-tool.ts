/**
 * The pi extension that gives a pi Assistant chat subagents, as Claude Code's chats have (#824).
 * pi has no such tool, so this file adds `Task`, with Claude Code's input. Its call opens one
 * `editor` dialog with the title below and `{ toolCallId, input }` as JSON. Eva runs the subagent
 * as a fresh pi turn of her own, so it gets the chat's protections, and answers with JSON:
 * `{ result }`, the subagent's last answer, or `{ failed }` with the reason.
 *
 * pi loads this file as text with `-e` (see pi-subagent-extension.ts), so it imports nothing.
 */

/** The dialog title. pi-subagent-extension.ts holds the same text for Eva. */
export const subagentTitle = "eva-subagent";

const parameters = {
  type: "object",
  properties: {
    description: { type: "string", description: "A short name of the task, in 3 to 5 words." },
    prompt: {
      type: "string",
      description:
        "The whole task for the subagent. It sees none of this chat, so give it every fact it needs, " +
        "and say what its answer must hold.",
    },
  },
  required: ["description", "prompt"],
};

interface ToolResult {
  content: { type: "text"; text: string }[];
  details: Record<string, never>;
}

/** The tool context, as far as the tool reads it, so a test can give its own. */
export interface SubagentContext {
  readonly hasUI: boolean;
  readonly ui: {
    editor(title: string, prefill?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>;
  };
}

/** pi's extension API, as far as the tool calls it, so a test can give its own. */
export interface SubagentPi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      context: SubagentContext,
    ): Promise<ToolResult>;
  }): void;
}

export default function evaSubagents(pi: SubagentPi): void {
  pi.registerTool({
    name: "Task",
    label: "Subagent",
    description:
      "Give a task to a subagent: a new agent with its own context, the same tools and the same rules. " +
      "Use it for work that would fill this context, such as a wide search or one batch of many files. " +
      "Call it several times in one answer to run subagents at once. It answers with the subagent's result.",
    parameters,
    async execute(toolCallId, params, signal, _onUpdate, context) {
      if (!context.hasUI) throw new Error("No client is connected to run a subagent.");
      // A stop of the turn closes the dialog, and Eva stops the subagent with the turn.
      const reply = await context.ui.editor(
        subagentTitle,
        JSON.stringify({ toolCallId, input: params }),
        signal === undefined ? {} : { signal },
      );
      const fields = parse(reply);
      const result = fields?.["result"];
      if (typeof result === "string") return { content: [{ type: "text", text: result }], details: {} };
      // pi marks a tool call as failed only when execute throws.
      const failed = fields?.["failed"];
      throw new Error(typeof failed === "string" && failed !== "" ? failed : "The subagent stopped with no answer.");
    },
  });
}

function parse(reply: string | undefined): Record<string, unknown> | null {
  if (reply === undefined) return null;
  try {
    const value: unknown = JSON.parse(reply);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

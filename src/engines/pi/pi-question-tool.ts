/**
 * The pi extension that gives a pi Assistant chat Claude Code's question form (#813). pi has no
 * such tool, so this file adds `AskUserQuestion`, with Claude Code's name and input. Its call
 * opens one `editor` dialog with the title below and the input as JSON. Eva shows the form to the
 * person and answers with JSON: `{ answers }` by question text, or `{ refused }` with the reason.
 *
 * pi loads this file as text with `-e` (see pi-question-extension.ts), so it imports nothing.
 */

/** The dialog title. pi-question-extension.ts holds the same text for Eva. */
export const questionTitle = "eva-questions";

/** The text that the model gets when nobody answered: the same as askInTextMessage. A test keeps them equal. */
export const noAnswer =
  "Eva could not show this question form, or nobody answered it in time. " +
  "Ask the same questions in your reply as plain text, with the options in a numbered list. " +
  "Then end your turn and wait for the person's answer in the chat.";

const option = {
  type: "object",
  properties: {
    label: { type: "string", description: "The text of the choice, 1 to 5 words." },
    description: { type: "string", description: "What the choice means." },
  },
  required: ["label"],
};

/**
 * Claude Code's input of the tool. Only the parts that Eva needs are required: a model that is not
 * Claude may leave out the rest, and a refused call would cost it a retry. Eva fills in the defaults.
 */
const parameters = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "The whole question, which ends with a question mark." },
          header: { type: "string", description: "A short label of 12 characters at most, such as Format." },
          options: { type: "array", minItems: 1, maxItems: 4, items: option },
          multiSelect: { type: "boolean", description: "True when the person may pick more than one choice." },
        },
        required: ["question", "options"],
      },
    },
  },
  required: ["questions"],
};

interface ToolResult {
  content: { type: "text"; text: string }[];
  details: Record<string, never>;
}

/** The tool context, as far as the tool reads it, so a test can give its own. */
export interface QuestionContext {
  readonly hasUI: boolean;
  readonly ui: {
    editor(title: string, prefill?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>;
  };
}

/** pi's extension API, as far as the tool calls it, so a test can give its own. */
export interface QuestionPi {
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
      context: QuestionContext,
    ): Promise<ToolResult>;
  }): void;
}

export default function evaQuestions(pi: QuestionPi): void {
  pi.registerTool({
    name: "AskUserQuestion",
    label: "Ask the person",
    description:
      "Ask the person 1 to 4 multiple-choice questions, and wait for the answers. Use it when you need a decision " +
      "or a preference to go on. The person can also type an answer of their own.",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, context) {
      if (!context.hasUI) throw new Error(noAnswer);
      // A stop of the turn closes the dialog, as it does for Eva's approvals.
      const reply = await context.ui.editor(
        questionTitle,
        JSON.stringify(params),
        signal === undefined ? {} : { signal },
      );
      const fields = parse(reply);
      const answers = fields?.["answers"];
      if (typeof answers === "object" && answers !== null && !Array.isArray(answers)) {
        // JSON, so a quote inside a question or an answer cannot make the text read two ways.
        return {
          content: [
            {
              type: "text",
              text: `The person answered your questions, as JSON by question: ${JSON.stringify(answers)}. Go on with these answers.`,
            },
          ],
          details: {},
        };
      }
      // pi marks a tool call as failed only when execute throws.
      const refused = fields?.["refused"];
      throw new Error(typeof refused === "string" && refused !== "" ? refused : noAnswer);
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

/** The rules of the conversation view that need no React: the step line, the faces and the chips. */
import type { EffortLevel, EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import type { TurnStep } from "../../../shared/turn-steps.ts";
import type { RetryUndoPreview } from "./api.ts";
import type { IconName } from "./icons.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";

/**
 * The bubble shows the last message in full. Every other step goes in the step list, in order,
 * so an earlier message is one line there.
 */
export function foldSteps(steps: readonly TurnStep[]): {
  listed: readonly TurnStep[];
  lastMessage: TurnStep | undefined;
} {
  const last = steps.findLastIndex((step) => step.kind === "message");
  if (last === -1) return { listed: steps, lastMessage: undefined };
  return { listed: steps.filter((_, index) => index !== last), lastMessage: steps[last] };
}

const kindIcons: Readonly<Record<TurnStep["kind"], IconName>> = {
  message: "chat",
  command: "term",
  tool: "bolt",
  task: "sync",
};

export function stepIcon(step: TurnStep): IconName {
  return step.isError ? "x" : kindIcons[step.kind];
}

const kindActions: Readonly<Record<TurnStep["kind"], string>> = {
  message: "Message",
  command: "Command",
  tool: "Tool",
  task: "Task",
};

/**
 * What a step did, for its pill, and what it did it to, as plain text. A tool step reads
 * "Read /path", so its first word is the tool. A step stored before the name came first starts
 * with JSON, so it falls back to its kind.
 */
export function stepParts(step: TurnStep): { action: string; detail: string } {
  if (step.kind !== "tool" || step.text.startsWith("{")) return { action: kindActions[step.kind], detail: step.text };
  const space = step.text.indexOf(" ");
  const name = space === -1 ? step.text : step.text.slice(0, space);
  const detail = space === -1 ? "" : step.text.slice(space + 1);
  return { action: name.split("__").at(-1) ?? name, detail };
}

/**
 * Where a step comes from, for the step dialog: the whole tool name, and what gave the tool.
 * A command keeps no tool name. A stored tool step that starts with JSON has no name either.
 */
export function stepOrigin(step: TurnStep): { tool: string | null; from: string } | null {
  if (step.kind === "command") return { tool: null, from: "The shell" };
  if (step.kind !== "tool" || step.text.startsWith("{")) return null;
  const tool = step.text.split(" ", 1)[0] ?? step.text;
  const server = /^mcp__(.+?)__/.exec(tool)?.[1];
  return { tool, from: server === undefined ? "The engine" : `The MCP server ${server}` };
}

/**
 * The input of a tool as named fields, so the dialog shows a command whole and once. The
 * description goes on its own line. An input that is no JSON object gives null.
 */
export function inputFields(
  input: string | undefined,
): { description: string | null; fields: { key: string; value: string }[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input ?? "");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  const description = entries.find(([key, value]) => key === "description" && typeof value === "string")?.[1];
  return {
    description: typeof description === "string" ? description : null,
    fields: entries
      .filter(([key, value]) => !(key === "description" && typeof value === "string"))
      .map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value, null, 2) })),
  };
}

/** Only a tool or a command has an input and an output for the step dialog. */
export function hasToolDetails(step: TurnStep): boolean {
  return step.kind === "tool" || step.kind === "command";
}

/** The state word of the step dialog. A word, so a failed step shows by more than colour. */
export function stepState(step: TurnStep, live: boolean): "Running" | "Done" | "Failed" {
  if (step.isError) return "Failed";
  return live && hasToolDetails(step) && step.output === undefined ? "Running" : "Done";
}

export function missingDetail(part: "input" | "output", live: boolean): string {
  return part === "output" && live ? "The tool still runs." : `Eva kept no ${part} for this step.`;
}

/** "8 s", "2 min 5 s": the time of a running turn. */
export function elapsedText(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const rest = seconds % 60;
  return `${String(Math.floor(seconds / 60))} min${rest === 0 ? "" : ` ${String(rest)} s`}`;
}

/** The visor beside a running answer. */
export function liveFace(hasText: boolean, mode: "assistant" | "project"): Face {
  if (!hasText) return stateFaces.thinking;
  return mode === "project" ? stateFaces.projectWork : stateFaces.idle;
}

const engineLabels: Readonly<Record<EngineName, string>> = { "claude-code": "Claude Code", pi: "pi" };

export function engineLabel(engine: EngineName): string {
  return engineLabels[engine];
}

/**
 * The model chip. With the default model, the engine login picks the model, so the chip names the
 * model that answered once a turn says it.
 */
export function modelLabel(model: ModelAlias, answered: string | null = null): string {
  if (answered === null) return model === "default" ? "Default model" : capitalized(model);
  return model === "default" ? `Default · ${modelName(answered)}` : modelName(answered);
}

/** "claude-opus-5-5" reads "Opus 5.5". Another engine's id, such as a pi model, stays as it is. */
function modelName(id: string): string {
  // A date, such as the one in "claude-opus-4-20250514", has more digits than a minor version.
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=-|\[|$)/.exec(id);
  if (match === null) return id;
  const [, family = "", major = "", minor] = match;
  return `${capitalized(family)} ${major}${minor === undefined ? "" : `.${minor}`}`;
}

function capitalized(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

const effortNames: Readonly<Record<EffortLevel, string>> = {
  default: "Default",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function effortName(effort: EffortLevel): string {
  return effortNames[effort];
}

export function effortLabel(effort: EffortLevel): string {
  return `${effortName(effort)} effort`;
}

/** The model that answered the newest turn that names one, or null before the first answer. */
export function answeredModel(turns: readonly { readonly model: string | null }[]): string | null {
  return turns.findLast((turn) => turn.model !== null)?.model ?? null;
}

/**
 * Why the chips cannot change the engine and model, or null when they can. A model belongs to a
 * conversation (lesson 41), and a fork continues its chat's engine session.
 */
export function chipLock(
  session: { readonly parentId: string | null; readonly turns: readonly unknown[] },
  busy: boolean,
): string | null {
  if (session.parentId !== null) return "A fork keeps the engine and model of its chat.";
  if (session.turns.length > 0 || busy)
    return "The engine and model are fixed after the first message. Start a new chat to change them.";
  return null;
}

/** A sent message whose stored turn has not come yet, and the turn count when it was sent. */
export interface PendingMessage {
  readonly text: string;
  readonly turnCount: number;
}

/**
 * The text of the sent message to show, or null. The stored turn arrives one render before an
 * effect can clear the pending message, so the turn count hides it in that render.
 */
export function shownPending(pending: PendingMessage | null, turnCount: number): string | null {
  return pending !== null && pending.turnCount === turnCount ? pending.text : null;
}

/** The empty message box names who answers: Eva in an Assistant chat, the project's harness in a project chat. */
export function composerPlaceholder(projectTitle: string | null): string {
  return `Message ${projectTitle ?? "Eva"}`;
}

/**
 * The title of the question before a retry, or null to retry at once. Eva asks only when a file
 * can go back: with none, Undo and Keep would do the same.
 */
export function undoQuestion(preview: RetryUndoPreview): string | null {
  if (preview.restore.length === 0) return null;
  return preview.answers > 1
    ? "Undo the changes of this answer and the later ones?"
    : "Undo the changes of this answer?";
}

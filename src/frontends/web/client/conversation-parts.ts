/** The rules of the conversation view that need no React: the step line, the faces and the chips. */
import { modelTierName, type EffortLevel, type EngineName, type ModelAlias } from "../../../shared/engine-port.ts";
import type { TurnStep } from "../../../shared/turn-steps.ts";
import type { UndoPreview } from "./api.ts";
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
  message: "eve",
  command: "term",
  tool: "bolt",
  task: "sync",
};

export function stepIcon(step: TurnStep): IconName {
  return step.isError ? "x" : kindIcons[step.kind];
}

/** A message in the step list is the agent's own words, so it shows without a pill, beside the face of Eva. */
export function stepHasPill(step: TurnStep): boolean {
  return step.kind !== "message";
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
export function stepState(step: TurnStep, live: boolean): "Running" | "Done" | "Failed" | "Started" {
  if (step.isError) return "Failed";
  // The Project chat of project work goes on after the answer, so the answer cannot know its end.
  if (step.chatId !== undefined) return "Started";
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

/** The model chip. A tier runs a newer model over time, so the chip also names the one that answered. */
export function modelLabel(model: ModelAlias, answered: string | null = null): string {
  return answered === null ? modelTierName(model) : `${modelTierName(model)} · ${modelName(answered)}`;
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

/**
 * The model that answered the newest turn that names one, or null before the first answer. After a
 * change of model, the old answer names the wrong model, so it is null until the new model answers.
 */
export function answeredModel(
  turns: readonly { readonly model: string | null; readonly modelAlias?: ModelAlias | undefined }[],
  model: ModelAlias,
): string | null {
  const newest = turns.findLast((turn) => turn.model !== null);
  // A turn from before the stored choice has none: the chat could not change its model then.
  if (newest === undefined || (newest.modelAlias !== undefined && newest.modelAlias !== model)) return null;
  return newest.model;
}

/** Why the chip cannot change the engine, or null when it can. A fork continues its chat's engine session. */
export function engineLock(
  session: { readonly parentId: string | null; readonly turns: readonly unknown[] },
  busy: boolean,
): string | null {
  if (session.parentId !== null) return "A fork keeps the engine of its chat.";
  if (session.turns.length > 0 || busy)
    return "The engine is fixed after the first message. Start a new chat to change it.";
  return null;
}

/**
 * The note under the model choices, or null. A running turn keeps its model. A chat with a history
 * loses the cache when its model changes (lesson 41), so the person learns the cost before the change.
 */
export function modelNote(
  session: { readonly parentId: string | null; readonly turns: readonly unknown[] },
  busy: boolean,
): string | null {
  if (busy) return "Change the model when this answer ends.";
  if (session.turns.length > 0 || session.parentId !== null)
    return "A new model reads the whole chat again, so the next answer is slower and costs more.";
  return null;
}

/** A sent message whose stored turn has not come yet. It shows while the stored turns are at most `turnCount`. */
export interface PendingMessage {
  readonly text: string;
  readonly turnCount: number;
}

/**
 * The stored turn count that a new message waits beyond. Eva gathers the messages sent before a
 * turn starts into that turn. A message sent while a turn runs goes into the turn after it.
 */
export function sentTurnCount(turnCount: number, turnRunning: boolean): number {
  return turnRunning ? turnCount + 1 : turnCount;
}

/**
 * The stored turn count at which every started turn is stored, or null when no turn runs. The live
 * steps end a moment before the list brings the stored turn, so a turn runs until its stored turn
 * arrives. Each start of the live steps is one more turn. The list can also bring a turn before its
 * live steps end, and then nothing runs after them.
 */
export function runningUntil(until: number | null, wasLive: boolean, live: boolean, turnCount: number): number | null {
  const next = live && !wasLive ? Math.max(until ?? 0, turnCount) + 1 : until;
  return next !== null && turnCount >= next ? null : next;
}

/**
 * The words that a screen reader says once when a turn ends, after a change of the running state.
 * A new turn clears them, so the same words at the next end are a change that the reader says again.
 */
export function turnEndNotice(wasRunning: boolean, running: boolean, current: string): string {
  if (wasRunning === running) return current;
  return running ? "" : "The turn ended.";
}

/**
 * True when the chat shows the working card and Stop. A sent message waits for the next turn, so it
 * shows the card once no turn runs: at once after an idle send, and for a queued message once the
 * turn before it is stored, while Eva still saves the vault. In the moment before that stored turn
 * arrives the card is off, so the next turn starts its own clock.
 */
export function isWorking(chat: {
  readonly live: boolean;
  readonly turnRuns: boolean;
  readonly pending: readonly PendingMessage[];
  readonly turnCount: number;
}): boolean {
  if (chat.live) return true;
  return !chat.turnRuns && chat.pending.some((message) => message.turnCount === chat.turnCount);
}

/**
 * The sent messages whose stored turn has not come yet, so the view shows them. The stored turn
 * arrives one render before an effect can clear its message, so the turn count hides it in that render.
 */
export function keptPending(pending: readonly PendingMessage[], turnCount: number): readonly PendingMessage[] {
  return pending.filter((message) => message.turnCount >= turnCount);
}

/** Closer to the bottom than this counts as "at the bottom", so a new message scrolls into view. */
const stickToBottomPx = 80;

/** Where the chat view is scrolled: the scroll top, the whole height and the visible height. */
export interface ScrollPlace {
  readonly top: number;
  readonly height: number;
  readonly visible: number;
}

/**
 * True when the view must follow the newest message after a scroll. A move up of the person stops
 * the follow, so they can read while an answer streams. A move up that comes with new content
 * height is the browser's, such as at a switch of chat, so it keeps the follow. Shorter content can
 * pull the view up to the very bottom, and that keeps the follow too.
 */
export function followsBottom(
  following: boolean,
  previous: { readonly top: number; readonly height: number },
  place: ScrollPlace,
): boolean {
  const distance = place.height - place.top - place.visible;
  if (distance <= 1) return true;
  if (place.top < previous.top && place.height === previous.height) return false;
  return following || distance < stickToBottomPx;
}

/**
 * True when a render scrolls the view to the newest message. A render can come between a drag and
 * its scroll event, so a finger on the chat pauses the snap. The scroll itself then decides the follow.
 */
export function snapsToBottom(following: boolean, fingerDown: boolean): boolean {
  return following && !fingerDown;
}

/** The parts of a key press in the message box that decide a send. */
export interface ComposerKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
}

/** The code that a browser gives a key press that an input method handles. */
const inputMethodKeyCode = 229;

/**
 * True when a key press sends the message. On a touch screen, Enter starts a new line and the Send
 * button sends. An Enter that picks the word of an input method, such as for Japanese, must not send.
 */
export function sendsOnEnter(press: ComposerKey, touchScreen: boolean): boolean {
  if (press.key !== "Enter" || press.shiftKey || touchScreen) return false;
  return !press.isComposing && press.keyCode !== inputMethodKeyCode;
}

/**
 * The text of the message box after a failed send. The person gets the message back, and keeps
 * what they typed during the send after it.
 */
export function restoredText(failed: string, typedSince: string): string {
  return typedSince.trim() === "" ? failed : `${failed}\n\n${typedSince}`;
}

/** The empty message box names who answers: Eva in an Assistant chat, the project's harness in a project chat. */
export function composerPlaceholder(projectTitle: string | null): string {
  return `Message ${projectTitle ?? "Eva"}`;
}

/**
 * The title of the question before a retry, or null to retry at once. Eva asks only when a file
 * can go back: with none, Undo and Keep would do the same.
 */
export function undoQuestion(preview: UndoPreview): string | null {
  if (preview.restore.length === 0) return null;
  return preview.answers > 1
    ? "Undo the changes of this answer and the later ones?"
    : "Undo the changes of this answer?";
}

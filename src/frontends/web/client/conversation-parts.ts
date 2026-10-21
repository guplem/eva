/** The rules of the conversation view that need no React: the step line, the faces and the chips. */
import type { EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import type { TurnStep } from "../../../shared/turn-steps.ts";
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

export function modelLabel(model: ModelAlias): string {
  return model === "default" ? "Default model" : `${model.charAt(0).toUpperCase()}${model.slice(1)}`;
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

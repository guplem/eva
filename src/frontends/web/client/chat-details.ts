/** The figures of the chat panel. */
import type { TurnStep } from "../../../shared/turn-steps.ts";
import type { SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";

/** "25.4k tokens": short enough for the panel. */
export function formatTokens(count: number): string {
  if (count < 1000) return `${String(count)} tokens`;
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
}

/**
 * The context of the newest answer in the chat and its forks, or null when its engine did not
 * say. An older number would look current, so a failed newest answer gives null too.
 */
export function latestContext(sessions: readonly Pick<SessionRecord, "turns">[]): number | null {
  const turns = sessions.flatMap((session) => session.turns);
  // Turns keep only their time, not a sequence number, so the time orders them.
  const newest = turns.reduce<(typeof turns)[number] | undefined>(
    (found, candidate) => (found === undefined || candidate.at > found.at ? candidate : found),
    undefined,
  );
  return newest?.contextTokens ?? null;
}

/**
 * The tasks of a stored answer, from its steps. Each one ended with its turn; a step keeps
 * only an error, so "ended" covers done and stopped alike.
 */
export function tasksOfTurn(steps: readonly TurnStep[], sessionId: string): LiveState["tasks"] {
  const tasks: Record<string, LiveState["tasks"][string]> = {};
  for (const step of steps) {
    if (step.kind !== "task" || step.id === null) continue;
    tasks[step.id] = { description: step.text, state: step.isError ? "failed" : "ended", sessionId };
  }
  return tasks;
}

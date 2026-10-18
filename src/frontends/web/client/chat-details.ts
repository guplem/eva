/** The figures of the chat panel. */
import type { SessionRecord } from "./api.ts";

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

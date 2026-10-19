/**
 * The session list that the web app fetches after each turn and on each reconnect. Each turn
 * keeps up to 100 steps, so a long chat would make each fetch grow without a limit (issue 121).
 */
import type { SessionRecord } from "../../core/sessions/session-store.ts";

/** Enough answers to scroll back through. An older answer shows its whole text, as one from before steps. */
export const recentTurnsWithSteps = 10;

/** The sessions with the steps of their last turns only. The store keeps every step. */
export function withRecentSteps(sessions: readonly SessionRecord[], recentTurns: number): SessionRecord[] {
  return sessions.map((session) => {
    const firstKept = session.turns.length - recentTurns;
    if (firstKept <= 0) return session;
    return {
      ...session,
      turns: session.turns.map((turn, index) => (index < firstKept ? { ...turn, steps: [], omittedSteps: 0 } : turn)),
    };
  });
}

/** A listed session, and whether a turn runs in it now. The store keeps no such field. */
export type ListedSession = SessionRecord & { readonly running: boolean };

/** A reload or a reconnect loses the events, so the list itself says which chats work now. */
export function withRunState(sessions: readonly SessionRecord[], isRunning: (id: string) => boolean): ListedSession[] {
  return sessions.map((session) => ({ ...session, running: isRunning(session.id) }));
}

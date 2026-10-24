/**
 * The answers that a retry undoes (#525): every Assistant turn of the chat tree that ended at or
 * after the retried turn. Every chat shares the one vault, so a later answer in a fork counts too.
 */
import { turnSnapshotRef, type UndoAnswer } from "../vault/vault-snapshots.ts";
import type { SessionRecord } from "./session-store.ts";

/** The answers to undo, oldest first. Empty for a Project chat or a turn that does not exist. */
export function answersToUndo(sessions: readonly SessionRecord[], sessionId: string, turnIndex: number): UndoAnswer[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const session = byId.get(sessionId);
  const retried = session?.turns[turnIndex];
  if (session === undefined || retried === undefined || session.mode !== "assistant") return [];
  const root = rootId(byId, session);
  const later: { sessionId: string; turnIndex: number; at: string }[] = [];
  for (const candidate of sessions) {
    if (candidate.mode !== "assistant" || rootId(byId, candidate) !== root) continue;
    for (const [index, turn] of candidate.turns.entries()) {
      if (turn.at >= retried.at) later.push({ sessionId: candidate.id, turnIndex: index, at: turn.at });
    }
  }
  later.sort((left, right) => (left.at === right.at ? left.turnIndex - right.turnIndex : left.at < right.at ? -1 : 1));
  return later.map((turn) => ({
    before: turnSnapshotRef(turn.sessionId, turn.turnIndex, "before"),
    after: turnSnapshotRef(turn.sessionId, turn.turnIndex, "after"),
  }));
}

function rootId(byId: ReadonlyMap<string, SessionRecord>, session: SessionRecord): string {
  let root = session;
  // The bound stops a loop of parents, which only a damaged file can hold.
  for (let depth = 0; root.parentId !== null && depth < 1000; depth += 1) {
    const parent = byId.get(root.parentId);
    if (parent === undefined) break;
    root = parent;
  }
  return root.id;
}

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
  const later: { sessionId: string; turnIndex: number; order: number; at: string; chatCreatedAt: string }[] = [];
  for (const candidate of sessions) {
    if (candidate.mode !== "assistant" || rootId(byId, candidate) !== root) continue;
    for (const [index, turn] of candidate.turns.entries()) {
      // In the chat itself, the order of its turns decides: two turns can end in the same second.
      const isLater = candidate.id === sessionId ? index >= turnIndex : turn.at >= retried.at;
      // A turn that a delete moved keeps the snapshot names of the place where it ran (issue 647).
      if (isLater)
        later.push({
          sessionId: turn.ranIn?.sessionId ?? candidate.id,
          turnIndex: turn.ranIn?.turnIndex ?? index,
          order: index,
          at: turn.at,
          chatCreatedAt: candidate.createdAt,
        });
    }
  }
  // The end time has whole seconds at best. On a tie, a fork made later ran later.
  later.sort(
    (left, right) =>
      left.at.localeCompare(right.at) ||
      left.chatCreatedAt.localeCompare(right.chatCreatedAt) ||
      left.order - right.order,
  );
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

/** The snapshot refs of a deleted chat that a moved turn of another chat still names (issue 647). */
export function refsStillNamed(sessions: readonly SessionRecord[], deletedId: string): Set<string> {
  const refs = new Set<string>();
  for (const session of sessions)
    for (const turn of session.turns)
      if (turn.ranIn?.sessionId === deletedId)
        for (const moment of ["before", "after"] as const)
          refs.add(turnSnapshotRef(deletedId, turn.ranIn.turnIndex, moment));
  return refs;
}

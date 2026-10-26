/** Marks the open chat as seen, so the chat list of every device stops showing it as unread (issue 381). */
import { useEffect } from "react";
import { api, type SessionRecord } from "./api.ts";
import { hasUnseenTurns } from "./branch-path.ts";

/**
 * Marks each unseen turn of the open chat and its forks as seen while the page is in view. A page
 * in the background, or a list that covers the chat on a phone, shows no answer, so it marks nothing.
 * The core then tells every device, which fetches the list again.
 */
export function useMarkSeen(tree: readonly SessionRecord[], shown: boolean): void {
  // A string, so the effect runs again only when a new turn ends, not at each render.
  const unseen = JSON.stringify(tree.filter(hasUnseenTurns).map((session) => [session.id, session.turns.length]));
  useEffect(() => {
    const marks = JSON.parse(unseen) as [string, number][];
    if (!shown || marks.length === 0) return undefined;
    const mark = (): void => {
      if (document.visibilityState !== "visible") return;
      for (const [sessionId, turnCount] of marks) {
        // A failed mark keeps the chat unread, and the next visit tries again: no error is worth a toast.
        api.markSeen(sessionId, turnCount).catch(() => undefined);
      }
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [unseen, shown]);
}

/**
 * The turns of the open chat and its forks. The chat list holds no turns, so a long history keeps
 * it small (#1046). The page reads each chat of the open tree on its own, and reads it again only
 * when the list says that its turns changed.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type ListedSession, type OpenedSession } from "./api.ts";
import { type ChatToRead, chatsToRead, emptyChats, type KeptTurns, openedTree } from "./opened-tree.ts";

/** After a failed read, the page tries again after this wait. */
const retryMs = 3000;

/**
 * Each chat that the page opened since it loaded. A chat that opens again shows its turns at
 * once, and the page reads only a newer version.
 */
const keptTurns = new Map<string, KeptTurns>();
/** The chats that a read is open for, so two renders never read one chat twice. */
const reading = new Set<string>();
/** Each open tree hears each finished read, also one that another view started. */
const listeners = new Set<() => void>();
/** The one planned try after a failed read. Module-wide, so no view's change can drop it. */
let retry: ReturnType<typeof setTimeout> | null = null;

function tellListeners(): void {
  for (const hear of listeners) hear();
}

/** The open tree with its turns, or null while they load. */
export function useOpenedTree(tree: readonly ListedSession[]): OpenedSession[] | null {
  const [kept, setKept] = useState<ReadonlyMap<string, KeptTurns>>(() => new Map(keptTurns));
  useEffect(() => {
    const hear = (): void => setKept(new Map(keptTurns));
    listeners.add(hear);
    return () => {
      listeners.delete(hear);
    };
  }, []);
  // Strings, so a render starts no read. A read that lands changes `kept`, and the next read starts.
  const empty = JSON.stringify(emptyChats(tree, kept).map((session) => [session.id, session.turnsKey]));
  const wanted = JSON.stringify(chatsToRead(tree, kept));
  useEffect(() => {
    const chats = JSON.parse(empty) as [string, string][];
    if (chats.length === 0) return;
    for (const [sessionId, key] of chats) {
      if (!keptTurns.has(sessionId)) keptTurns.set(sessionId, { key, readFor: key, turns: [] });
    }
    tellListeners();
  }, [empty]);
  useEffect(() => {
    for (const { id: sessionId, listKey } of JSON.parse(wanted) as ChatToRead[]) {
      if (reading.has(sessionId)) continue;
      reading.add(sessionId);
      api
        .session(sessionId)
        .then(
          (opened) => {
            keptTurns.set(sessionId, { key: opened.turnsKey, readFor: listKey, turns: opened.turns });
            tellListeners();
          },
          () => {
            // A deleted chat leaves the list, and then the tree. Any other failure tries again.
            retry ??= setTimeout(() => {
              retry = null;
              tellListeners();
            }, retryMs);
          },
        )
        .finally(() => reading.delete(sessionId));
    }
  }, [wanted, kept]);
  return useMemo(() => openedTree(tree, kept), [tree, kept]);
}

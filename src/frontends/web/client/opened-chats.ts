/**
 * The turns of the open chat and its forks. The chat list holds no turns, so a long history keeps
 * it small (#1046). The page reads each chat of the open tree on its own, and reads it again only
 * when the list says that its turns changed.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type ListedSession, type OpenedSession, type SessionRecord } from "./api.ts";

/** The turns of one chat, with the key of the read and the list key that started the read. */
export interface KeptTurns {
  readonly key: string;
  /**
   * The list's key when the read started. The core can change a chat after the list, so a read can
   * bring a newer key than the list. The page then waits for the next list, and does not read again.
   */
  readonly readFor: string;
  readonly turns: SessionRecord["turns"];
}

/** A chat to read, with the list's key for it. */
export interface ChatToRead {
  readonly id: string;
  readonly listKey: string;
}

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

/**
 * The tree with the facts of the list and the kept turns. Null until each chat has turns, so
 * the page shows no half tree. Older turns stay while the newer ones load: the answer does not blink.
 */
export function openedTree(
  tree: readonly ListedSession[],
  kept: ReadonlyMap<string, KeptTurns>,
): OpenedSession[] | null {
  const opened: OpenedSession[] = [];
  for (const session of tree) {
    // A new chat or fork has no turn to read, so it shows at once.
    const turns = session.turnCount === 0 ? [] : kept.get(session.id)?.turns;
    if (turns === undefined) return null;
    opened.push({ ...session, turns });
  }
  return opened;
}

/** The chats of the tree with no kept turns, or with turns that changed since the page read them. */
export function chatsToRead(tree: readonly ListedSession[], kept: ReadonlyMap<string, KeptTurns>): ChatToRead[] {
  return tree
    .filter((session) => {
      const known = kept.get(session.id);
      if (session.turnCount === 0) return false;
      return known === undefined || (known.key !== session.turnsKey && known.readFor !== session.turnsKey);
    })
    .map((session) => ({ id: session.id, listKey: session.turnsKey }));
}

/**
 * The chats of the tree that have no turn and nothing kept. The page keeps an empty entry for
 * each, so its first answer replaces no shown chat with a skeleton while the page reads it.
 */
export function emptyChats(tree: readonly ListedSession[], kept: ReadonlyMap<string, KeptTurns>): ListedSession[] {
  return tree.filter((session) => session.turnCount === 0 && !kept.has(session.id));
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

/**
 * The turns of the open chat and its forks. The chat list holds no turns, so a long history keeps
 * it small (#1046). The page reads each chat of the open tree on its own, and reads it again only
 * when the list says that its turns changed.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type ListedSession, type OpenedSession, type SessionRecord } from "./api.ts";

/** The turns of one chat, with the key that the list gave them. */
export interface KeptTurns {
  readonly key: string;
  readonly turns: SessionRecord["turns"];
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
export function chatsToRead(tree: readonly ListedSession[], kept: ReadonlyMap<string, KeptTurns>): string[] {
  return tree
    .filter((session) => session.turnCount > 0 && kept.get(session.id)?.key !== session.turnsKey)
    .map((session) => session.id);
}

/** The open tree with its turns, or null while they load. */
export function useOpenedTree(tree: readonly ListedSession[]): OpenedSession[] | null {
  const [kept, setKept] = useState<ReadonlyMap<string, KeptTurns>>(() => new Map(keptTurns));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const hear = (): void => setKept(new Map(keptTurns));
    listeners.add(hear);
    return () => {
      listeners.delete(hear);
    };
  }, []);
  // A string, so a render starts no read. A read that lands with an old key changes `kept`, and the next read starts.
  const wanted = chatsToRead(tree, kept).join(" ");
  useEffect(() => {
    if (wanted === "") return undefined;
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    for (const sessionId of wanted.split(" ")) {
      if (reading.has(sessionId)) continue;
      reading.add(sessionId);
      api
        .session(sessionId)
        .then(
          (opened) => {
            keptTurns.set(sessionId, { key: opened.turnsKey, turns: opened.turns });
            for (const hear of listeners) hear();
          },
          () => {
            // A deleted chat leaves the list, and then the tree. Any other failure tries again.
            if (current && retry === undefined) retry = setTimeout(() => setAttempt((count) => count + 1), retryMs);
          },
        )
        .finally(() => reading.delete(sessionId));
    }
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [wanted, kept, attempt]);
  return useMemo(() => openedTree(tree, kept), [tree, kept]);
}

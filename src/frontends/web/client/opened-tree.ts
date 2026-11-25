/**
 * The pure part of the open tree: which chats to read, and the tree with their turns. It imports
 * no code from `api.ts`, so a unit test covers it without a fake network (#1046).
 */
import type { ListedSession, OpenedSession, SessionRecord } from "./api.ts";

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

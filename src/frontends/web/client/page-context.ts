/**
 * What the pages of one chat share (#1130): the page that the chat pins, the way to pin one, and a
 * count that grows after each turn and each Save. Each frame loads its page again when the count
 * grows, so a page that Eva changed shows its new version by itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface ChatPageState {
  /** The vault path of the saved page that the chat pins, or null. */
  readonly pinned: string | null;
  /** Pins a page by its marker path, or unpins with null. Null in a chat that pins nothing, such as a Project chat. */
  readonly onPin: ((path: string | null) => Promise<void>) | null;
  /** Grows when a page may have changed. */
  readonly version: number;
  /** Tells every frame of the chat that a page moved, such as after Save or Remove. */
  readonly onChanged: () => void;
}

export const ChatPages = createContext<ChatPageState>({
  pinned: null,
  onPin: null,
  version: 0,
  onChanged: () => undefined,
});

export function useChatPages(): ChatPageState {
  return useContext(ChatPages);
}

/**
 * The state of the pages of one chat. `turns` names the stored turns of the chat and its forks: when
 * it changes, a turn ended, and each frame loads its page again.
 */
export function useChatPageState(turns: string, pinned: string | null, onPin: ChatPageState["onPin"]): ChatPageState {
  const [version, setVersion] = useState(0);
  const onChanged = useCallback(() => setVersion((count) => count + 1), []);
  const seenTurns = useRef(turns);
  useEffect(() => {
    if (seenTurns.current === turns) return;
    seenTurns.current = turns;
    onChanged();
  }, [turns, onChanged]);
  return useMemo(() => ({ pinned, onPin, version, onChanged }), [pinned, onPin, version, onChanged]);
}

/** True when the pin names the file that a frame shows. Windows and macOS ignore the case of a path. */
export function isPinned(pinned: string | null, shownPath: string): boolean {
  return pinned !== null && pinned.toLowerCase() === shownPath.toLowerCase();
}

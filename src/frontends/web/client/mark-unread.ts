/** "Mark as unread" for a chat or a fork, in each of their menus (#1101). */
import { createContext, useContext } from "react";
import { api } from "./api.ts";
import { canMarkUnread, type UnseenFacts } from "./branch-path.ts";
import { useShowError } from "./error-toast.tsx";
import type { MenuItem } from "./Menu.tsx";

/**
 * Leaves the open chat when its page shows the answer that the person marks as unread. The page would
 * otherwise mark it as seen again at once. Each view that shows a chat gives its own way out.
 */
export const LeaveMarkedChat = createContext<(sessionId: string) => void>(() => undefined);

/** The item for a branch, or no item when the mark would change nothing. Spread it into a menu. */
export function useMarkUnreadItem(): (branch: { readonly id: string } & UnseenFacts) => MenuItem[] {
  const leave = useContext(LeaveMarkedChat);
  const showError = useShowError();
  return (branch) =>
    canMarkUnread(branch)
      ? [
          {
            label: "Mark as unread",
            icon: "bell",
            onChoose: () => {
              // First, so the open page cannot mark the answer as seen again while the request runs. The leave
              // makes a new history entry at once, before the closing menu takes its own entry away.
              leave(branch.id);
              api.markUnread(branch.id).catch((caught: unknown) => showError(caught));
            },
          },
        ]
      : [];
}

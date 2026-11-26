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
              // After the request, as Archive does: the closing menu steps back in the history first.
              api
                .markUnread(branch.id)
                .then(() => leave(branch.id))
                .catch((caught: unknown) => showError(caught));
            },
          },
        ]
      : [];
}

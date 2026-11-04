/**
 * The context menu of a chat message (#863): Copy on every message, and the answer's own actions,
 * such as Retry and Fork, on an answer of Eva. A right click or a long press opens it.
 */
import { useState, type ReactElement } from "react";
import { copyText } from "./CopyButton.tsx";
import { useShowError } from "./error-toast.tsx";
import { useContextMenu, type ContextMenuProps, type MenuItem } from "./Menu.tsx";
import { Toast } from "./Toast.tsx";

/** Spread `props` on the message, and draw `parts` next to it. */
export function useMessageMenu(
  text: string,
  label: string,
  actions: readonly MenuItem[] = [],
): { readonly props: ContextMenuProps; readonly parts: ReactElement } {
  const showError = useShowError();
  // A count, so a second copy starts the toast again.
  const [copies, setCopies] = useState(0);
  const items: MenuItem[] = [
    // An answer that failed before its first message has no text, so it has no Copy button either.
    ...(text === ""
      ? []
      : [
          {
            label: "Copy",
            icon: "copy" as const,
            onChoose: () => {
              copyText(text)
                .then(() => setCopies((count) => count + 1))
                .catch((caught: unknown) => showError(caught));
            },
          },
        ]),
    ...actions,
  ];
  const { props, menu } = useContextMenu(items, label);
  const parts = (
    <>
      {menu}
      {copies > 0 && <Toast key={copies} message="Copied." onClose={() => setCopies(0)} />}
    </>
  );
  return { props, parts };
}

/**
 * The shared dialog: a modal box with a close button. A computer always shows a box, and a phone
 * shows the form that `phoneDialogForm` picks. Escape and the Back button close only the top dialog.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { useBackLayer } from "./back-layer-hook.ts";

/**
 * The form of every dialog on a phone: a bottom sheet that slides up from the bottom, or the
 * same centred box as on a computer. Change this one value to change all of them.
 */
export const phoneDialogForm: "sheet" | "box" = "sheet";

/** The classes of the scrim of every dialog, also of each dialog that builds its own box. */
export function dialogBackdropClass(extra?: string): string {
  return ["dialog-backdrop", phoneDialogForm === "sheet" ? "phone-sheet" : "", extra ?? ""]
    .filter((name) => name !== "")
    .join(" ");
}

export function Dialog({
  label,
  onClose,
  scrimCloses = false,
  closeLabel = "Close",
  closeDisabled = false,
  back = true,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  /** Such as "Cancel", when the dialog asks the person to confirm something. */
  readonly closeLabel?: string;
  /** True while the dialog waits for work that it cannot stop, so the close button is off. */
  readonly closeDisabled?: boolean;
  /** True for a dialog that only shows information, so a tap beside it loses nothing. */
  readonly scrimCloses?: boolean;
  /** False for a dialog that the Back button itself opens, such as the unsaved changes question. */
  readonly back?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useBackLayer(back, () => {
    if (!closeDisabled) onClose();
  });
  useEffect(() => {
    close.current?.focus();
    // An Escape that opened this dialog, such as in a rename field, must not close it at once.
    const openedAt = performance.now();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.timeStamp < openedAt) return;
      // One Escape closes only the top dialog, such as the unsaved changes question over a form.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== box.current) return;
      // The schedule forms listen on the window, after the document: they must not close too.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={dialogBackdropClass()}
      // A tap on the scrim closes the dialog; a tap inside it does not.
      onClick={scrimCloses ? (event) => event.target === event.currentTarget && onClose() : undefined}
    >
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
        <div className="message-actions">
          <button ref={close} onClick={onClose} disabled={closeDisabled}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

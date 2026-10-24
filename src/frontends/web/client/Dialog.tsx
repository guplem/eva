/**
 * The shared dialog: a modal box with a close button, or a bottom sheet on a phone. Escape closes
 * only the top dialog.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

export function Dialog({
  label,
  onClose,
  sheet = false,
  closeLabel = "Close",
  closeDisabled = false,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  /** Such as "Cancel", when the dialog asks the person to confirm something. */
  readonly closeLabel?: string;
  /** True while the dialog waits for work that it cannot stop, so the close button is off. */
  readonly closeDisabled?: boolean;
  /** A bottom sheet, which slides up from the bottom of a phone screen. */
  readonly sheet?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    close.current?.focus();
    // An Escape that opened this dialog, such as in a rename field, must not close it at once.
    const openedAt = performance.now();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.timeStamp < openedAt) return;
      // One Escape closes only the top dialog, such as the unsaved changes question over a form.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== box.current) return;
      // The sheets listen on the window, after the document: they must not close too.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={sheet ? "dialog-backdrop sheet-backdrop" : "dialog-backdrop"}
      // A tap on the scrim closes the sheet; a tap inside it does not.
      onClick={sheet ? (event) => event.target === event.currentTarget && onClose() : undefined}
    >
      <div ref={box} className={sheet ? "dialog sheet" : "dialog"} role="dialog" aria-modal="true" aria-label={label}>
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

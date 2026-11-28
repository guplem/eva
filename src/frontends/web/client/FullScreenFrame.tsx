/**
 * The full-screen layer of a sandboxed frame: a widget of the home page (#691) or a page of a chat
 * answer (#1129). Back, Escape or the corner button closes it. It goes to the end of the body, so no
 * ancestor, such as a chat bubble that scrolls or moves, clips it or turns its place.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "./back-layer-hook.ts";
import { Icon } from "./icons.tsx";

export function FullScreenFrame({
  label,
  onClose,
  actions,
  children,
}: {
  /** The name of the dialog for a screen reader: the widget's or the page's name. */
  readonly label: string;
  readonly onClose: () => void;
  /** More corner buttons, before the close button. */
  readonly actions?: ReactNode;
  /** The frame. */
  readonly children: ReactNode;
}): ReactElement {
  useBackLayer(true, onClose, "widget-full");
  const close = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  useEffect(() => {
    // A modal dialog takes the focus, and gives it back to the button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeNow.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected === true) opener.focus();
    };
  }, []);
  return createPortal(
    <div className="widget-full" role="dialog" aria-modal="true" aria-label={label}>
      {children}
      <div className="frame-corner">
        {actions}
        <button
          ref={close}
          type="button"
          className="icon-button widget-full-button"
          aria-label="Close full screen"
          onClick={onClose}
        >
          <Icon name="shrink" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

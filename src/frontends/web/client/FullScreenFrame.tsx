/**
 * The full-screen layer of a sandboxed frame: a widget of the home page (#691) or a page of a chat
 * answer (#1129). Back or the corner button closes it. It goes to the end of the body, so no
 * ancestor, such as a chat bubble that scrolls or moves, clips it or turns its place.
 */
import type { ReactElement, ReactNode } from "react";
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
  return createPortal(
    <div className="widget-full" role="dialog" aria-modal="true" aria-label={label}>
      {children}
      <div className="frame-corner">
        {actions}
        <button
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

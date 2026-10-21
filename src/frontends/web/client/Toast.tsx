/**
 * The one toast of the page: a short message at the bottom of the screen, with up to two buttons.
 * Every toast that can close shows a ring around its close button. The ring empties, and the toast
 * closes when it is empty. A pointer on the toast, or the keyboard focus in it, stops the ring.
 */
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons.tsx";
import { toastVisibleMs } from "./toast-timing.ts";

interface ToastProps {
  readonly message: string;
  /** No role for a part that has its own, such as a progress bar. */
  readonly role?: "status" | "alert" | "alertdialog" | null;
  readonly label?: string;
  readonly actions?: ReactNode;
  /** A part in place of the plain message, such as a progress bar. */
  readonly children?: ReactNode;
  /** With no close, the toast stays until its owner removes it, as for a wait. */
  readonly onClose?: () => void;
  readonly closeLabel?: string;
}

export function Toast({
  message,
  role = "status",
  label,
  actions,
  children,
  onClose,
  closeLabel = "Close the message",
}: ToastProps): ReactElement {
  const visibleMs = toastVisibleMs(message, actions !== undefined);
  return createPortal(
    <div className="toast" role={role ?? undefined} aria-label={label}>
      <div className="toast-text">{children ?? message}</div>
      {actions !== undefined && <div className="toast-actions">{actions}</div>}
      {onClose !== undefined && (
        <button className="toast-close" aria-label={closeLabel} onClick={onClose}>
          <svg className="toast-timer" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="toast-timer-track" cx="18" cy="18" r="16" pathLength={100} />
            {/* The key restarts the ring when the same toast gets a new message. */}
            <circle
              key={message}
              className="toast-timer-left"
              cx="18"
              cy="18"
              r="16"
              pathLength={100}
              style={{ animationDuration: `${visibleMs}ms` }}
              onAnimationEnd={onClose}
            />
          </svg>
          <Icon name="x" />
        </button>
      )}
    </div>,
    toastStack(),
  );
}

/** Toasts from different parts of the page stack in one place, so they never cover each other. */
function toastStack(): HTMLElement {
  const found = document.querySelector<HTMLElement>("body > .toast-stack");
  if (found !== null) return found;
  const stack = document.createElement("div");
  stack.className = "toast-stack";
  document.body.append(stack);
  return stack;
}

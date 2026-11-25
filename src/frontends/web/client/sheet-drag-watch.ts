/**
 * Lets the person drag every bottom sheet, as on a native phone sheet. One listener on the page
 * serves each sheet, also the dialogs that build their own box. A drag down closes the sheet
 * through its back layer, so each guard of the dialog runs, such as the unsaved changes question.
 */
import { backFromTopLayer } from "./back-layers.ts";
import { dragStart, handleZonePx, releaseOf, sheetOffset, SheetDrag } from "./sheet-drag.ts";

/** The same media query and selector as the sheet rules in `styles.css`. */
const phoneQuery = "(max-width: 760px)";
const sheetSelector = '.dialog-backdrop.phone-sheet > [role="dialog"]';
/** A drag that starts on a control below the handle area is the control's own gesture. */
const controlSelector = 'input, textarea, select, button, a, label, [contenteditable="true"], [role="slider"]';
/** The time a guard has to keep the sheet open, such as for a dialog that waits for work. */
const guardWaitMs = 400;

interface Tracking {
  readonly sheet: HTMLElement;
  readonly drag: SheetDrag;
  readonly startX: number;
  readonly startY: number;
  readonly fromHandle: boolean;
  dragging: boolean;
}

function durationOf(sheet: HTMLElement): number {
  const seconds = Number.parseFloat(getComputedStyle(sheet).transitionDuration);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function springBack(sheet: HTMLElement): void {
  sheet.style.transform = "";
}

/**
 * A mouse that lets go of a drag over the scrim clicks the scrim, and that click would close the
 * dialog a second time. So the click right after a drag does nothing.
 */
function swallowNextClick(window: Window): void {
  const swallow = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/** Call it once, before the first render. */
export function watchSheetDrags(window: Window): void {
  const { document } = window;
  let tracking: Tracking | null = null;

  const begin = (target: EventTarget | null, x: number, y: number, at: number, handleOnly: boolean): void => {
    tracking = null;
    if (!(target instanceof Element) || !window.matchMedia(phoneQuery).matches) return;
    const sheet = target.closest<HTMLElement>(sheetSelector);
    if (sheet === null || sheet.dataset["sheetDrag"] === "off") return;
    // Only the top dialog moves, such as the unsaved changes question over a form.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialogs[dialogs.length - 1] !== sheet) return;
    const fromHandle = y - sheet.getBoundingClientRect().top < handleZonePx;
    if (!fromHandle && (handleOnly || target.closest(controlSelector) !== null)) return;
    tracking = { sheet, drag: new SheetDrag(y, at), startX: x, startY: y, fromHandle, dragging: false };
  };

  const move = (x: number, y: number, at: number, event: Event): void => {
    const current = tracking;
    if (current === null) return;
    const { sheet } = current;
    const dy = y - current.startY;
    if (!current.dragging) {
      const choice = dragStart({
        dx: x - current.startX,
        dy,
        fromHandle: current.fromHandle,
        atTop: sheet.scrollTop <= 0,
      });
      if (choice === "skip") {
        tracking = null;
        return;
      }
      // A first move that the page lets through starts a scroll, and the browser then refuses to
      // stop the next moves. So each move that can still become a drag stays with the sheet.
      if (choice === "wait") {
        if ((current.fromHandle || (sheet.scrollTop <= 0 && dy >= 0)) && event.cancelable) event.preventDefault();
        return;
      }
      current.dragging = true;
      sheet.classList.remove("sheet-settling");
      sheet.classList.add("sheet-dragging");
    }
    if (event.cancelable) event.preventDefault();
    current.drag.move(y, at);
    sheet.style.transform = `translateY(${String(sheetOffset(current.drag.distance))}px)`;
  };

  const end = (cancelled: boolean): void => {
    const current = tracking;
    tracking = null;
    if (!current?.dragging) return;
    const { sheet, drag } = current;
    sheet.classList.remove("sheet-dragging");
    sheet.classList.add("sheet-settling");
    swallowNextClick(window);
    const height = sheet.getBoundingClientRect().height;
    const release = cancelled ? "stay" : releaseOf({ distance: drag.distance, velocity: drag.velocity, height });
    if (release === "stay") {
      springBack(sheet);
      return;
    }
    sheet.style.transform = "translateY(100%)";
    window.setTimeout(() => {
      if (!backFromTopLayer()) springBack(sheet);
      // A guard can keep the sheet, such as a form that asks about its unsaved changes first.
      window.setTimeout(() => {
        if (sheet.isConnected) springBack(sheet);
      }, guardWaitMs);
    }, durationOf(sheet));
  };

  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (touch === undefined) tracking = null;
      else begin(event.target, touch.clientX, touch.clientY, event.timeStamp, false);
    },
    { passive: true },
  );
  // Not passive, so a drag of the sheet stops the page from scrolling under the finger.
  document.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (touch !== undefined) move(touch.clientX, touch.clientY, event.timeStamp, event);
    },
    { passive: false },
  );
  document.addEventListener("touchend", () => end(false));
  document.addEventListener("touchcancel", () => end(true));

  // A mouse drags only the handle area, so a drag in the content still selects text.
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button === 0)
      begin(event.target, event.clientX, event.clientY, event.timeStamp, true);
  });
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") move(event.clientX, event.clientY, event.timeStamp, event);
  });
  document.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") end(false);
  });
  document.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "mouse") end(true);
  });
}

/**
 * Lets the person drag every bottom sheet, as on a native phone sheet. One watcher serves each
 * sheet, also the dialogs that build their own box. A drag down closes the sheet through its back
 * layer, so each guard of the dialog runs, such as the unsaved changes question. A sheet with no
 * back layer of its own sets `data-sheet-drag="off"`: Back would close the layer below it.
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
  readonly target: Element;
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

/** Only the top dialog moves, such as the unsaved changes question over a form. */
function isTopSheet(sheet: HTMLElement): boolean {
  const dialogs = sheet.ownerDocument.querySelectorAll('[role="dialog"]');
  return sheet.isConnected && dialogs[dialogs.length - 1] === sheet;
}

/** True when no box between the finger and the sheet, the sheet too, is scrolled down. */
function showsStart(target: Element, sheet: HTMLElement): boolean {
  for (let box: Element | null = target; box !== null; box = box.parentElement) {
    if (box.scrollTop > 0) return false;
    if (box === sheet) return true;
  }
  return true;
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
    if (sheet === null || sheet.dataset["sheetDrag"] === "off" || !isTopSheet(sheet)) return;
    const fromHandle = y - sheet.getBoundingClientRect().top < handleZonePx;
    if (!fromHandle && (handleOnly || target.closest(controlSelector) !== null)) return;
    tracking = { sheet, target, drag: new SheetDrag(y, at), startX: x, startY: y, fromHandle, dragging: false };
  };

  const move = (x: number, y: number, at: number, event: Event): void => {
    const current = tracking;
    if (current === null) return;
    const { sheet } = current;
    const dy = y - current.startY;
    if (!current.dragging) {
      const atTop = showsStart(current.target, sheet);
      const choice = dragStart({ dx: x - current.startX, dy, fromHandle: current.fromHandle, atTop });
      if (choice === "skip") {
        tracking = null;
        return;
      }
      // A first move that the page lets through starts a scroll, and the browser then refuses to
      // stop the next moves. So each move that can still become a drag stays with the sheet.
      if (choice === "wait") {
        if ((current.fromHandle || (atTop && dy >= 0)) && event.cancelable) event.preventDefault();
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

  const end = (at: number, cancelled: boolean): void => {
    const current = tracking;
    tracking = null;
    if (!current?.dragging) return;
    const { sheet, drag } = current;
    sheet.classList.remove("sheet-dragging");
    sheet.classList.add("sheet-settling");
    swallowNextClick(window);
    const height = sheet.getBoundingClientRect().height;
    const velocity = drag.speedAt(at);
    const release = cancelled ? "stay" : releaseOf({ distance: drag.distance, velocity, height });
    if (release === "stay") {
      springBack(sheet);
      return;
    }
    sheet.style.transform = "translateY(100%)";
    window.setTimeout(() => {
      // The dialog can close on its own meanwhile, and Back would then close the layer below it.
      if (!isTopSheet(sheet) || !backFromTopLayer()) {
        springBack(sheet);
        return;
      }
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
      // A second finger, such as for a pinch, ends the drag.
      if (touch === undefined) end(event.timeStamp, true);
      else begin(event.target, touch.clientX, touch.clientY, event.timeStamp, false);
    },
    { passive: true },
  );
  // Not passive, so a drag stops the page from scrolling under the finger. Only on each sheet:
  // on the whole page, each scroll would wait for this script.
  const onTouchMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (touch !== undefined) move(touch.clientX, touch.clientY, event.timeStamp, event);
  };
  const watched = new WeakSet<Element>();
  const watch = (sheet: Element): void => {
    if (watched.has(sheet)) return;
    watched.add(sheet);
    sheet.addEventListener("touchmove", onTouchMove as EventListener, { passive: false });
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(sheetSelector)) watch(node);
        node.querySelectorAll(sheetSelector).forEach(watch);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll(sheetSelector).forEach(watch);
  document.addEventListener("touchend", (event) => end(event.timeStamp, false));
  document.addEventListener("touchcancel", (event) => end(event.timeStamp, true));

  // A mouse drags only the handle area, so a drag in the content still selects text.
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button === 0)
      begin(event.target, event.clientX, event.clientY, event.timeStamp, true);
  });
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    // The button came up outside the window, where the page gets no pointerup.
    if (event.buttons === 0) end(event.timeStamp, true);
    else move(event.clientX, event.clientY, event.timeStamp, event);
  });
  document.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") end(event.timeStamp, false);
  });
  document.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "mouse") end(event.timeStamp, true);
  });
}

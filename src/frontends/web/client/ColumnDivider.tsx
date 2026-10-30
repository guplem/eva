/**
 * The divider at the edge of an element (issue 626). A drag or the arrow keys change the size of the element. A double
 * click or Enter gives the element its usual size again. By default, the divider sits at the right of its column, and
 * it measures that column. The message box puts one on its top edge, so a person sets the height of the text (issue 660).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

/** One press of an arrow key. */
const keyStep = 16;
/** A click that moves a few pixels is still a click, so it keeps the usual size. */
const dragStart = 3;

/** On the right, a drag to the right makes the element wider. On the top, a drag up makes it taller. */
type Side = "right" | "top";

const sides = {
  right: {
    className: "column-divider",
    orientation: "vertical",
    grow: "ArrowRight",
    shrink: "ArrowLeft",
    tip: "right",
  },
  top: { className: "row-divider", orientation: "horizontal", grow: "ArrowUp", shrink: "ArrowDown", tip: undefined },
} as const;

export function ColumnDivider({
  label,
  minWidth,
  onWidth,
  side = "right",
  target,
  sizeVariable = "--files-width",
  maxSize,
  sizeFrom,
}: {
  readonly label: string;
  readonly minWidth: number;
  /** A size in pixels, or null for the usual size. */
  readonly onWidth: (width: number | null) => void;
  readonly side?: Side;
  /** The element that the divider resizes. By default, its parent. */
  readonly target?: () => HTMLElement | null;
  /** The CSS variable that a drag sets on the element, in pixels. */
  readonly sizeVariable?: string;
  /** The largest size in pixels. By default, the size has no limit. */
  readonly maxSize?: () => number;
  /**
   * The size that a grow or a shrink starts from. By default, the measured size. A box that is shorter than its limit
   * grows from the limit, but shrinks from the height on the screen, so the box follows the pointer.
   */
  readonly sizeFrom?: (grow: boolean) => number;
}): ReactElement {
  const divider = useRef<HTMLDivElement>(null);
  /** Stops the running drag, or null when no drag runs. */
  const drag = useRef<(() => void) | null>(null);
  const keepWidth = useRef(onWidth);
  keepWidth.current = onWidth;
  const look = sides[side];
  const vertical = side === "top";
  /** The size on the screen and the largest size, so a screen reader reads the size in pixels. */
  const [shown, setShown] = useState<{ readonly now: number; readonly max: number } | null>(null);
  const column = (): HTMLElement | null => (target === undefined ? (divider.current?.parentElement ?? null) : target());
  const sizeOf = (element: HTMLElement): number => {
    const box = element.getBoundingClientRect();
    return vertical ? box.height : box.width;
  };
  const columnWidth = (): number => {
    const element = column();
    return element === null ? minWidth : sizeOf(element);
  };
  const clamp = (width: number): number =>
    Math.max(minWidth, Math.round(maxSize === undefined ? width : Math.min(maxSize(), width)));

  // The usual size follows the window, so the value is measured each time the element changes size.
  useEffect(() => {
    const element = column();
    if (element === null) return;
    const measure = (): void => {
      const row = maxSize?.() ?? element.parentElement?.clientWidth ?? 0;
      const now = Math.round(sizeFrom?.(true) ?? sizeOf(element));
      // A column can be wider than the row, which then scrolls.
      setShown({ now, max: Math.max(row, now, minWidth) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // A resized column keeps its width when the window changes, but the row does not.
    if (element.parentElement !== null) observer.observe(element.parentElement);
    return () => {
      observer.disconnect();
      // A column that stops showing its folder during a drag keeps the width, so a reset can clear it later.
      drag.current?.();
    };
  }, [minWidth]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const element = column();
    if (event.button !== 0 || drag.current !== null || element === null) return;
    const start = {
      pointerId: event.pointerId,
      at: vertical ? event.clientY : event.clientX,
      grow: sizeFrom?.(true) ?? columnWidth(),
      shrink: sizeFrom?.(false) ?? columnWidth(),
    };
    // The dragged size, not the measured one: a short text stays shorter than the height that the person chose.
    let dragged: number | null = null;
    // The window follows the drag, so the drag goes on when the pointer leaves the divider.
    const onMove = (move: globalThis.PointerEvent): void => {
      if (move.pointerId !== start.pointerId) return;
      if ((move.buttons & 1) === 0) {
        stop();
        return;
      }
      const offset = vertical ? start.at - move.clientY : move.clientX - start.at;
      if (dragged === null && Math.abs(offset) < dragStart) return;
      // Each move sets the size on the element only: a render of the whole page at each move makes a drag stutter.
      element.classList.add("resized");
      dragged = clamp((offset > 0 ? start.grow : start.shrink) + offset);
      element.style.setProperty(sizeVariable, `${String(dragged)}px`);
    };
    // A text selection or a link under the pointer can start a drag of the browser. It ends the pointer events, so the
    // divider stops halfway.
    const noNativeDrag = (event: DragEvent): void => event.preventDefault();
    const onEnd = (end: globalThis.PointerEvent): void => {
      if (end.pointerId === start.pointerId) stop();
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("dragstart", noNativeDrag);
      drag.current = null;
      if (dragged !== null) keepWidth.current(dragged);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("dragstart", noNativeDrag);
    drag.current = stop;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      onWidth(null);
      return;
    }
    if (event.key !== look.grow && event.key !== look.shrink) return;
    event.preventDefault();
    const grow = event.key === look.grow;
    onWidth(clamp((sizeFrom?.(grow) ?? columnWidth()) + (grow ? keyStep : -keyStep)));
  };

  return (
    <div
      ref={divider}
      className={look.className}
      role="separator"
      aria-orientation={look.orientation}
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuemax={shown?.max}
      aria-valuenow={shown?.now}
      aria-valuetext={shown === null ? undefined : `${String(shown.now)} pixels`}
      tabIndex={0}
      data-tooltip={`Drag or press the arrow keys to resize. Double click or press Enter for the usual ${vertical ? "height" : "width"}.`}
      data-tooltip-side={look.tip}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}

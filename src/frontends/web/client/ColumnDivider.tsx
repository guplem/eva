/**
 * The divider at the right of a column (issue 626). A drag or the arrow keys change the width of the column. A double
 * click or Enter gives the column its usual width again. The divider sits inside its column, so it measures the column.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

/** One press of an arrow key. */
const keyStep = 16;
/** A click that moves a few pixels is still a click, so it keeps the usual width. */
const dragStart = 3;

export function ColumnDivider({
  label,
  minWidth,
  onWidth,
}: {
  readonly label: string;
  readonly minWidth: number;
  /** A width in pixels, or null for the usual width. */
  readonly onWidth: (width: number | null) => void;
}): ReactElement {
  const divider = useRef<HTMLDivElement>(null);
  /** Stops the running drag, or null when no drag runs. */
  const drag = useRef<(() => void) | null>(null);
  const keepWidth = useRef(onWidth);
  keepWidth.current = onWidth;
  /** The width on the screen and the width of the row, so a screen reader reads the width in pixels. */
  const [shown, setShown] = useState<{ readonly now: number; readonly max: number } | null>(null);
  const column = (): HTMLElement | null => divider.current?.parentElement ?? null;
  const columnWidth = (): number => column()?.getBoundingClientRect().width ?? minWidth;
  const clamp = (width: number): number => Math.max(minWidth, Math.round(width));

  // The usual width follows the window, so the value is measured each time the column changes size.
  useEffect(() => {
    const element = column();
    if (element === null) return;
    const measure = (): void => {
      const row = element.parentElement?.clientWidth ?? 0;
      const now = Math.round(element.getBoundingClientRect().width);
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
    const start = { pointerId: event.pointerId, x: event.clientX, width: columnWidth() };
    let moved = false;
    // The window follows the drag, not a pointer capture: some browsers drop the capture when the divider moves
    // away from the pointer, and the drag then stops halfway.
    const onMove = (move: globalThis.PointerEvent): void => {
      if (move.pointerId !== start.pointerId) return;
      if ((move.buttons & 1) === 0) {
        stop();
        return;
      }
      const offset = move.clientX - start.x;
      if (!moved && Math.abs(offset) < dragStart) return;
      moved = true;
      // Each move sets the width on the column only: a render of the whole page at each move makes a drag stutter.
      element.classList.add("resized");
      element.style.setProperty("--files-width", `${String(clamp(start.width + offset))}px`);
    };
    const onEnd = (end: globalThis.PointerEvent): void => {
      if (end.pointerId === start.pointerId) stop();
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      drag.current = null;
      if (moved) keepWidth.current(clamp(element.getBoundingClientRect().width));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    drag.current = stop;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      onWidth(null);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onWidth(clamp(columnWidth() + (event.key === "ArrowRight" ? keyStep : -keyStep)));
  };

  return (
    <div
      ref={divider}
      className="column-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuemax={shown?.max}
      aria-valuenow={shown?.now}
      aria-valuetext={shown === null ? undefined : `${String(shown.now)} pixels`}
      tabIndex={0}
      data-tooltip="Drag or press the arrow keys to resize. Double click or press Enter for the usual width."
      data-tooltip-side="right"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}

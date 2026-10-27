/**
 * The divider at the right of a column (issue 626). A drag or the arrow keys change the width of the column. A double
 * click or Enter gives the column its usual width again. The divider sits inside its column, so it measures the column.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

/** One press of an arrow key. */
const keyStep = 16;
/** A click that moves a few pixels is still a click, so it keeps the usual width. */
const dragStart = 3;

interface Drag {
  readonly pointerId: number;
  readonly x: number;
  readonly width: number;
  moved: boolean;
}

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
  const drag = useRef<Drag | null>(null);
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
      if (drag.current?.moved === true)
        keepWidth.current(Math.max(minWidth, Math.round(element.getBoundingClientRect().width)));
    };
  }, [minWidth]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || drag.current !== null) return;
    event.preventDefault();
    // A divider at the edge of the row must not scroll the row away from the pointer.
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, width: columnWidth(), moved: false };
  };
  // Each move sets the width on the column only: a render of the whole page at each move makes a drag stutter.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    const element = column();
    if (current === null || element === null || event.pointerId !== current.pointerId) return;
    if ((event.buttons & 1) === 0) {
      end(event);
      return;
    }
    const offset = event.clientX - current.x;
    if (!current.moved && Math.abs(offset) < dragStart) return;
    current.moved = true;
    element.classList.add("resized");
    element.style.setProperty("--files-width", `${String(clamp(current.width + offset))}px`);
  };
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moved) onWidth(clamp(columnWidth()));
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
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}

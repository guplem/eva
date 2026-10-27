/**
 * The divider at the right of a column (issue 626). A drag or the arrow keys change the width of the column, and a
 * double click gives the column its usual width again. The divider sits inside its column, so the column measures it.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

/** One press of an arrow key. */
const keyStep = 16;

export function ColumnDivider({
  label,
  width,
  minWidth,
  onWidth,
}: {
  readonly label: string;
  /** The width that the person chose, or null for the usual width. */
  readonly width: number | null;
  readonly minWidth: number;
  readonly onWidth: (width: number | null) => void;
}): ReactElement {
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  /** The width on the screen, so a screen reader reads it also before the first drag. */
  const [shown, setShown] = useState<number | null>(null);
  const columnWidth = (): number => divider.current?.parentElement?.getBoundingClientRect().width ?? minWidth;
  const resize = (next: number): void => onWidth(Math.max(minWidth, Math.round(next)));
  useLayoutEffect(() => setShown(Math.round(columnWidth())), [width]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: columnWidth() };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current !== null) resize(drag.current.width + event.clientX - drag.current.x);
  };
  const onPointerEnd = (): void => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resize(columnWidth() + (event.key === "ArrowRight" ? keyStep : -keyStep));
  };

  return (
    <div
      ref={divider}
      className="column-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuenow={shown ?? undefined}
      tabIndex={0}
      data-tooltip="Drag to resize. Double click for the usual width."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}

/**
 * The layout editor of the home grid (#985, #995): a true-to-scale preview of the grid for a computer
 * or a phone, with one box for each widget that is on. Edit turns on the edit mode: the person drags
 * a box to move it, and its corner handle to change its columns and rows. The arrow keys do the
 * same. `placeWidgets` places the preview and the home grid, so the two never differ. Done writes
 * the changes of both forms into the vault once; Cancel drops them.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import {
  columnsOf,
  editRows,
  moveBox,
  placeWidgets,
  resizeBox,
  resizeBoxToward,
  rowsOf,
  stepBox,
  type LayoutBox,
  type LayoutDirection,
  type LayoutForm,
} from "../../../core/widgets/widget-layout.ts";
import { api, type WidgetItem } from "./api.ts";
import { Icon } from "./icons.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card, errorText } from "./SettingsParts.tsx";
import { Tabs } from "./Tabs.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { gridPlace } from "./WidgetGrid.tsx";
import {
  boxName,
  canReset,
  draftChange,
  draftChanged,
  layoutWidgetsOfItems,
  moveWords,
  shapeWords,
  shownBoxes,
  sizeWords,
  type LayoutDraft,
} from "./widget-layout-draft.ts";

const arrowKeys: Readonly<Record<string, LayoutDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

interface Drag {
  readonly id: string;
  readonly pointerId: number;
  readonly mode: "move" | "resize";
  /** The cell of the box that the pointer holds, from its top left corner. */
  readonly grab: { readonly column: number; readonly row: number };
  /** The draft before the drag, for Escape. */
  readonly before: LayoutDraft;
  readonly element: HTMLElement;
}

export function WidgetLayoutCard({
  items,
  onSaved,
  notify,
}: {
  readonly items: readonly WidgetItem[];
  readonly onSaved: (items: WidgetItem[]) => void;
  readonly notify: (text: string) => void;
}): ReactElement {
  const [form, setForm] = useState<LayoutForm>("computer");
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState<LayoutDraft>({});
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // The newest draft and rows, for the pointer events that come before React draws again.
  const latest = useRef<{ draft: LayoutDraft; rows: number }>({ draft, rows: 1 });
  const helpId = useId();

  const names = new Map(items.map((item) => [item.id, item.name]));
  const nameOf = (id: string): string => names.get(id) ?? id;
  const widgets = layoutWidgetsOfItems(items);
  const resizable = new Set(widgets.flatMap((widget) => (widget.resizable ? [widget.id] : [])));
  const changed = editing && draftChanged(draft);
  const boxes: readonly LayoutBox[] = editing ? shownBoxes(widgets, draft, form) : placeWidgets(widgets, form);
  const columns = columnsOf(form);
  const rows = editing ? editRows(boxes, form) : rowsOf(boxes, form);
  latest.current = { draft, rows };

  const setDraft = (next: LayoutDraft): void => {
    latest.current = { ...latest.current, draft: next };
    setDraftState(next);
  };

  const leave = (): void => {
    setEditing(false);
    setDraft({});
    setStatus("");
  };

  const save = async (): Promise<boolean> => {
    if (!draftChanged(latest.current.draft)) {
      leave();
      return true;
    }
    try {
      onSaved(await api.saveWidgetLayout(draftChange(latest.current.draft)));
      leave();
      return true;
    } catch (error) {
      notify(errorText(error));
      return false;
    }
  };
  useLeaveGuard(changed, save);

  /** Puts new boxes of the shown form in the draft. */
  const apply = (next: readonly LayoutBox[]): void => setDraft({ ...latest.current.draft, [form]: next });
  const current = (): LayoutBox[] => shownBoxes(widgets, latest.current.draft, form);

  const cellAt = (x: number, y: number): { column: number; row: number } | null => {
    const element = grid.current;
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const shownRows = latest.current.rows;
    const width = (box.width - gap * (columns - 1)) / columns;
    const height = (box.height - gap * (shownRows - 1)) / shownRows;
    if (width <= 0 || height <= 0) return null;
    return {
      column: Math.floor((x - box.left) / (width + gap)) + 1,
      row: Math.floor((y - box.top) / (height + gap)) + 1,
    };
  };

  const endDrag = (): void => {
    const held = drag.current;
    if (held === null) return;
    drag.current = null;
    setDragging(null);
    if (held.element.hasPointerCapture(held.pointerId)) held.element.releasePointerCapture(held.pointerId);
  };

  // Escape puts the box back where the drag found it.
  useEffect(() => {
    if (dragging === null) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const held = drag.current;
      if (event.key !== "Escape" || held === null) return;
      event.preventDefault();
      event.stopPropagation();
      setDraft(held.before);
      endDrag();
      setStatus(`The drag of ${nameOf(held.id)} is cancelled.`);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const startDrag = (event: PointerEvent<HTMLDivElement>, box: LayoutBox): void => {
    if (!editing || drag.current !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const onHandle = event.target instanceof Element && event.target.closest(".layout-handle") !== null;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;
    // No text selection and no page scroll while a box moves.
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: box.id,
      pointerId: event.pointerId,
      mode: onHandle && resizable.has(box.id) ? "resize" : "move",
      grab: { column: cell.column - box.column, row: cell.row - box.row },
      before: latest.current.draft,
      element: event.currentTarget,
    };
    setDragging(box.id);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held?.pointerId !== event.pointerId) return;
    const cell = cellAt(event.clientX, event.clientY);
    const now = current();
    const box = now.find((each) => each.id === held.id);
    if (cell === null || box === undefined) return;
    const next =
      held.mode === "resize"
        ? resizeBoxToward(
            now,
            form,
            held.id,
            Math.max(1, cell.column - box.column + 1),
            Math.max(1, cell.row - box.row + 1),
          )
        : moveBox(
            now,
            form,
            held.id,
            Math.min(Math.max(1, cell.column - held.grab.column), columns - box.columns + 1),
            Math.max(1, cell.row - held.grab.row),
          );
    if (next !== null) apply(next);
  };

  const dropDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held?.pointerId !== event.pointerId) return;
    endDrag();
    const box = current().find((each) => each.id === held.id);
    if (box === undefined || held.before === latest.current.draft) return;
    setStatus(held.mode === "resize" ? sizeWords(nameOf(box.id), box) : moveWords(nameOf(box.id), box));
  };

  const keyOnBox = (event: KeyboardEvent<HTMLDivElement>, box: LayoutBox): void => {
    const direction = arrowKeys[event.key];
    if (!editing || direction === undefined) return;
    event.preventDefault();
    const name = nameOf(box.id);
    if (event.shiftKey) {
      if (!resizable.has(box.id)) {
        setStatus(`Approve ${name} on this computer to change its size.`);
        return;
      }
      const wider = { left: -1, right: 1, up: 0, down: 0 }[direction];
      const taller = { up: -1, down: 1, left: 0, right: 0 }[direction];
      const next = resizeBox(current(), form, box.id, box.columns + wider, box.rows + taller);
      const shaped = next?.find((each) => each.id === box.id);
      if (next === null || shaped === undefined) {
        setStatus(
          `${name} cannot be ${{ left: "narrower", right: "wider", up: "shorter", down: "taller" }[direction]}.`,
        );
        return;
      }
      apply(next);
      setStatus(sizeWords(name, shaped));
      return;
    }
    const next = stepBox(current(), form, box.id, direction);
    const moved = next?.find((each) => each.id === box.id);
    if (next === null || moved === undefined) {
      setStatus(`${name} cannot move ${direction}.`);
      return;
    }
    apply(next);
    setStatus(moveWords(name, moved));
  };

  const formName = form === "computer" ? "a computer" : "a phone";
  const preview =
    widgets.length === 0 ? (
      <p className="empty">Turn on a widget to place it on the home page.</p>
    ) : (
      <>
        <div className={`layout-preview-frame layout-${form}`}>
          <div
            ref={grid}
            className={editing ? "layout-preview editing" : "layout-preview"}
            role="group"
            aria-label={`Preview of the home page on ${formName}`}
            style={{
              gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${String(rows)}, var(--layout-row))`,
            }}
          >
            {editing &&
              cellsOf(columns, rows).map(({ column, row }) => (
                <div
                  key={`${String(column)},${String(row)}`}
                  className="layout-cell"
                  style={{ gridColumn: String(column), gridRow: String(row) }}
                  aria-hidden="true"
                />
              ))}
            {/* In list order, not in reading order: a move keeps the focus on its box. */}
            {widgets.map((widget) => {
              const box = boxes.find((each) => each.id === widget.id);
              if (box === undefined) return null;
              const name = nameOf(box.id);
              return (
                <div
                  key={box.id}
                  className={`layout-box${dragging === box.id ? " dragging" : ""}${widget.resizable ? "" : " waiting"}`}
                  style={gridPlace(box)}
                  role="group"
                  aria-label={boxName(name, box)}
                  aria-describedby={editing ? helpId : undefined}
                  tabIndex={editing ? 0 : undefined}
                  onPointerDown={(event) => startDrag(event, box)}
                  onPointerMove={moveDrag}
                  onPointerUp={dropDrag}
                  onPointerCancel={dropDrag}
                  onKeyDown={(event) => keyOnBox(event, box)}
                >
                  <span className="layout-box-name">
                    {!widget.resizable && <Icon name="lock" />}
                    {name}
                  </span>
                  <span className="layout-box-size" aria-hidden="true">
                    {shapeWords(box)}
                  </span>
                  {editing && <Icon name="move" className="layout-grip" />}
                  {editing && widget.resizable && (
                    <span className="layout-handle">
                      <Icon name="resize" label={`Resize ${name}`} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p id={helpId} className="visually-hidden">
          Drag the widget, or press the arrow keys, to move it. Drag its corner, or press Shift and the arrow keys, to
          change its size.
        </p>
        <div className="layout-foot">
          <p className="field-hint" role="status">
            {status !== ""
              ? status
              : editing
                ? "Drag a widget to move it. Drag its corner to change its size."
                : "This is how your home page looks."}
          </p>
          {editing && (
            <button
              type="button"
              className="ghost"
              aria-disabled={canReset(widgets, draft, form) ? undefined : "true"}
              onClick={() => {
                if (!canReset(widgets, draft, form)) return;
                setDraft({ ...draft, [form]: null });
                setStatus(`The layout on ${formName} is back to the default. Press Done to keep it.`);
              }}
            >
              <Icon name="restart" />
              Reset to default
            </button>
          )}
        </div>
      </>
    );

  return (
    <Card
      item="widget-layout"
      title="Widget layout"
      description="Where each widget shows on the home page, and its size. The computer and the phone each have their own layout. A narrow window uses the phone layout."
    >
      <Tabs
        label="Layout for"
        look="line"
        fit
        selected={form}
        onSelect={(next) => {
          setForm(next as LayoutForm);
          setStatus("");
        }}
        actions={
          widgets.length === 0 ? undefined : editing ? (
            <>
              <button type="button" className="ghost" onClick={leave}>
                Cancel
              </button>
              <SaveButton className="primary" onSave={save}>
                <Icon name="check" />
                Done
              </SaveButton>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setStatus("");
              }}
            >
              <Icon name="pen" />
              Edit
            </button>
          )
        }
        tabs={[
          { id: "computer", label: "Computer", icon: "laptop", content: preview },
          { id: "phone", label: "Phone", icon: "phone", content: preview },
        ]}
      />
    </Card>
  );
}

function cellsOf(columns: number, rows: number): { column: number; row: number }[] {
  const cells: { column: number; row: number }[] = [];
  for (let row = 1; row <= rows; row += 1)
    for (let column = 1; column <= columns; column += 1) cells.push({ column, row });
  return cells;
}

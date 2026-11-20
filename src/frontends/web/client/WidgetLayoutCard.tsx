/**
 * The layout editor of the home grid (#985, #698): a true-to-scale preview of the grid for a computer or
 * a phone, with one box for each widget that is on. The person selects a box, then taps a free place
 * or another box, drags the box, or uses the arrows. `placeWidgets` places the preview and the home grid,
 * so the two never differ. Each change waits for Save, which writes the layout into the vault once.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import type { WidgetSize } from "../../../core/widgets/widget-kinds.ts";
import {
  arrangements,
  columnsOf,
  layoutTargets,
  moveWidget,
  nudgeWidget,
  placeWidgets,
  resizeWidget,
  rowsOf,
  sizeIn,
  swapWidgets,
  type LayoutDirection,
  type LayoutForm,
  type LayoutSlots,
  type PlacedWidget,
} from "../../../core/widgets/widget-layout.ts";
import { api, type WidgetItem } from "./api.ts";
import { Icon } from "./icons.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card, ChoiceChips, errorText } from "./SettingsParts.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { gridPlace } from "./WidgetGrid.tsx";
import {
  boxName,
  draftChange,
  draftChanged,
  drafted,
  hasOwnLayout,
  layoutWidgetsOfItems,
  placeWords,
  sizeChoices,
  sizeLabel,
  type LayoutDraft,
} from "./widget-layout-draft.ts";

const formChoices: readonly { value: LayoutForm; label: string; icon: "laptop" | "phone" }[] = [
  { value: "computer", label: "Computer", icon: "laptop" },
  { value: "phone", label: "Phone", icon: "phone" },
];

const arrowKeys: Readonly<Record<string, LayoutDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const moveButtons: readonly { direction: LayoutDirection; label: string; className: string }[] = [
  { direction: "left", label: "left", className: "" },
  { direction: "up", label: "up", className: "layout-arrow-up" },
  { direction: "down", label: "down", className: "layout-arrow-down" },
  { direction: "right", label: "right", className: "layout-arrow-right" },
];

/** A pointer must move this far before a press becomes a drag, so a tap stays a tap. */
const dragStartPx = 6;

interface Drag {
  readonly id: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  /** The cell of the box that the pointer holds, from its top left corner. */
  readonly grab: { readonly column: number; readonly row: number };
  moving: boolean;
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
  const [draft, setDraft] = useState<LayoutDraft>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // The top left corner where a drag would drop the selected box.
  const [hover, setHover] = useState<{ column: number; row: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);

  const names = new Map(items.map((item) => [item.id, item.name]));
  const nameOf = (id: string): string => names.get(id) ?? id;
  const saved = layoutWidgetsOfItems(items);
  const widgets = drafted(saved, draft);
  const changed = draftChanged(draft);
  const chosen = selected !== null && widgets.some((widget) => widget.id === selected) ? selected : null;
  // A selected box shows the free half of each phone row, so the person can put a small card there.
  const cards = placeWidgets(widgets, form, { widen: chosen === null });
  const columns = columnsOf(form);
  const targets = chosen === null ? [] : layoutTargets(widgets, form, chosen);
  const selectedCard = cards.find((card) => card.id === chosen) ?? null;
  const rows = Math.max(rowsOf(cards, form), ...targets.map((target) => target.row + (selectedCard?.rows ?? 1) - 1));
  const offered = arrangements(widgets, form);
  const shownKey = slotsKey(placeWidgets(widgets, form));
  const current = offered.find(
    (each) => slotsKey(placeWidgets(withForm(widgets, form, each.slots), form)) === shownKey,
  );

  const save = async (): Promise<boolean> => {
    if (!changed) return true;
    try {
      onSaved(await api.saveWidgetLayout(draftChange(draft)));
      setDraft({});
      setSelected(null);
      return true;
    } catch (error) {
      notify(errorText(error));
      return false;
    }
  };
  useLeaveGuard(changed, save);

  const apply = (slots: LayoutSlots | null, words: string): void => {
    setDraft((old) => ({ ...old, [form]: slots }));
    setStatus(words);
  };

  const moveTo = (id: string, column: number, row: number): boolean => {
    const slots = moveWidget(widgets, form, id, column, row);
    if (slots === null) return false;
    apply(slots, `${nameOf(id)} moved to ${placeWords(column, row)}.`);
    return true;
  };

  const swapWith = (id: string, other: string): boolean => {
    const slots = swapWidgets(widgets, form, id, other);
    if (slots === null) return false;
    apply(slots, `${nameOf(id)} and ${nameOf(other)} swapped places.`);
    return true;
  };

  const nudge = (id: string, direction: LayoutDirection): void => {
    const slots = nudgeWidget(widgets, form, id, direction);
    if (slots === null) {
      setStatus(`${nameOf(id)} cannot move ${direction}.`);
      return;
    }
    const place = slots[id];
    apply(slots, `${nameOf(id)} moved to ${placeWords(place?.column ?? 1, place?.row ?? 1)}.`);
  };

  const pressBox = (card: PlacedWidget): void => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (chosen === null || chosen === card.id) {
      const next = chosen === card.id ? null : card.id;
      setSelected(next);
      setStatus(
        next === null ? "" : `${nameOf(card.id)} selected. Tap a free place to move it, or another widget to swap.`,
      );
      return;
    }
    if (!swapWith(chosen, card.id)) {
      setSelected(card.id);
      setStatus(
        `${nameOf(chosen)} and ${nameOf(card.id)} do not fit in each other's place. ${nameOf(card.id)} is selected now.`,
      );
    }
  };

  const cellAt = (x: number, y: number): { column: number; row: number } | null => {
    const box = grid.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0 || box.height === 0) return null;
    const column = Math.floor(((x - box.left) / box.width) * columns) + 1;
    const row = Math.floor(((y - box.top) / box.height) * rows) + 1;
    return column < 1 || column > columns || row < 1 ? null : { column, row };
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, card: PlacedWidget): void => {
    // A finger drags only the selected box, so a swipe over the preview still scrolls the page.
    if (event.pointerType !== "mouse" && card.id !== chosen) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;
    drag.current = {
      id: card.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grab: { column: cell.column - card.column, row: cell.row - card.row },
      moving: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const held = drag.current;
    if (held?.pointerId !== event.pointerId) return;
    if (!held.moving && Math.hypot(event.clientX - held.x, event.clientY - held.y) < dragStartPx) return;
    held.moving = true;
    if (chosen !== held.id) setSelected(held.id);
    const cell = cellAt(event.clientX, event.clientY);
    setHover(cell === null ? null : { column: cell.column - held.grab.column, row: cell.row - held.grab.row });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const held = drag.current;
    if (held?.pointerId !== event.pointerId) return;
    drag.current = null;
    setHover(null);
    if (!held.moving) return;
    // The click that follows the drop must not select or swap.
    dragged.current = true;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;
    const column = cell.column - held.grab.column;
    const row = cell.row - held.grab.row;
    if (moveTo(held.id, column, row)) return;
    const under = cards.find(
      (other) =>
        other.id !== held.id &&
        cell.column >= other.column &&
        cell.column < other.column + other.columns &&
        cell.row >= other.row &&
        cell.row < other.row + other.rows,
    );
    if (under !== undefined && swapWith(held.id, under.id)) return;
    setStatus(`${nameOf(held.id)} does not fit there.`);
  };

  const keyOnBox = (event: KeyboardEvent<HTMLButtonElement>, card: PlacedWidget): void => {
    if (event.key === "Escape" && chosen !== null) {
      event.preventDefault();
      setSelected(null);
      setStatus("");
      return;
    }
    const direction = arrowKeys[event.key];
    if (direction === undefined || card.id !== chosen) return;
    event.preventDefault();
    nudge(card.id, direction);
  };

  const ghost =
    hover !== null && selectedCard !== null && targets.some((t) => t.column === hover.column && t.row === hover.row)
      ? { ...selectedCard, column: hover.column, row: hover.row }
      : null;
  const covered = coveredCells(cards);
  const selectedWidget = widgets.find((widget) => widget.id === chosen) ?? null;
  const formName = form === "computer" ? "a computer" : "a phone";

  return (
    <Card
      item="widget-layout"
      title="Widget layout"
      description="Choose where each widget shows on the home page, and its size. The computer and the phone each have their own layout. A narrow window uses the phone layout."
    >
      <ChoiceChips
        label="Layout for"
        value={form}
        choices={formChoices}
        onChange={(next) => {
          setForm(next);
          setSelected(null);
          setStatus("");
        }}
      />
      {widgets.length === 0 ? (
        <p className="empty">Turn on a widget to place it on the home page.</p>
      ) : (
        <>
          <div className={`layout-preview-frame layout-${form}`}>
            <div
              ref={grid}
              className="layout-preview"
              role="group"
              aria-label={`Preview of the home page on ${formName}`}
              style={{
                gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${String(rows)}, var(--layout-row))`,
              }}
            >
              {freeCells(columns, rows, covered).map(({ column, row }) => {
                const target = targets.some((t) => t.column === column && t.row === row);
                const place = { gridColumn: String(column), gridRow: String(row) };
                return target && chosen !== null ? (
                  <button
                    key={`${String(column)},${String(row)}`}
                    type="button"
                    className="layout-cell layout-target"
                    style={place}
                    aria-label={`Move ${nameOf(chosen)} to ${placeWords(column, row)}`}
                    onClick={() => void moveTo(chosen, column, row)}
                  />
                ) : (
                  <div
                    key={`${String(column)},${String(row)}`}
                    className="layout-cell"
                    style={place}
                    aria-hidden="true"
                  />
                );
              })}
              {/* In list order, not in reading order: a move keeps the focus on its box. */}
              {widgets.map((widget) => {
                const card = cards.find((each) => each.id === widget.id);
                if (card === undefined) return null;
                const isSelected = card.id === chosen;
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`layout-box${isSelected ? " selected" : ""}${widget.resizable ? "" : " waiting"}`}
                    style={gridPlace(card)}
                    aria-pressed={isSelected}
                    aria-label={boxName(card, nameOf(card.id), form)}
                    onClick={() => pressBox(card)}
                    onKeyDown={(event) => keyOnBox(event, card)}
                    onPointerDown={(event) => startDrag(event, card)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => {
                      drag.current = null;
                      setHover(null);
                    }}
                  >
                    {!widget.resizable && <Icon name="lock" />}
                    <span className="layout-box-name">{nameOf(card.id)}</span>
                    <span className="layout-box-size">{sizeLabel(card.size, form)}</span>
                  </button>
                );
              })}
              {ghost !== null && <div className="layout-ghost" style={gridPlace(ghost)} aria-hidden="true" />}
            </div>
          </div>
          <p className="field-hint" role="status">
            {status !== "" ? status : "Select a widget, then tap a free place or another widget. You can also drag it."}
          </p>
          {selectedWidget !== null && chosen !== null && (
            <div className="layout-tools" role="group" aria-label={`Move or resize ${nameOf(chosen)}`}>
              <div className="field">
                <span className="field-label">Move {nameOf(chosen)}</span>
                <div className="button-row">
                  {moveButtons.map(({ direction, label, className }) => (
                    <button
                      key={direction}
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${nameOf(chosen)} ${label}`}
                      data-tooltip={`Move ${label}`}
                      onClick={() => nudge(chosen, direction)}
                    >
                      <Icon name="back" className={className} />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setSelected(null);
                      setStatus("");
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
              {selectedWidget.resizable ? (
                <ChoiceChips<WidgetSize>
                  label={`Size of ${nameOf(chosen)}`}
                  value={sizeIn(selectedWidget, form)}
                  choices={sizeChoices(form)}
                  hint="Columns × rows on the home page. The widget shows more in a larger size."
                  onChange={(size) =>
                    apply(
                      resizeWidget(widgets, form, chosen, size),
                      `${nameOf(chosen)} is ${sizeLabel(size, form)} now.`,
                    )
                  }
                />
              ) : (
                <p className="field-hint">Approve {nameOf(chosen)} on this computer to choose its size.</p>
              )}
            </div>
          )}
          {offered.length > 0 && (
            <ChoiceChips
              label="Arrangements"
              value={current?.id ?? "none"}
              choices={offered.map((each) => ({ value: each.id, label: each.label }))}
              hint="One tap places every widget. Then move each one as you like."
              onChange={(id) => {
                const picked = offered.find((each) => each.id === id);
                if (picked === undefined) return;
                setSelected(null);
                apply(picked.slots, `${picked.label}: done. Save to keep it.`);
              }}
            />
          )}
          <div className="button-row">
            <SaveButton className="primary" aria-disabled={changed ? undefined : "true"} onSave={save}>
              Save layout
            </SaveButton>
            <button
              type="button"
              className="ghost"
              aria-disabled={hasOwnLayout(widgets, form) ? undefined : "true"}
              onClick={() => {
                if (!hasOwnLayout(widgets, form)) return;
                setSelected(null);
                apply(null, `The layout on ${formName} is back to the default. Save to keep it.`);
              }}
            >
              <Icon name="restart" />
              Reset to default
            </button>
            {changed && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setDraft({});
                  setSelected(null);
                  setStatus("The changes are gone.");
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function withForm(
  widgets: ReturnType<typeof layoutWidgetsOfItems>,
  form: LayoutForm,
  slots: LayoutSlots,
): ReturnType<typeof layoutWidgetsOfItems> {
  return drafted(widgets, { [form]: slots });
}

/** The places of the cards, to compare two layouts. */
function slotsKey(cards: readonly PlacedWidget[]): string {
  return cards.map((card) => `${card.id}@${String(card.column)},${String(card.row)}`).join(" ");
}

function coveredCells(cards: readonly PlacedWidget[]): Set<string> {
  const covered = new Set<string>();
  for (const card of cards)
    for (let x = card.column; x < card.column + card.columns; x += 1)
      for (let y = card.row; y < card.row + card.rows; y += 1) covered.add(`${String(x)},${String(y)}`);
  return covered;
}

function freeCells(columns: number, rows: number, covered: ReadonlySet<string>): { column: number; row: number }[] {
  const cells: { column: number; row: number }[] = [];
  for (let row = 1; row <= rows; row += 1)
    for (let column = 1; column <= columns; column += 1)
      if (!covered.has(`${String(column)},${String(row)}`)) cells.push({ column, row });
  return cells;
}

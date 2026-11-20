/**
 * The layout of the home grid (#698, #985): where each widget that is on goes, and its size, on a
 * computer and on a phone. The real grid and the preview of Settings both place the cards with
 * `placeWidgets`, so the two never differ. Pure, so the web page can use it, and a test covers it.
 *
 * A widget can have a saved slot for each form in `.eva/widgets.json`. A saved place wins, and a
 * gap that the person left stays. Every other card fills the first hole where it fits, in order,
 * as CSS dense placement does. With no saved place, the grid looks as it did before the editor.
 */
import { widgetSizes, type WidgetSize } from "./widget-kinds.ts";

export type LayoutForm = "computer" | "phone";

export const layoutForms: readonly LayoutForm[] = ["computer", "phone"];

/** A saved place and size of one widget in one form. Each key is optional, and a bad value is ignored. */
export interface LayoutSlot {
  readonly column?: number | undefined;
  readonly row?: number | undefined;
  readonly size?: WidgetSize | undefined;
}

export interface WidgetLayout {
  readonly computer?: LayoutSlot;
  readonly phone?: LayoutSlot;
}

export interface LayoutWidget {
  readonly id: string;
  /** The size of its approved manifest. */
  readonly size: WidgetSize;
  /** False for a widget that waits for approval: it stays small. */
  readonly resizable: boolean;
  readonly layout: WidgetLayout;
}

/** One card at its place. `column` and `row` start at 1. */
export interface PlacedWidget {
  readonly id: string;
  readonly size: WidgetSize;
  readonly column: number;
  readonly row: number;
  readonly columns: number;
  readonly rows: number;
}

/** The new slots of one form, by widget id. */
export type LayoutSlots = Readonly<Record<string, LayoutSlot>>;

export type LayoutDirection = "up" | "down" | "left" | "right";

/** A one-tap arrangement of the widgets that are on. */
export interface LayoutArrangement {
  readonly id: "big-left" | "big-right" | "small-top" | "big-last" | "big-first";
  readonly label: string;
  readonly slots: LayoutSlots;
}

/** A saved row past this is a typo, not a place: it would make the grid very long. */
const maxRow = 60;

const spans: Readonly<Record<LayoutForm, Readonly<Record<WidgetSize, readonly [number, number]>>>> = {
  computer: { small: [1, 1], medium: [2, 1], large: [4, 1], tall: [1, 2], xlarge: [3, 3] },
  phone: { small: [1, 1], medium: [2, 1], large: [2, 2], tall: [2, 2], xlarge: [2, 3] },
};

export function columnsOf(form: LayoutForm): number {
  return form === "computer" ? 4 : 2;
}

export function spanOf(size: WidgetSize, form: LayoutForm): { readonly columns: number; readonly rows: number } {
  const [columns, rows] = spans[form][size];
  return { columns, rows };
}

/** The size with no own slot in this form: a phone takes the computer's size. */
function defaultSizeIn(widget: LayoutWidget, form: LayoutForm): WidgetSize {
  if (!widget.resizable) return "small";
  return form === "phone" ? (widget.layout.computer?.size ?? widget.size) : widget.size;
}

export function sizeIn(widget: LayoutWidget, form: LayoutForm): WidgetSize {
  if (!widget.resizable) return "small";
  return widget.layout[form]?.size ?? defaultSizeIn(widget, form);
}

/** The rows that the grid shows: three at least on a computer, so a large card fills the height. */
export function rowsOf(placed: readonly PlacedWidget[], form: LayoutForm): number {
  return Math.max(form === "computer" ? 3 : 1, ...placed.map((card) => card.row + card.rows - 1));
}

/**
 * Places each widget. Saved places come first, in list order; a place that does not fit, or that
 * overlaps an earlier card, is ignored. The other cards follow, after the last saved row, so they
 * never fill a gap that the person left. A phone with no saved place follows the computer's order,
 * and shows an `xlarge` card after the smaller cards. With `widen`, a small phone card alone in its
 * row takes the whole row. The answer is in reading order.
 */
export function placeWidgets(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  options: { readonly widen?: boolean } = {},
): PlacedWidget[] {
  const grid = new Grid(columnsOf(form));
  const placed: PlacedWidget[] = [];
  const auto: LayoutWidget[] = [];
  for (const widget of widgets) {
    const size = sizeIn(widget, form);
    const { columns, rows } = spanOf(size, form);
    const slot = widget.layout[form];
    if (slot?.column !== undefined && slot.row !== undefined && grid.fits(slot.column, slot.row, columns, rows)) {
      grid.take(slot.column, slot.row, columns, rows);
      placed.push({ id: widget.id, size, column: slot.column, row: slot.row, columns, rows });
    } else auto.push(widget);
  }
  const start = placed.length === 0 ? 1 : rowsOf(placed, "phone") + 1;
  for (const widget of autoOrder(auto, widgets, form)) {
    const size = sizeIn(widget, form);
    const { columns, rows } = spanOf(size, form);
    const { column, row } = grid.firstHole(columns, rows, start);
    grid.take(column, row, columns, rows);
    placed.push({ id: widget.id, size, column, row, columns, rows });
  }
  const shown =
    form === "phone" && options.widen !== false
      ? placed.map((card) =>
          card.size === "small" && grid.free(card.column === 1 ? 2 : 1, card.row)
            ? { ...card, column: 1, columns: 2 }
            : card,
        )
      : placed;
  return readingOrder(shown);
}

function autoOrder(auto: readonly LayoutWidget[], all: readonly LayoutWidget[], form: LayoutForm): LayoutWidget[] {
  if (form === "computer") return [...auto];
  const order = placeWidgets(all, "computer").map((card) => card.id);
  const sorted = [...auto].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  // A long card on a phone would push the smaller cards out of view.
  return [
    ...sorted.filter((widget) => sizeIn(widget, form) !== "xlarge"),
    ...sorted.filter((widget) => sizeIn(widget, form) === "xlarge"),
  ];
}

function readingOrder(cards: readonly PlacedWidget[]): PlacedWidget[] {
  return [...cards].sort((a, b) => a.row - b.row || a.column - b.column);
}

/** The taken cells of a grid with a fixed number of columns and as many rows as it needs. */
class Grid {
  private readonly taken = new Set<string>();

  constructor(private readonly columns: number) {}

  free(column: number, row: number): boolean {
    return !this.taken.has(`${String(column)},${String(row)}`);
  }

  fits(column: number, row: number, columns: number, rows: number): boolean {
    if (!Number.isInteger(column) || !Number.isInteger(row)) return false;
    if (column < 1 || row < 1 || row > maxRow || column + columns - 1 > this.columns) return false;
    for (let x = column; x < column + columns; x += 1)
      for (let y = row; y < row + rows; y += 1) if (!this.free(x, y)) return false;
    return true;
  }

  take(column: number, row: number, columns: number, rows: number): void {
    for (let x = column; x < column + columns; x += 1)
      for (let y = row; y < row + rows; y += 1) this.taken.add(`${String(x)},${String(y)}`);
  }

  firstHole(columns: number, rows: number, start: number): { column: number; row: number } {
    for (let row = start; ; row += 1)
      for (let column = 1; column + columns - 1 <= this.columns; column += 1)
        if (this.fitsAnyRow(column, row, columns, rows)) return { column, row };
  }

  /** As `fits`, with no last row: a card that Eva places always finds a hole. */
  private fitsAnyRow(column: number, row: number, columns: number, rows: number): boolean {
    for (let x = column; x < column + columns; x += 1)
      for (let y = row; y < row + rows; y += 1) if (!this.free(x, y)) return false;
    return true;
  }
}

/** Reads the `layout` key of an entry of `.eva/widgets.json`. A person or an agent can edit it, so it never throws. */
export function readLayout(raw: unknown): WidgetLayout {
  if (!isObject(raw)) return {};
  const layout: { computer?: LayoutSlot; phone?: LayoutSlot } = {};
  for (const form of layoutForms) {
    const slot = readSlot(raw[form]);
    if (slot !== null) layout[form] = slot;
  }
  return layout;
}

function readSlot(raw: unknown): LayoutSlot | null {
  if (!isObject(raw)) return null;
  const slot: { column?: number; row?: number; size?: WidgetSize } = {};
  const { column, row, size } = raw;
  if (isPlace(column)) slot.column = column;
  if (isPlace(row)) slot.row = row;
  if (typeof size === "string" && (widgetSizes as readonly string[]).includes(size)) slot.size = size as WidgetSize;
  return Object.keys(slot).length === 0 ? null : slot;
}

function isPlace(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maxRow;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The widgets with new slots in one form. Null clears that form: its default comes back. */
export function withSlots(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  slots: LayoutSlots | null,
): LayoutWidget[] {
  return widgets.map((widget) => {
    const { [form]: _old, ...rest } = widget.layout;
    const slot = slots?.[widget.id];
    return { ...widget, layout: slot === undefined ? rest : { ...rest, [form]: slot } };
  });
}

/** The slot of each card, with its size only when it differs from the default, so a later manifest size still counts. */
function slotsOf(cards: readonly PlacedWidget[], widgets: readonly LayoutWidget[], form: LayoutForm): LayoutSlots {
  return Object.fromEntries(
    cards.map((card) => {
      const widget = widgets.find((each) => each.id === card.id);
      const own = widget !== undefined && widget.resizable && card.size !== defaultSizeIn(widget, form);
      return [
        card.id,
        own ? { column: card.column, row: card.row, size: card.size } : { column: card.column, row: card.row },
      ];
    }),
  );
}

/** The grid with each card but one: the cards that an edit keeps where they are. */
function others(cards: readonly PlacedWidget[], form: LayoutForm, ...ids: string[]): Grid {
  const grid = new Grid(columnsOf(form));
  for (const card of cards) if (!ids.includes(card.id)) grid.take(card.column, card.row, card.columns, card.rows);
  return grid;
}

/** The last row that an edit may use: one row below the other cards. */
function lastRow(cards: readonly PlacedWidget[], id: string): number {
  return Math.max(0, ...cards.filter((card) => card.id !== id).map((card) => card.row + card.rows - 1)) + 1;
}

function edited(
  cards: readonly PlacedWidget[],
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  changes: Readonly<Record<string, Partial<PlacedWidget>>>,
): LayoutSlots {
  return slotsOf(
    cards.map((card) => ({ ...card, ...changes[card.id] })),
    widgets,
    form,
  );
}

/** The places where a card's top left corner can go, in reading order, apart from where it is now. */
export function layoutTargets(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  id: string,
): { column: number; row: number }[] {
  const cards = placeWidgets(widgets, form, { widen: false });
  const card = cards.find((each) => each.id === id);
  if (card === undefined) return [];
  const grid = others(cards, form, id);
  const targets: { column: number; row: number }[] = [];
  for (let row = 1; row <= lastRow(cards, id); row += 1)
    for (let column = 1; column <= columnsOf(form); column += 1)
      if ((column !== card.column || row !== card.row) && grid.fits(column, row, card.columns, card.rows))
        targets.push({ column, row });
  return targets;
}

/** Moves a card to a free place. Null when it does not fit there. */
export function moveWidget(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  id: string,
  column: number,
  row: number,
): LayoutSlots | null {
  const cards = placeWidgets(widgets, form, { widen: false });
  const card = cards.find((each) => each.id === id);
  if (card === undefined || row > lastRow(cards, id)) return null;
  if (!others(cards, form, id).fits(column, row, card.columns, card.rows)) return null;
  return edited(cards, widgets, form, { [id]: { column, row } });
}

/**
 * Swaps two cards: each takes the other's place. When the two would overlap, as two cards of one
 * column of different heights do, the second one goes right after the first. Null when they do not fit.
 */
export function swapWidgets(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  a: string,
  b: string,
): LayoutSlots | null {
  const cards = placeWidgets(widgets, form, { widen: false });
  const first = cards.find((each) => each.id === a);
  const second = cards.find((each) => each.id === b);
  if (first === undefined || second === undefined || a === b) return null;
  const columns = columnsOf(form);
  const clamp = (card: PlacedWidget, column: number): number => Math.min(column, columns - card.columns + 1);
  let movedA = { ...first, column: clamp(first, second.column), row: second.row };
  let movedB = { ...second, column: clamp(second, first.column), row: first.row };
  if (overlap(movedA, movedB)) {
    const [early, late] =
      movedA.row < movedB.row || (movedA.row === movedB.row && movedA.column < movedB.column)
        ? [movedA, movedB]
        : [movedB, movedA];
    const next =
      early.column === late.column
        ? { ...late, row: early.row + early.rows }
        : { ...late, column: early.column + early.columns };
    if (late === movedA) movedA = next;
    else movedB = next;
  }
  const grid = others(cards, form, a, b);
  if (!grid.fits(movedA.column, movedA.row, movedA.columns, movedA.rows)) return null;
  grid.take(movedA.column, movedA.row, movedA.columns, movedA.rows);
  if (!grid.fits(movedB.column, movedB.row, movedB.columns, movedB.rows)) return null;
  return edited(cards, widgets, form, {
    [a]: { column: movedA.column, row: movedA.row },
    [b]: { column: movedB.column, row: movedB.row },
  });
}

function overlap(a: PlacedWidget, b: PlacedWidget): boolean {
  return (
    a.column < b.column + b.columns &&
    b.column < a.column + a.columns &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

const steps: Readonly<Record<LayoutDirection, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Moves a card to the next free place in a direction, past the cards in the way. Null at the edge. */
export function nudgeWidget(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  id: string,
  direction: LayoutDirection,
): LayoutSlots | null {
  const cards = placeWidgets(widgets, form, { widen: false });
  const card = cards.find((each) => each.id === id);
  if (card === undefined) return null;
  const grid = others(cards, form, id);
  const [dx, dy] = steps[direction];
  const last = lastRow(cards, id);
  for (
    let column = card.column + dx, row = card.row + dy;
    row >= 1 && row <= last && column >= 1 && column <= columnsOf(form);
    column += dx, row += dy
  )
    if (grid.fits(column, row, card.columns, card.rows)) return edited(cards, widgets, form, { [id]: { column, row } });
  return null;
}

/** Gives a card a new size. It keeps its place when it fits there, or goes to the first hole where it fits. */
export function resizeWidget(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  id: string,
  size: WidgetSize,
): LayoutSlots {
  const cards = placeWidgets(widgets, form, { widen: false });
  const card = cards.find((each) => each.id === id);
  if (card === undefined) return slotsOf(cards, widgets, form);
  const { columns, rows } = spanOf(size, form);
  const grid = others(cards, form, id);
  const column = Math.min(card.column, columnsOf(form) - columns + 1);
  const place = grid.fits(column, card.row, columns, rows)
    ? { column, row: card.row }
    : grid.firstHole(columns, rows, 1);
  return edited(cards, widgets, form, { [id]: { ...place, size, columns, rows } });
}

/**
 * A few one-tap arrangements of the widgets that are on, in list order. Each needs one widget that
 * is bigger than all the others, or widgets of more than one size. One that gives the same places
 * as an earlier one shows once.
 */
export function arrangements(widgets: readonly LayoutWidget[], form: LayoutForm): LayoutArrangement[] {
  if (widgets.length < 2) return [];
  const area = (widget: LayoutWidget): number => {
    const { columns, rows } = spanOf(sizeIn(widget, form), form);
    return columns * rows;
  };
  const areas = widgets.map(area);
  const top = Math.max(...areas);
  const big = areas.filter((each) => each === top).length === 1 ? widgets[areas.indexOf(top)] : undefined;
  const rest = widgets.filter((widget) => widget !== big);
  const mixed = new Set(areas).size > 1;
  const candidates: { id: LayoutArrangement["id"]; label: string; order: LayoutWidget[]; fixed?: LayoutWidget }[] = [];
  if (form === "computer") {
    if (big !== undefined) {
      candidates.push({ id: "big-left", label: "Big widget left", order: [big, ...rest] });
      candidates.push({ id: "big-right", label: "Big widget right", order: rest, fixed: big });
    }
    if (mixed)
      candidates.push({
        id: "small-top",
        label: "Smaller widgets on top",
        order: [...widgets].sort((a, b) => area(a) - area(b)),
      });
  } else if (big !== undefined) {
    candidates.push({ id: "big-last", label: "Big widget last", order: [...rest, big] });
    candidates.push({ id: "big-first", label: "Big widget first", order: [big, ...rest] });
  }
  const seen = new Set<string>();
  return candidates.flatMap(({ id, label, order, fixed }) => {
    const slots = arranged(widgets, form, order, fixed);
    const key = JSON.stringify(Object.entries(slots).sort(([x], [y]) => x.localeCompare(y)));
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id, label, slots }];
  });
}

/** Places `order` in the first holes, after `fixed` at the top right. */
function arranged(
  widgets: readonly LayoutWidget[],
  form: LayoutForm,
  order: readonly LayoutWidget[],
  fixed: LayoutWidget | undefined,
): LayoutSlots {
  const grid = new Grid(columnsOf(form));
  const cards: PlacedWidget[] = [];
  const put = (widget: LayoutWidget, column: number, row: number): void => {
    const size = sizeIn(widget, form);
    const { columns, rows } = spanOf(size, form);
    grid.take(column, row, columns, rows);
    cards.push({ id: widget.id, size, column, row, columns, rows });
  };
  if (fixed !== undefined) put(fixed, columnsOf(form) - spanOf(sizeIn(fixed, form), form).columns + 1, 1);
  for (const widget of order) {
    const { columns, rows } = spanOf(sizeIn(widget, form), form);
    const { column, row } = grid.firstHole(columns, rows, 1);
    put(widget, column, row);
  }
  return slotsOf(cards, widgets, form);
}

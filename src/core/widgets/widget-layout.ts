/**
 * The layout of the home grid (#698, #985, #995): where each widget that is on goes, and its shape in
 * columns and rows, on a computer and on a phone. The real grid and the preview of Settings both place
 * the cards with `placeWidgets`, so the two never differ. Pure, so the web page can use it, and a test covers it.
 *
 * A widget can have a saved slot for each form in `.eva/widgets.json`. A saved place wins, and a
 * gap that the person left stays. Every other card fills the first hole where it fits, in order,
 * as CSS dense placement does. With no saved place, the grid looks as it did before the editor.
 */
import { widgetSizes, type WidgetSize } from "./widget-kinds.ts";

export type LayoutForm = "computer" | "phone";

export const layoutForms: readonly LayoutForm[] = ["computer", "phone"];

/**
 * A saved place and shape of one widget in one form. Each key is optional, and a bad value is ignored.
 * `size` is the older form of the shape (#985): Eva reads it, and writes `columns` and `rows` instead.
 */
export interface LayoutSlot {
  readonly column?: number | undefined;
  readonly row?: number | undefined;
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
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
  /** False for a widget that waits for approval: it stays 1 x 1. */
  readonly resizable: boolean;
  readonly layout: WidgetLayout;
}

export interface LayoutShape {
  readonly columns: number;
  readonly rows: number;
}

/** One box of the grid at its place. `column` and `row` start at 1. */
export interface LayoutBox extends LayoutShape {
  readonly id: string;
  readonly column: number;
  readonly row: number;
}

/** One card at its place, with the size name that its frame gets in `?size=`. */
export interface PlacedWidget extends LayoutBox {
  readonly size: WidgetSize;
}

/** The new slots of one form, by widget id. */
export type LayoutSlots = Readonly<Record<string, LayoutSlot>>;

export type LayoutDirection = "up" | "down" | "left" | "right";

/** A saved row past this is a typo, not a place: it would make the grid very long. */
const maxRow = 60;

/** The most rows of one card: more is a typo, and would push every other card out of view. */
export const maxCardRows = 8;

const spans: Readonly<Record<LayoutForm, Readonly<Record<WidgetSize, readonly [number, number]>>>> = {
  computer: { small: [1, 1], medium: [2, 1], large: [4, 1], tall: [1, 2], xlarge: [3, 3], header: [2, 1] },
  phone: { small: [1, 1], medium: [2, 1], large: [2, 2], tall: [2, 2], xlarge: [2, 3], header: [2, 1] },
};

export function columnsOf(form: LayoutForm): number {
  return form === "computer" ? 4 : 2;
}

/** The default shape of a size of the contract in a form. */
export function spanOf(size: WidgetSize, form: LayoutForm): LayoutShape {
  const [columns, rows] = spans[form][size];
  return { columns, rows };
}

/**
 * The size name of the contract that is nearest to a shape, for the `?size=` of a frame. One cell
 * is small. One column is tall. One row is medium at two columns, and large from three. Two or more
 * columns and rows are xlarge from six cells, and large below that: a square of four, as on a phone.
 */
export function sizeOfShape({ columns, rows }: LayoutShape): WidgetSize {
  if (columns <= 1 && rows <= 1) return "small";
  if (columns <= 1) return "tall";
  if (rows <= 1) return columns === 2 ? "medium" : "large";
  return columns * rows >= 6 ? "xlarge" : "large";
}

function sameShape(a: LayoutShape, b: LayoutShape): boolean {
  return a.columns === b.columns && a.rows === b.rows;
}

/** The shape that a slot saves for this form, or null when it saves none that fits. */
function ownShape(slot: LayoutSlot | undefined, form: LayoutForm): LayoutShape | null {
  if (slot === undefined) return null;
  if (slot.columns !== undefined && slot.rows !== undefined && slot.columns <= columnsOf(form))
    return { columns: slot.columns, rows: slot.rows };
  return slot.size === undefined ? null : spanOf(slot.size, form);
}

/** The size with no own shape in this form: a phone takes the size of the computer's shape. */
function baseSize(widget: LayoutWidget, form: LayoutForm): WidgetSize {
  if (form === "phone" && ownShape(widget.layout.computer, "computer") !== null) return sizeIn(widget, "computer");
  return widget.size;
}

/** The columns and rows of a widget's card in a form. */
export function shapeIn(widget: LayoutWidget, form: LayoutForm): LayoutShape {
  if (!widget.resizable) return { columns: 1, rows: 1 };
  return ownShape(widget.layout[form], form) ?? spanOf(baseSize(widget, form), form);
}

/**
 * The size name that a widget's frame gets in a form. At the default span of its own size, the card
 * keeps that size, so a card with no saved shape gets the size of its manifest, as before (#995).
 * Any other shape gets the nearest size of `sizeOfShape`.
 */
export function sizeIn(widget: LayoutWidget, form: LayoutForm): WidgetSize {
  if (!widget.resizable) return "small";
  const shape = shapeIn(widget, form);
  const base = widget.layout[form]?.size ?? baseSize(widget, form);
  const size = sameShape(shape, spanOf(base, form)) ? base : sizeOfShape(shape);
  // In the grid, a header widget is a 2 x 1 card: only the header slot beside the greeting gives `header`.
  return size === "header" ? "medium" : size;
}

/** The rows that the grid shows: three at least on a computer, so a large card fills the height. */
export function rowsOf(placed: readonly LayoutBox[], form: LayoutForm): number {
  return Math.max(minRows(form), bottomOf(placed));
}

function minRows(form: LayoutForm): number {
  return form === "computer" ? 3 : 1;
}

function bottomOf(boxes: readonly LayoutBox[]): number {
  return Math.max(0, ...boxes.map((box) => box.row + box.rows - 1));
}

/**
 * Places each widget. Saved places come first, in list order; a place that does not fit, or that
 * overlaps an earlier card, is ignored. The other cards follow, after the last saved row, so they
 * never fill a gap that the person left. A phone with no saved place follows the computer's order,
 * and shows an `xlarge` card after the smaller cards. With `widen`, a small phone card that Eva
 * placed by herself, alone in its row, takes the whole row; a card that the person placed keeps its
 * shape. The answer is in reading order.
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
    const { columns, rows } = shapeIn(widget, form);
    const slot = widget.layout[form];
    if (slot?.column !== undefined && slot.row !== undefined && grid.fits(slot.column, slot.row, columns, rows)) {
      grid.take(slot.column, slot.row, columns, rows);
      placed.push({ id: widget.id, size: sizeIn(widget, form), column: slot.column, row: slot.row, columns, rows });
    } else auto.push(widget);
  }
  const start = placed.length === 0 ? 1 : bottomOf(placed) + 1;
  const autoPlaced = new Set<string>();
  for (const widget of autoOrder(auto, widgets, form)) {
    const { columns, rows } = shapeIn(widget, form);
    const { column, row } = grid.firstHole(columns, rows, start);
    grid.take(column, row, columns, rows);
    placed.push({ id: widget.id, size: sizeIn(widget, form), column, row, columns, rows });
    autoPlaced.add(widget.id);
  }
  const shown =
    form === "phone" && options.widen !== false
      ? placed.map((card) =>
          autoPlaced.has(card.id) &&
          card.columns === 1 &&
          card.rows === 1 &&
          grid.free(card.column === 1 ? 2 : 1, card.row)
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

function readingOrder<T extends LayoutBox>(cards: readonly T[]): T[] {
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
    return this.fitsAnyRow(column, row, columns, rows);
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
  const slot: { -readonly [key in keyof LayoutSlot]: LayoutSlot[key] } = {};
  const { column, row, columns, rows, size } = raw;
  if (isWhole(column, maxRow)) slot.column = column;
  if (isWhole(row, maxRow)) slot.row = row;
  if (isWhole(columns, columnsOf("computer"))) slot.columns = columns;
  if (isWhole(rows, maxCardRows)) slot.rows = rows;
  if (typeof size === "string" && (widgetSizes as readonly string[]).includes(size)) slot.size = size as WidgetSize;
  return Object.keys(slot).length === 0 ? null : slot;
}

function isWhole(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
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

/** The slots that the editor saves: the place and the shape of each box, so what the person saw is what shows. */
export function slotsOfBoxes(boxes: readonly LayoutBox[]): LayoutSlots {
  return Object.fromEntries(
    boxes.map((box) => [box.id, { column: box.column, row: box.row, columns: box.columns, rows: box.rows }]),
  );
}

/** The rows of the grid while the person edits it: one spare row below the last used row. */
export function editRows(boxes: readonly LayoutBox[], form: LayoutForm): number {
  return Math.max(minRows(form), bottomOf(boxes) + 1);
}

/** The lowest row that a box may reach: the spare row below the other boxes, or the rows that the grid always shows. */
function lowestRow(others: readonly LayoutBox[], form: LayoutForm): number {
  return Math.min(maxRow, Math.max(minRows(form), bottomOf(others) + 1));
}

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return (
    a.column < b.column + b.columns &&
    b.column < a.column + a.columns &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

/** True when a box fits the grid: inside the columns, and no lower than one row below the other boxes. */
function inGrid(box: LayoutBox, others: readonly LayoutBox[], form: LayoutForm): boolean {
  return (
    Number.isInteger(box.column) &&
    Number.isInteger(box.row) &&
    box.column >= 1 &&
    box.row >= 1 &&
    box.columns >= 1 &&
    box.rows >= 1 &&
    box.rows <= maxCardRows &&
    box.column + box.columns - 1 <= columnsOf(form) &&
    box.row <= lowestRow(others, form)
  );
}

function replaced(boxes: readonly LayoutBox[], ...next: LayoutBox[]): LayoutBox[] {
  return boxes.map((box) => next.find((each) => each.id === box.id) ?? box);
}

/**
 * Moves a box so its top left corner is at a cell. A free place takes it. A box of the same shape
 * exactly at that place swaps places with it. Any other taken place gives null: nothing moves.
 */
export function moveBox(
  boxes: readonly LayoutBox[],
  form: LayoutForm,
  id: string,
  column: number,
  row: number,
): LayoutBox[] | null {
  const box = boxes.find((each) => each.id === id);
  if (box === undefined || (box.column === column && box.row === row)) return null;
  const moved = { ...box, column, row };
  const others = boxes.filter((each) => each.id !== id);
  if (!inGrid(moved, others, form)) return null;
  const hit = others.filter((other) => overlaps(moved, other));
  if (hit.length === 0) return replaced(boxes, moved);
  const other = hit.length === 1 ? hit[0] : undefined;
  if (other?.column !== column || other.row !== row || !sameShape(other, box)) return null;
  return replaced(boxes, moved, { ...other, column: box.column, row: box.row });
}

/** Gives a box a new shape from its top left corner. Null when it does not fit, or when one row more than now is not enough. */
export function resizeBox(
  boxes: readonly LayoutBox[],
  form: LayoutForm,
  id: string,
  columns: number,
  rows: number,
): LayoutBox[] | null {
  const box = boxes.find((each) => each.id === id);
  if (box === undefined || (box.columns === columns && box.rows === rows)) return null;
  const resized = { ...box, columns, rows };
  const others = boxes.filter((each) => each.id !== id);
  // The bottom grows by one row at a time, into the spare row of the grid.
  const lowest = Math.max(lowestRow(others, form), box.row + box.rows);
  if (!inGrid(resized, others, form) || box.row + rows - 1 > lowest) return null;
  if (others.some((other) => overlaps(resized, other))) return null;
  return replaced(boxes, resized);
}

/**
 * The largest shape that fits, no wider and no higher than the one that the pointer asks, for a
 * drag of the corner handle. Null when the box keeps its shape.
 */
export function resizeBoxToward(
  boxes: readonly LayoutBox[],
  form: LayoutForm,
  id: string,
  columns: number,
  rows: number,
): LayoutBox[] | null {
  const box = boxes.find((each) => each.id === id);
  if (box === undefined) return null;
  let best: { area: number; boxes: LayoutBox[] } | null = null;
  for (let width = Math.min(columns, columnsOf(form)); width >= 1; width -= 1)
    for (let height = Math.min(rows, maxCardRows); height >= 1; height -= 1) {
      if (best !== null && width * height <= best.area) continue;
      if (width === box.columns && height === box.rows) {
        best = { area: width * height, boxes: [...boxes] };
        continue;
      }
      const next = resizeBox(boxes, form, id, width, height);
      if (next !== null) best = { area: width * height, boxes: next };
    }
  if (best === null) return null;
  const shaped = best.boxes.find((each) => each.id === id);
  return shaped === undefined || sameShape(shaped, box) ? null : best.boxes;
}

const steps: Readonly<Record<LayoutDirection, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Moves a box one cell in a direction, for an arrow key. A box of the same shape there swaps places
 * with it. Another box in the way is passed: the box goes to the next free place. Null at the edge.
 */
export function stepBox(
  boxes: readonly LayoutBox[],
  form: LayoutForm,
  id: string,
  direction: LayoutDirection,
): LayoutBox[] | null {
  const box = boxes.find((each) => each.id === id);
  if (box === undefined) return null;
  const [dx, dy] = steps[direction];
  const next = moveBox(boxes, form, id, box.column + dx, box.row + dy);
  if (next !== null) return next;
  const others = boxes.filter((each) => each.id !== id);
  for (
    let column = box.column + 2 * dx, row = box.row + 2 * dy;
    inGrid({ ...box, column, row }, others, form);
    column += dx, row += dy
  ) {
    const moved = { ...box, column, row };
    if (!others.some((other) => overlaps(moved, other))) return replaced(boxes, moved);
  }
  return null;
}

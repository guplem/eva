/**
 * The words and the unsaved changes of the layout editor in Settings (#985, #995). The editor and
 * the home grid turn their widgets into `LayoutWidget`s here, so both give `placeHome` the same input.
 */
import {
  fitBoxes,
  headerOf,
  placeHome,
  slotsOfBoxes,
  withHeader,
  withSlots,
  type LayoutBox,
  type LayoutChange,
  type LayoutForm,
  type LayoutShape,
  type LayoutSlots,
  type LayoutWidget,
} from "../../../core/widgets/widget-layout.ts";
import type { WidgetFrame, WidgetItem } from "./api.ts";

/** A new choice of the header slot (#1007): a widget, an empty slot, or the default back. */
export type HeaderDraft = { readonly id: string | null } | "default";

/**
 * The changes of the edit mode, for each form: the boxes as the person left them, or null for
 * "Reset to default". A missing form has no change: it shows the places of the home page. `header`
 * is the change of the header slot, or none.
 */
export interface LayoutDraft {
  readonly computer?: readonly LayoutBox[] | null;
  readonly phone?: readonly LayoutBox[] | null;
  readonly header?: HeaderDraft;
}

/** The cards of the home grid. A card to approve stays 1 x 1. */
export function layoutWidgetsOfFrames(frames: readonly WidgetFrame[]): LayoutWidget[] {
  return frames.map((frame) => ({
    id: frame.id,
    size: frame.size,
    resizable: frame.src !== null,
    layout: frame.layout,
  }));
}

/** The widgets that are on, in list order, as the home grid shows them on this computer. */
export function layoutWidgetsOfItems(items: readonly WidgetItem[]): LayoutWidget[] {
  return items
    .filter((item) => item.state !== "off")
    .map((item) => ({
      id: item.id,
      size: item.state === "on" ? (item.size ?? "small") : "small",
      resizable: item.state === "on",
      layout: item.layout,
    }));
}

function slotsOf(boxes: readonly LayoutBox[] | null): LayoutSlots | null {
  return boxes === null ? null : slotsOfBoxes(boxes);
}

/** The widgets with the changes of the draft, so a phone with no layout of its own follows a changed computer. */
export function draftedWidgets(widgets: readonly LayoutWidget[], draft: LayoutDraft): LayoutWidget[] {
  let next = [...widgets];
  if (draft.computer !== undefined) next = withSlots(next, "computer", slotsOf(draft.computer));
  if (draft.phone !== undefined) next = withSlots(next, "phone", slotsOf(draft.phone));
  if (draft.header !== undefined) next = withHeader(next, headerChange(draft.header));
  return next;
}

function headerChange(header: HeaderDraft): { readonly id: string | null } | null {
  return header === "default" ? null : header;
}

/** The widget that the header slot of the preview shows, or null. */
export function shownHeader(widgets: readonly LayoutWidget[], draft: LayoutDraft): string | null {
  return headerOf(draftedWidgets(widgets, draft));
}

/** The boxes that the preview shows for a form. Boxes of the draft follow the header slot. */
export function shownBoxes(widgets: readonly LayoutWidget[], draft: LayoutDraft, form: LayoutForm): LayoutBox[] {
  const drafted = draftedWidgets(widgets, draft);
  const boxes = draft[form];
  return boxes === undefined || boxes === null
    ? placeHome(drafted, form).cards
    : fitBoxes(boxes, drafted, form, headerOf(drafted));
}

export function draftChanged(draft: LayoutDraft): boolean {
  return draft.computer !== undefined || draft.phone !== undefined || draft.header !== undefined;
}

/**
 * True when "Reset to default" changes something: the form has its own layout, saved or in the
 * draft. The computer tab resets the header slot too.
 */
export function canReset(widgets: readonly LayoutWidget[], draft: LayoutDraft, form: LayoutForm): boolean {
  const boxes = draft[form];
  const ownBoxes = boxes !== undefined ? boxes !== null : widgets.some((widget) => widget.layout[form] !== undefined);
  if (form === "phone" || ownBoxes) return ownBoxes;
  if (draft.header !== undefined) return draft.header !== "default";
  return widgets.some((widget) => widget.layout.header !== undefined);
}

/** The body of the save: only the forms that changed, and the header slot when it changed. */
export function draftChange(draft: LayoutDraft): LayoutChange {
  return {
    ...(draft.computer !== undefined ? { computer: slotsOf(draft.computer) } : {}),
    ...(draft.phone !== undefined ? { phone: slotsOf(draft.phone) } : {}),
    ...(draft.header !== undefined ? { header: headerChange(draft.header) } : {}),
  };
}

/** The shape of a box as the preview shows it, such as "2 × 1". */
export function shapeWords({ columns, rows }: LayoutShape): string {
  return `${String(columns)} × ${String(rows)}`;
}

function count(value: number, word: string): string {
  return `${String(value)} ${word}${value === 1 ? "" : "s"}`;
}

function longShape({ columns, rows }: LayoutShape): string {
  return `${count(columns, "column")} by ${count(rows, "row")}`;
}

function placeWords(box: LayoutBox): string {
  return `column ${String(box.column)}, row ${String(box.row)}`;
}

/** The name of a box of the preview for a screen reader. */
export function boxName(name: string, box: LayoutBox): string {
  return `${name}, ${longShape(box)}, at ${placeWords(box)}`;
}

export function moveWords(name: string, box: LayoutBox): string {
  return `${name} moved to ${placeWords(box)}.`;
}

export function sizeWords(name: string, box: LayoutBox): string {
  return `${name} is ${longShape(box)} now.`;
}

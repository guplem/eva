/**
 * The words and the unsaved changes of the layout editor in Settings (#985). The editor and the
 * home grid turn their widgets into `LayoutWidget`s here, so both give `placeWidgets` the same input.
 */
import { widgetSizes, type WidgetSize } from "../../../core/widgets/widget-kinds.ts";
import {
  spanOf,
  withSlots,
  type LayoutForm,
  type LayoutSlots,
  type LayoutWidget,
  type PlacedWidget,
} from "../../../core/widgets/widget-layout.ts";
import type { WidgetFrame, WidgetItem } from "./api.ts";

/** The unsaved slots of each form. A missing form is unchanged; null goes back to the default. */
export interface LayoutDraft {
  readonly computer?: LayoutSlots | null;
  readonly phone?: LayoutSlots | null;
}

/** The cards of the home grid. A card to approve stays small. */
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

export function drafted(widgets: readonly LayoutWidget[], draft: LayoutDraft): LayoutWidget[] {
  let next = [...widgets];
  if (draft.computer !== undefined) next = withSlots(next, "computer", draft.computer);
  if (draft.phone !== undefined) next = withSlots(next, "phone", draft.phone);
  return next;
}

export function draftChanged(draft: LayoutDraft): boolean {
  return draft.computer !== undefined || draft.phone !== undefined;
}

/** True when a widget has its own slot in this form, so "Reset to default" changes something. */
export function hasOwnLayout(widgets: readonly LayoutWidget[], form: LayoutForm): boolean {
  return widgets.some((widget) => widget.layout[form] !== undefined);
}

/** The body of the save: only the forms that changed. */
export function draftChange(draft: LayoutDraft): Partial<Record<LayoutForm, LayoutSlots | null>> {
  return {
    ...(draft.computer !== undefined ? { computer: draft.computer } : {}),
    ...(draft.phone !== undefined ? { phone: draft.phone } : {}),
  };
}

const sizeNames: Readonly<Record<WidgetSize, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  tall: "Tall",
  xlarge: "Extra large",
};

/** A size with its span in this form, such as "Medium 2 × 1". */
export function sizeLabel(size: WidgetSize, form: LayoutForm): string {
  const { columns, rows } = spanOf(size, form);
  return `${sizeNames[size]} ${String(columns)} × ${String(rows)}`;
}

export function sizeChoices(form: LayoutForm): { value: WidgetSize; label: string }[] {
  return widgetSizes.map((size) => ({ value: size, label: sizeLabel(size, form) }));
}

export function placeWords(column: number, row: number): string {
  return `column ${String(column)}, row ${String(row)}`;
}

/** The name of a box of the preview for a screen reader. */
export function boxName(card: PlacedWidget, name: string, form: LayoutForm): string {
  return `${name}, ${sizeLabel(card.size, form).toLowerCase()}, ${placeWords(card.column, card.row)}`;
}

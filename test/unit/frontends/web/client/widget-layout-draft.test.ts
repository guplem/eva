import { describe, expect, test } from "bun:test";
import { placeWidgets } from "../../../../../src/core/widgets/widget-layout.ts";
import type { WidgetFrame, WidgetItem } from "../../../../../src/frontends/web/client/api.ts";
import {
  boxName,
  draftChange,
  draftChanged,
  drafted,
  hasOwnLayout,
  layoutWidgetsOfFrames,
  layoutWidgetsOfItems,
  sizeChoices,
} from "../../../../../src/frontends/web/client/widget-layout-draft.ts";

function item(id: string, state: WidgetItem["state"], size: WidgetItem["size"], layout = {}): WidgetItem {
  return {
    id,
    repository: `https://github.com/${id}`,
    owner: "example-owner",
    name: id,
    sources: ["list"],
    state,
    size,
    layout,
    problems: [],
    update: null,
    checkProblem: null,
  };
}

function frame(id: string, size: WidgetFrame["size"], approved: boolean, layout = {}): WidgetFrame {
  return { id, name: id, size, layout, src: approved ? "/widgets/token/index.html" : null, token: null };
}

describe("the same widgets for the editor and the home grid", () => {
  test("the list and the frames give the same places", () => {
    const layout = { computer: { column: 4, row: 1 } };
    const items = [
      item("a/calendar", "on", "xlarge"),
      item("a/off", "off", "medium"),
      item("a/cases", "approve", "tall"),
      item("a/habits", "on", "small", layout),
    ];
    const frames = [
      frame("a/calendar", "xlarge", true),
      frame("a/cases", "tall", false),
      frame("a/habits", "small", true, layout),
    ];
    for (const form of ["computer", "phone"] as const)
      expect(placeWidgets(layoutWidgetsOfItems(items), form)).toEqual(
        placeWidgets(layoutWidgetsOfFrames(frames), form),
      );
    expect(layoutWidgetsOfItems(items).map((widget) => [widget.id, widget.size, widget.resizable])).toEqual([
      ["a/calendar", "xlarge", true],
      ["a/cases", "small", false],
      ["a/habits", "small", true],
    ]);
  });
});

describe("the draft", () => {
  const widgets = layoutWidgetsOfItems([item("a/one", "on", "small", { phone: { column: 2, row: 1 } })]);

  test("applies the changed forms only, and sends only them", () => {
    expect(draftChanged({})).toBe(false);
    const draft = { computer: { "a/one": { column: 3, row: 1 } }, phone: null };
    expect(draftChanged(draft)).toBe(true);
    expect(drafted(widgets, draft)[0]?.layout).toEqual({ computer: { column: 3, row: 1 } });
    expect(drafted(widgets, {})[0]?.layout).toEqual({ phone: { column: 2, row: 1 } });
    expect(draftChange({ phone: null })).toEqual({ phone: null });
  });

  test("knows when a form has its own layout", () => {
    expect(hasOwnLayout(widgets, "phone")).toBe(true);
    expect(hasOwnLayout(widgets, "computer")).toBe(false);
  });
});

describe("the words", () => {
  test("names each size with its span in the form, and each box with its place", () => {
    expect(sizeChoices("computer").map((choice) => choice.label)).toEqual([
      "Small 1 × 1",
      "Medium 2 × 1",
      "Large 4 × 1",
      "Tall 1 × 2",
      "Extra large 3 × 3",
    ]);
    expect(sizeChoices("phone")[4]?.label).toBe("Extra large 2 × 3");
    const card = { id: "a", size: "tall" as const, column: 4, row: 1, columns: 1, rows: 2 };
    expect(boxName(card, "Cases", "computer")).toBe("Cases, tall 1 × 2, column 4, row 1");
  });
});

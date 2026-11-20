import { describe, expect, test } from "bun:test";
import type { WidgetSize } from "../../../../src/core/widgets/widget-kinds.ts";
import {
  arrangements,
  layoutTargets,
  moveWidget,
  nudgeWidget,
  placeWidgets,
  readLayout,
  resizeWidget,
  rowsOf,
  swapWidgets,
  withSlots,
  type LayoutForm,
  type LayoutWidget,
  type WidgetLayout,
} from "../../../../src/core/widgets/widget-layout.ts";

function widget(id: string, size: WidgetSize, layout: WidgetLayout = {}, resizable = true): LayoutWidget {
  return { id, size, resizable, layout };
}

/** Each card as "id column,row columns x rows", in reading order. */
function picture(widgets: readonly LayoutWidget[], form: LayoutForm, widen = true): string[] {
  return placeWidgets(widgets, form, { widen }).map(
    (card) => `${card.id} ${card.column},${card.row} ${card.columns}x${card.rows}`,
  );
}

// The list of the owner's report: Cases (tall), Calendar (xlarge), Weather (small).
const owner = [widget("cases", "tall"), widget("calendar", "xlarge"), widget("weather", "small")];

describe("placeWidgets with no saved layout", () => {
  test("a computer places the list in order, each card in the first hole where it fits, as CSS dense placement did", () => {
    expect(picture(owner, "computer")).toEqual(["cases 1,1 1x2", "calendar 2,1 3x3", "weather 1,3 1x1"]);
  });

  test("a phone shows xlarge after the smaller cards, and a lone small card takes the whole row", () => {
    expect(picture(owner, "phone")).toEqual(["cases 1,1 2x2", "weather 1,3 2x1", "calendar 1,4 2x3"]);
  });

  test("two small cards share a phone row", () => {
    const list = [widget("a", "small"), widget("b", "medium"), widget("c", "small"), widget("d", "small")];
    expect(picture(list, "phone")).toEqual(["a 1,1 1x1", "c 2,1 1x1", "b 1,2 2x1", "d 1,3 2x1"]);
  });

  test("a widget to approve is small, whatever its saved size", () => {
    const list = [widget("calendar", "xlarge", { computer: { size: "large" } }, false)];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 1x1"]);
  });

  test("a computer always has three rows, a phone only its cards", () => {
    expect(rowsOf(placeWidgets([widget("a", "small")], "computer"), "computer")).toBe(3);
    expect(rowsOf(placeWidgets([widget("a", "small")], "phone"), "phone")).toBe(1);
    expect(rowsOf(placeWidgets(owner, "phone"), "phone")).toBe(6);
  });
});

describe("placeWidgets with a saved layout", () => {
  test("a saved place wins, and a gap stays", () => {
    const list = [
      widget("calendar", "xlarge", { computer: { column: 1, row: 1 } }),
      widget("cases", "tall", { computer: { column: 4, row: 1 } }),
      // Row 3 of column 4 stays empty: the person left a gap.
      widget("weather", "small", { computer: { column: 1, row: 4 } }),
    ];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 3x3", "cases 4,1 1x2", "weather 1,4 1x1"]);
  });

  test("a saved size changes the span, and a phone with no own size takes the computer's", () => {
    const list = [widget("calendar", "xlarge", { computer: { column: 1, row: 1, size: "medium" } })];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 2x1"]);
    expect(placeWidgets(list, "phone")[0]?.size).toBe("medium");
  });

  test("a place that does not fit, or overlaps an earlier card, is ignored, and the card goes after the saved cards", () => {
    const list = [
      widget("a", "small", { computer: { column: 1, row: 1 } }),
      widget("b", "small", { computer: { column: 1, row: 1 } }),
      widget("c", "medium", { computer: { column: 4, row: 2 } }),
      widget("d", "small"),
    ];
    expect(picture(list, "computer")).toEqual(["a 1,1 1x1", "b 1,2 1x1", "c 2,2 2x1", "d 4,2 1x1"]);
  });

  test("a new card does not fill a gap that the person left", () => {
    const list = [widget("a", "small", { computer: { column: 1, row: 2 } }), widget("b", "small")];
    expect(picture(list, "computer")).toEqual(["a 1,2 1x1", "b 1,3 1x1"]);
  });

  test("a phone with no saved layout follows the computer's order, with no gaps", () => {
    const list = [
      widget("a", "small", { computer: { column: 4, row: 3 } }),
      widget("b", "small", { computer: { column: 1, row: 1 } }),
      widget("c", "medium", { computer: { column: 2, row: 2 } }),
    ];
    // Dense placement pairs the two small cards, as the grid always did.
    expect(picture(list, "phone")).toEqual(["b 1,1 1x1", "a 2,1 1x1", "c 1,2 2x1"]);
  });

  test("the phone layout is apart from the computer layout", () => {
    const list = [
      widget("a", "small", { computer: { column: 1, row: 1 }, phone: { column: 2, row: 2 } }),
      widget("b", "small", { computer: { column: 2, row: 1 }, phone: { column: 1, row: 1 } }),
    ];
    expect(picture(list, "phone", false)).toEqual(["b 1,1 1x1", "a 2,2 1x1"]);
    expect(picture(list, "computer")).toEqual(["a 1,1 1x1", "b 2,1 1x1"]);
  });
});

describe("readLayout", () => {
  test("keeps each good value and drops each bad one", () => {
    expect(readLayout(undefined)).toEqual({});
    expect(readLayout("text")).toEqual({});
    expect(
      readLayout({
        computer: { column: 2, row: 3, size: "tall", extra: true },
        phone: { column: 0, row: 1.5, size: "huge" },
      }),
    ).toEqual({ computer: { column: 2, row: 3, size: "tall" } });
  });
});

describe("editing", () => {
  const list = [widget("calendar", "xlarge"), widget("habits", "small"), widget("cases", "tall")];

  test("moves a card to a free place, and saves each card's place", () => {
    const slots = moveWidget(list, "computer", "habits", 1, 4);
    expect(slots).toEqual({
      calendar: { column: 1, row: 1 },
      habits: { column: 1, row: 4 },
      cases: { column: 4, row: 2 },
    });
    expect(moveWidget(list, "computer", "habits", 2, 1)).toBeNull();
    expect(moveWidget(list, "computer", "habits", 4, 3)).toBeNull();
  });

  test("lists the free places where a card fits, one row below the others at most", () => {
    expect(layoutTargets(list, "computer", "calendar")).toEqual([
      { column: 1, row: 2 },
      { column: 1, row: 3 },
      { column: 1, row: 4 },
      { column: 2, row: 4 },
    ]);
    expect(layoutTargets(list, "computer", "habits")).toContainEqual({ column: 4, row: 4 });
  });

  test("swaps two cards when each fits in the other's place, the second one right after the first", () => {
    expect(swapWidgets(list, "computer", "habits", "cases")).toEqual({
      calendar: { column: 1, row: 1 },
      habits: { column: 4, row: 3 },
      cases: { column: 4, row: 1 },
    });
    expect(swapWidgets(list, "computer", "habits", "calendar")).toBeNull();
  });

  test("nudges a card to the next free place in a direction", () => {
    // Cases fills rows 2 and 3 below Habits, so Habits goes past it.
    expect(nudgeWidget(list, "computer", "habits", "down")?.["habits"]).toEqual({ column: 4, row: 4 });
    expect(nudgeWidget(list, "computer", "habits", "right")).toBeNull();
    expect(nudgeWidget(list, "computer", "habits", "up")).toBeNull();
    expect(nudgeWidget(list, "computer", "cases", "down")?.["cases"]).toEqual({ column: 4, row: 3 });
  });

  test("a new size keeps the place when it fits, and moves the card when it does not", () => {
    const smaller = resizeWidget(list, "computer", "calendar", "medium");
    expect(smaller["calendar"]).toEqual({ column: 1, row: 1, size: "medium" });
    const wider = resizeWidget(list, "computer", "habits", "medium");
    expect(wider["habits"]).toEqual({ column: 1, row: 4, size: "medium" });
    // Back to the size of its manifest: nothing to save.
    expect(resizeWidget(withSlots(list, "computer", smaller), "computer", "calendar", "xlarge")["calendar"]).toEqual({
      column: 1,
      row: 1,
    });
  });

  test("withSlots replaces the slots of one form only", () => {
    const saved = withSlots(list, "phone", { habits: { column: 2, row: 1 } });
    expect(saved[1]?.layout).toEqual({ phone: { column: 2, row: 1 } });
    expect(withSlots(saved, "phone", null)[1]?.layout).toEqual({});
  });
});

describe("arrangements", () => {
  test("a computer offers the big widget left, right, and the smaller widgets on top", () => {
    const offered = arrangements(owner, "computer");
    expect(offered.map((each) => each.id)).toEqual(["big-left", "big-right", "small-top"]);
    const place = (id: string): string[] =>
      picture(withSlots(owner, "computer", offered.find((each) => each.id === id)?.slots ?? null), "computer");
    expect(place("big-left")).toEqual(["calendar 1,1 3x3", "cases 4,1 1x2", "weather 4,3 1x1"]);
    expect(place("big-right")).toEqual(["cases 1,1 1x2", "calendar 2,1 3x3", "weather 1,3 1x1"]);
    expect(place("small-top")).toEqual(["weather 1,1 1x1", "cases 2,1 1x2", "calendar 1,3 3x3"]);
  });

  test("a phone offers the big widget last or first", () => {
    const offered = arrangements(owner, "phone");
    expect(offered.map((each) => each.id)).toEqual(["big-last", "big-first"]);
    const first = offered[1]?.slots ?? null;
    expect(picture(withSlots(owner, "phone", first), "phone")).toEqual([
      "calendar 1,1 2x3",
      "cases 1,4 2x2",
      "weather 1,6 2x1",
    ]);
  });

  test("an arrangement that gives the same result as another shows once", () => {
    const wide = [widget("a", "large"), widget("b", "small"), widget("c", "small")];
    expect(arrangements(wide, "computer").map((each) => each.id)).toEqual(["big-left", "small-top"]);
  });

  test("widgets of one size, or one widget, get no arrangement", () => {
    expect(arrangements([widget("a", "small"), widget("b", "small")], "computer")).toEqual([]);
    expect(arrangements([widget("a", "xlarge")], "computer")).toEqual([]);
  });
});

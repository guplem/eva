import { describe, expect, test } from "bun:test";
import type { WidgetSize } from "../../../../src/core/widgets/widget-kinds.ts";
import {
  editRows,
  fitBoxes,
  headerOf,
  placeHome,
  moveBox,
  placeWidgets,
  readLayout,
  resizeBox,
  resizeBoxToward,
  rowsOf,
  shapeIn,
  sizeIn,
  sizeOfShape,
  slotsOfBoxes,
  stepBox,
  withHeader,
  withSlots,
  type LayoutBox,
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

/** Each box as "id column,row columns x rows", in reading order. */
function boxes(list: readonly LayoutBox[] | null): string[] | null {
  if (list === null) return null;
  return [...list]
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((box) => `${box.id} ${box.column},${box.row} ${box.columns}x${box.rows}`);
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

  test("a header widget outside the header slot is a 2 x 1 card that gets the size medium", () => {
    const summary = [widget("summary", "header")];
    expect(picture(summary, "computer")).toEqual(["summary 1,1 2x1"]);
    expect(picture(summary, "phone")).toEqual(["summary 1,1 2x1"]);
    expect(placeWidgets(summary, "computer")[0]?.size).toBe("medium");
    expect(placeWidgets(summary, "phone")[0]?.size).toBe("medium");
  });

  test("two small cards share a phone row", () => {
    const list = [widget("a", "small"), widget("b", "medium"), widget("c", "small"), widget("d", "small")];
    expect(picture(list, "phone")).toEqual(["a 1,1 1x1", "c 2,1 1x1", "b 1,2 2x1", "d 1,3 2x1"]);
  });

  test("each card keeps the size of its manifest, also a small card that takes a whole phone row", () => {
    expect(placeWidgets(owner, "computer").map((card) => card.size)).toEqual(["tall", "xlarge", "small"]);
    expect(placeWidgets(owner, "phone").map((card) => card.size)).toEqual(["tall", "small", "xlarge"]);
  });

  test("a widget to approve is small, whatever its saved shape", () => {
    const list = [widget("calendar", "xlarge", { computer: { columns: 4, rows: 2 } }, false)];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 1x1"]);
    expect(placeWidgets(list, "computer")[0]?.size).toBe("small");
  });

  test("a computer always has three rows, a phone only its cards", () => {
    expect(rowsOf(placeWidgets([widget("a", "small")], "computer"), "computer")).toBe(3);
    expect(rowsOf(placeWidgets([widget("a", "small")], "phone"), "phone")).toBe(1);
    expect(rowsOf(placeWidgets(owner, "phone"), "phone")).toBe(6);
  });
});

describe("placeWidgets with a saved layout", () => {
  test("a saved place and shape win, and a gap stays", () => {
    const list = [
      widget("calendar", "xlarge", { computer: { column: 1, row: 1, columns: 2, rows: 2 } }),
      widget("cases", "tall", { computer: { column: 4, row: 1, columns: 1, rows: 3 } }),
      // Column 3 stays empty: the person left a gap.
      widget("weather", "small", { computer: { column: 1, row: 3, columns: 2, rows: 1 } }),
    ];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 2x2", "cases 4,1 1x3", "weather 1,3 2x1"]);
  });

  test("a layout saved with a size and no columns or rows keeps its span and its size", () => {
    const list = [widget("calendar", "xlarge", { computer: { column: 1, row: 1, size: "medium" } })];
    expect(picture(list, "computer")).toEqual(["calendar 1,1 2x1"]);
    expect(placeWidgets(list, "computer")[0]?.size).toBe("medium");
    // A phone with no own slot takes the computer's size, with its span on a phone.
    expect(placeWidgets(list, "phone")[0]?.size).toBe("medium");
    const tall = [widget("cases", "small", { phone: { column: 1, row: 1, size: "tall" } })];
    expect(picture(tall, "phone")).toEqual(["cases 1,1 2x2"]);
    expect(placeWidgets(tall, "phone")[0]?.size).toBe("tall");
  });

  test("a shape that is too wide for the form is ignored", () => {
    const list = [widget("a", "small", { phone: { column: 1, row: 1, columns: 3, rows: 1 } })];
    expect(picture(list, "phone", false)).toEqual(["a 1,1 1x1"]);
  });

  test("a phone with no own slot takes the size of the computer's shape, with its span on a phone", () => {
    const calendar = widget("calendar", "small", { computer: { column: 1, row: 1, columns: 3, rows: 2 } });
    expect(shapeIn(calendar, "phone")).toEqual({ columns: 2, rows: 3 });
    expect(sizeIn(calendar, "phone")).toBe("xlarge");
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

  test("a small card that the person placed alone in a phone row keeps its one column", () => {
    const list = [
      widget("a", "small", { phone: { column: 1, row: 1, columns: 1, rows: 1 } }),
      widget("b", "medium", { phone: { column: 1, row: 2, columns: 2, rows: 1 } }),
    ];
    expect(picture(list, "phone")).toEqual(["a 1,1 1x1", "b 1,2 2x1"]);
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

describe("sizeOfShape: the size name that a frame gets for a shape", () => {
  test("gives the size of each shape of the contract", () => {
    expect(sizeOfShape({ columns: 1, rows: 1 })).toBe("small");
    expect(sizeOfShape({ columns: 2, rows: 1 })).toBe("medium");
    expect(sizeOfShape({ columns: 4, rows: 1 })).toBe("large");
    expect(sizeOfShape({ columns: 1, rows: 2 })).toBe("tall");
    expect(sizeOfShape({ columns: 3, rows: 3 })).toBe("xlarge");
  });

  test("gives the nearest size to every other shape", () => {
    expect(sizeOfShape({ columns: 3, rows: 1 })).toBe("large");
    expect(sizeOfShape({ columns: 1, rows: 4 })).toBe("tall");
    // A square of four cells is `large`, as `large` is on a phone.
    expect(sizeOfShape({ columns: 2, rows: 2 })).toBe("large");
    // Six cells or more, two wide and two high at least.
    expect(sizeOfShape({ columns: 3, rows: 2 })).toBe("xlarge");
    expect(sizeOfShape({ columns: 2, rows: 3 })).toBe("xlarge");
    expect(sizeOfShape({ columns: 4, rows: 4 })).toBe("xlarge");
  });

  test("a card keeps the size of its manifest at the span of that size, and takes the rule's size at another shape", () => {
    const tall = widget("cases", "tall", { phone: { column: 1, row: 1, columns: 2, rows: 2 } });
    expect(sizeIn(tall, "phone")).toBe("tall");
    const wide = widget("cases", "tall", { computer: { column: 1, row: 1, columns: 2, rows: 2 } });
    expect(sizeIn(wide, "computer")).toBe("large");
    expect(placeWidgets([wide], "computer")[0]?.size).toBe("large");
  });
});

describe("readLayout", () => {
  test("keeps each good value and drops each bad one", () => {
    expect(readLayout(undefined)).toEqual({});
    expect(readLayout("text")).toEqual({});
    expect(
      readLayout({
        computer: { column: 2, row: 3, columns: 2, rows: 3, size: "tall", extra: true },
        phone: { column: 0, row: 1.5, columns: 5, rows: 0, size: "huge" },
      }),
    ).toEqual({ computer: { column: 2, row: 3, columns: 2, rows: 3, size: "tall" } });
  });
});

describe("editing the boxes", () => {
  // Calendar 1,1 3x3; Habits 4,1 1x1; Cases 4,2 1x2.
  const start = placeWidgets(
    [widget("calendar", "xlarge"), widget("habits", "small"), widget("cases", "tall")],
    "computer",
  );

  test("the grid shows one spare row below the last used row", () => {
    expect(editRows(start, "computer")).toBe(4);
    expect(editRows(placeWidgets([widget("a", "small")], "phone"), "phone")).toBe(2);
  });

  test("moves a box to a free place, and does nothing on a taken place", () => {
    expect(boxes(moveBox(start, "computer", "habits", 1, 4))).toEqual([
      "calendar 1,1 3x3",
      "cases 4,2 1x2",
      "habits 1,4 1x1",
    ]);
    expect(moveBox(start, "computer", "habits", 2, 1)).toBeNull();
    // Out of the grid, or past the spare row.
    expect(moveBox(start, "computer", "habits", 5, 1)).toBeNull();
    expect(moveBox(start, "computer", "habits", 1, 5)).toBeNull();
    expect(moveBox(start, "computer", "calendar", 2, 1)).toBeNull();
  });

  test("a box dropped exactly on a box of the same size swaps places with it", () => {
    const two = placeWidgets([widget("a", "small"), widget("b", "small")], "computer");
    expect(boxes(moveBox(two, "computer", "a", 2, 1))).toEqual(["b 1,1 1x1", "a 2,1 1x1"]);
    // Cases is taller than Habits: no swap.
    expect(moveBox(start, "computer", "habits", 4, 2)).toBeNull();
  });

  test("resizes a box in whole cells, up to the grid edge and the other boxes", () => {
    const moved = moveBox(start, "computer", "habits", 1, 4) ?? [];
    expect(boxes(resizeBox(moved, "computer", "habits", 3, 1))).toContain("habits 1,4 3x1");
    expect(boxes(resizeBox(moved, "computer", "habits", 4, 1))).toContain("habits 1,4 4x1");
    expect(resizeBox(moved, "computer", "habits", 5, 1)).toBeNull();
    expect(resizeBox(start, "computer", "calendar", 4, 3)).toBeNull();
    // One row more than the box has now, at a time.
    expect(boxes(resizeBox(moved, "computer", "habits", 1, 2))).toContain("habits 1,4 1x2");
    expect(resizeBox(moved, "computer", "habits", 1, 3)).toBeNull();
    expect(boxes(resizeBox(start, "computer", "calendar", 2, 2))).toContain("calendar 1,1 2x2");
    expect(resizeBox(start, "computer", "calendar", 0, 2)).toBeNull();
  });

  test("a drag of the handle takes the largest shape that fits, up to the shape that the pointer asks", () => {
    const moved = moveBox(start, "computer", "habits", 1, 4) ?? [];
    // The pointer asks for 4 x 3 in one move: one row more is the limit, and the width fits.
    expect(boxes(resizeBoxToward(moved, "computer", "habits", 4, 3))).toContain("habits 1,4 4x2");
    // Calendar cannot reach column 4, where Habits and Cases are: its shape stays, so nothing changes.
    expect(resizeBoxToward(start, "computer", "calendar", 4, 3)).toBeNull();
    expect(boxes(resizeBoxToward(start, "computer", "calendar", 4, 2))).toContain("calendar 1,1 3x2");
  });

  test("a box has eight rows at most", () => {
    let list: readonly LayoutBox[] = placeWidgets([widget("a", "small")], "phone");
    for (let rows = 2; rows <= 8; rows += 1) list = resizeBox(list, "phone", "a", 1, rows) ?? [];
    expect(boxes(list)).toEqual(["a 1,1 1x8"]);
    expect(resizeBox(list, "phone", "a", 1, 9)).toBeNull();
  });

  test("an arrow moves a box one cell, past the boxes in the way", () => {
    expect(boxes(stepBox(start, "computer", "habits", "down"))).toContain("habits 4,4 1x1");
    expect(stepBox(start, "computer", "habits", "up")).toBeNull();
    expect(stepBox(start, "computer", "habits", "right")).toBeNull();
    expect(boxes(stepBox(start, "computer", "cases", "down"))).toContain("cases 4,3 1x2");
    const two = placeWidgets([widget("a", "small"), widget("b", "small")], "computer");
    expect(boxes(stepBox(two, "computer", "a", "right"))).toEqual(["b 1,1 1x1", "a 2,1 1x1"]);
  });

  test("the saved slots hold the place and the shape of each box", () => {
    expect(slotsOfBoxes(start)).toEqual({
      calendar: { column: 1, row: 1, columns: 3, rows: 3 },
      habits: { column: 4, row: 1, columns: 1, rows: 1 },
      cases: { column: 4, row: 2, columns: 1, rows: 2 },
    });
  });

  test("withSlots replaces the slots of one form only", () => {
    const list = [widget("habits", "small")];
    const saved = withSlots(list, "phone", { habits: { column: 2, row: 1 } });
    expect(saved[0]?.layout).toEqual({ phone: { column: 2, row: 1 } });
    expect(withSlots(saved, "phone", null)[0]?.layout).toEqual({});
  });
});

describe("the header slot beside the greeting", () => {
  test("a widget of the size header goes to the slot by default, and the grid places the rest", () => {
    const list = [widget("calendar", "xlarge"), widget("summary", "header"), widget("habits", "small")];
    expect(headerOf(list)).toBe("summary");
    const home = placeHome(list, "computer");
    expect(home.header).toBe("summary");
    expect(home.cards.map((card) => card.id)).toEqual(["calendar", "habits"]);
    expect(placeHome(list, "phone").header).toBe("summary");
    expect(placeHome(list, "phone").cards.map((card) => card.id)).not.toContain("summary");
  });

  test("the first header widget in list order takes the free slot, and the second goes to the grid", () => {
    const list = [widget("a", "header"), widget("b", "header")];
    expect(headerOf(list)).toBe("a");
    const cards = placeHome(list, "computer").cards;
    expect(cards.map((card) => `${card.id} ${card.column},${card.row} ${card.columns}x${card.rows}`)).toEqual([
      "b 1,1 2x1",
    ]);
    // Outside the slot, a header widget gets the size of its shape.
    expect(cards[0]?.size).toBe("medium");
  });

  test("a saved choice wins over the default, and a header widget that the person took out stays out", () => {
    expect(headerOf([widget("summary", "header"), widget("habits", "small", { header: true })])).toBe("habits");
    expect(headerOf([widget("summary", "header", { header: false })])).toBeNull();
    expect(headerOf([widget("habits", "small")])).toBeNull();
  });

  test("a widget that waits for approval never takes the slot", () => {
    expect(headerOf([widget("summary", "header", {}, false)])).toBeNull();
    expect(headerOf([widget("habits", "small", { header: true }, false), widget("summary", "header")])).toBe("summary");
  });

  test("with no widget in the slot, the grid is as before", () => {
    const list = [widget("calendar", "xlarge"), widget("habits", "small")];
    expect(placeHome(list, "computer")).toEqual({ header: null, cards: placeWidgets(list, "computer") });
  });

  test("readLayout reads the choice of the slot, and drops a bad value", () => {
    expect(readLayout({ header: true })).toEqual({ header: true });
    expect(readLayout({ header: false, phone: { column: 1, row: 1 } })).toEqual({
      header: false,
      phone: { column: 1, row: 1 },
    });
    expect(readLayout({ header: "yes" })).toEqual({});
  });

  test("withSlots keeps the choice of the slot", () => {
    const saved = withSlots([widget("habits", "small", { header: true })], "computer", null);
    expect(saved[0]?.layout).toEqual({ header: true });
  });
});

describe("fitBoxes: the boxes of a form after the slot changes", () => {
  const list = [widget("calendar", "xlarge"), widget("summary", "header"), widget("habits", "small")];

  test("drops the box of the widget in the slot, and adds a box for a widget that left it", () => {
    const start = placeWidgets(list, "computer");
    expect(boxes(fitBoxes(start, list, "computer", "summary"))).toEqual(["calendar 1,1 3x3", "habits 4,1 1x1"]);
    const without = start.filter((box) => box.id !== "summary");
    expect(boxes(fitBoxes(without, list, "computer", null))).toEqual([
      "calendar 1,1 3x3",
      "habits 4,1 1x1",
      "summary 1,4 2x1",
    ]);
  });

  test("puts a box that left the slot at the cell that the person chose when it is free", () => {
    const without = placeWidgets(list, "computer").filter((box) => box.id !== "summary");
    expect(boxes(fitBoxes(without, list, "computer", null, { id: "summary", column: 3, row: 4 }))).toEqual([
      "calendar 1,1 3x3",
      "habits 4,1 1x1",
      "summary 3,4 2x1",
    ]);
    // A taken cell gives the first hole instead.
    expect(boxes(fitBoxes(without, list, "computer", null, { id: "summary", column: 1, row: 1 }))).toContain(
      "summary 1,4 2x1",
    );
  });

  test("drops the box of a widget that is no longer in the list", () => {
    const start = placeWidgets(list, "computer");
    expect(boxes(fitBoxes(start, [widget("calendar", "xlarge")], "computer", null))).toEqual(["calendar 1,1 3x3"]);
  });
});

describe("withHeader: a new choice of the header slot", () => {
  test("marks the chosen widget, keeps a header widget out, and a reset clears every choice", () => {
    const list = [widget("summary", "header"), widget("habits", "small", { header: true })];
    expect(withHeader(list, { id: "habits" }).map((each) => each.layout)).toEqual([
      { header: false },
      { header: true },
    ]);
    expect(withHeader(list, { id: null }).map((each) => each.layout)).toEqual([{ header: false }, {}]);
    expect(withHeader(list, null).map((each) => each.layout)).toEqual([{}, {}]);
  });
});

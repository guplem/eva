import { describe, expect, test } from "bun:test";
import {
  afterLoad,
  answerPages,
  keptWords,
  pinnedLayout,
  pinnedMinWidth,
  maxPageTries,
  pageFailedNote,
  pageLabel,
  pageName,
  pageNote,
} from "../../../../../src/frontends/web/client/page-frames.ts";

describe("answerPages (#1129)", () => {
  test("lists each page of the whole answer once, and no file to send", () => {
    const answer =
      "A chart.\n[[show: .eva/scratch/week.html]]\n\nAgain.\n[[show: .eva/scratch/week.html]]\n[[attach: Notes/a.md]]";
    expect(answerPages(answer)).toEqual([".eva/scratch/week.html"]);
  });

  test("gives no page for a marker in a code fence", () => {
    expect(answerPages("```\n[[show: a.html]]\n```")).toEqual([]);
  });
});

describe("pageName", () => {
  test("names a page by its file, without the extension", () => {
    expect(pageName(".eva/scratch/steps-this-week.html")).toBe("steps-this-week");
    expect(pageName(".eva\\scratch\\Chart.HTM")).toBe("Chart");
    expect(pageName("page")).toBe("page");
  });
});

describe("afterLoad", () => {
  test("shows a served page, asks again for a page that its token did not serve, then gives up", () => {
    expect(afterLoad(true, 1)).toBe("ready");
    expect(afterLoad(false, 1)).toBe("retry");
    expect(afterLoad(false, maxPageTries - 1)).toBe("retry");
    expect(afterLoad(false, maxPageTries)).toBe("failed");
    expect(pageFailedNote).toBe("Eva could not load this page. Reload the chat to try again.");
  });
});

describe("pageLabel", () => {
  test("says that the frame is a page", () => {
    expect(pageLabel(".eva/scratch/sales-2026-11.html")).toBe("Page: sales-2026-11");
  });
});

describe("pageNote", () => {
  test("says why the answer shows no page", () => {
    // A removed saved page gives the same note, so it does not say that Eva deleted it (#1130).
    expect(pageNote({ state: "gone", reason: "x" })).toBe(
      "This page is gone. Eva deletes a page that nobody saved after 7 days.",
    );
    expect(pageNote({ state: "too-large", reason: "x" })).toBe(
      "This page is larger than 2 MB, so Eva does not show it.",
    );
    expect(pageNote({ state: "refused", reason: "a.html holds a secret, so Eva does not show it." })).toBe(
      "a.html holds a secret, so Eva does not show it.",
    );
  });
});

describe("pinnedLayout (#1130)", () => {
  // The Chats list is 300 px. The chat keeps 480 px, the column 320 px, and the inspector takes 300 px.
  test("shows the column while the chat keeps its width, and the bar of the phone below that", () => {
    expect(pinnedLayout({ layout: 1204, list: 300, column: 400, inspector: false })).toMatchObject({
      place: "column",
      width: 400,
    });
    expect(pinnedLayout({ layout: 1100, list: 300, column: 400, inspector: false })).toMatchObject({
      place: "column",
      width: 320,
    });
    expect(pinnedLayout({ layout: 1099, list: 300, column: 400, inspector: false }).place).toBe("bar");
    expect(pinnedLayout({ layout: 700, list: 0, column: 400, inspector: false }).place).toBe("bar");
  });

  test("keeps the inspector beside the column while the chat stays comfortable, and puts it over the column otherwise", () => {
    // A 1920 px window: the chat keeps 844 px with both columns.
    expect(pinnedLayout({ layout: 1844, list: 300, column: 400, inspector: true })).toEqual({
      place: "column",
      width: 400,
      inspector: "beside",
    });
    expect(pinnedLayout({ layout: 1640, list: 300, column: 400, inspector: true }).inspector).toBe("beside");
    // A 1600 px window: three columns would leave the chat 524 px, so the details cover the page.
    expect(pinnedLayout({ layout: 1524, list: 300, column: 400, inspector: true }).inspector).toBe("over");
    expect(pinnedLayout({ layout: 1204, list: 300, column: 400, inspector: true })).toEqual({
      place: "column",
      width: 400,
      inspector: "over",
    });
    expect(pinnedLayout({ layout: 900, list: 300, column: 400, inspector: true })).toEqual({
      place: "bar",
      width: 400,
      inspector: "beside",
    });
  });

  test("never gives the column less than its minimum or more than the chat leaves", () => {
    expect(pinnedLayout({ layout: 2000, list: 300, column: 100, inspector: false }).width).toBe(pinnedMinWidth);
    expect(pinnedLayout({ layout: 2000, list: 300, column: 5000, inspector: false }).width).toBe(2000 - 300 - 480);
  });
});

describe("keptWords (#1130)", () => {
  test("names how a page is kept, so the frame shows it in words", () => {
    expect(keptWords("temporary")).toBeNull();
    expect(keptWords("saved")).toBe("Saved");
    expect(keptWords("note")).toBe("In your notes");
  });
});

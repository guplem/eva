import { describe, expect, test } from "bun:test";
import {
  afterLoad,
  answerPages,
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
    expect(pageNote({ state: "gone", reason: "x" })).toBe("This page is gone. Eva deletes a page after 7 days.");
    expect(pageNote({ state: "too-large", reason: "x" })).toBe(
      "This page is larger than 2 MB, so Eva does not show it.",
    );
    expect(pageNote({ state: "refused", reason: "a.html holds a secret, so Eva does not show it." })).toBe(
      "a.html holds a secret, so Eva does not show it.",
    );
  });
});

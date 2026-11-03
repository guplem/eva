import { describe, expect, test } from "bun:test";
import { extractFileMarkers, shownAnswerText } from "../../../src/shared/file-markers.ts";

describe("extractFileMarkers (lesson 124)", () => {
  test("removes marker lines and lists their paths; any case, spaces allowed", () => {
    const markers = extractFileMarkers("Here it is.\n[[attach: Methods/Plan.md]]\n[[OFFER:Methods/Other.md ]]\nBye.");
    expect(markers).toEqual({
      text: "Here it is.\nBye.",
      attach: ["Methods/Plan.md"],
      offer: ["Methods/Other.md"],
      quiet: false,
      done: false,
    });
  });

  test("a marker inside a sentence or a code fence stays text", () => {
    const answer = "Write [[attach: a.md]] like this:\n```\n[[attach: b.md]]\n```";
    expect(extractFileMarkers(answer)).toEqual({ text: answer, attach: [], offer: [], quiet: false, done: false });
  });

  test("a file named twice goes once, and attach wins over offer", () => {
    const markers = extractFileMarkers("[[offer: a.md]]\n[[attach: a.md]]\n[[attach: a.md]]\n[[offer: b.md]]");
    expect(markers).toEqual({ text: "", attach: ["a.md"], offer: ["b.md"], quiet: false, done: false });
  });
});

describe("shownAnswerText", () => {
  test("drops the marker lines", () => {
    expect(shownAnswerText("Here it is.\n[[attach: .eva/scratch/a.zip]]")).toBe("Here it is.");
  });

  test("drops a last line that a marker starts but that a cut or a stream left open", () => {
    expect(shownAnswerText("Here it is.\n[[attach: Scrat", true)).toBe("Here it is.");
    expect(shownAnswerText("Here it is.\n  [[OFFER: .eva/scratch/a", true)).toBe("Here it is.");
    expect(shownAnswerText("Here it is.\n[", true)).toBe("Here it is.");
    expect(shownAnswerText("Here it is.\n[[attach: .eva/scratch/a…", true)).toBe("Here it is.");
    expect(shownAnswerText("Here it is.\n[[attach: a.md]]…", true)).toBe("Here it is.");
  });

  test("gives no text for an open text that only starts a marker", () => {
    expect(shownAnswerText("[[attach: Scr", true)).toBe("");
  });

  test("keeps the last line of a whole answer, which no stream left open", () => {
    expect(shownAnswerText("Here it is.\n[[")).toBe("Here it is.\n[[");
  });

  test("keeps an open bracket that is not the start of a marker, and a marker in a code fence", () => {
    expect(shownAnswerText("See [[Plan]] and\n[[not a marker", true)).toBe("See [[Plan]] and\n[[not a marker");
    expect(shownAnswerText("```\n[[attach: a.md]]\n```")).toBe("```\n[[attach: a.md]]\n```");
  });
});

describe("the markers of a scheduled run (#687)", () => {
  test("drops a [[quiet]] or [[done]] line from the text, and says which one came", () => {
    expect(extractFileMarkers("She replied.\n[[done]]")).toMatchObject({
      text: "She replied.",
      done: true,
      quiet: false,
    });
    expect(extractFileMarkers("  [[ QUIET ]]  ")).toMatchObject({ text: "", done: false, quiet: true });
    expect(extractFileMarkers("No marker here.")).toMatchObject({ done: false, quiet: false });
  });

  test("keeps a run marker inside a code fence or inside a line", () => {
    expect(extractFileMarkers("```\n[[done]]\n```").done).toBe(false);
    expect(extractFileMarkers("Write [[done]] when it ends.").text).toBe("Write [[done]] when it ends.");
  });

  test("hides the start of a run marker at the end of an open text", () => {
    expect(shownAnswerText("She replied.\n[[do", true)).toBe("She replied.");
    expect(shownAnswerText("[[qui", true)).toBe("");
  });
});

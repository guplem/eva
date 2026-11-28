import { describe, expect, test } from "bun:test";
import {
  extractFileMarkers,
  maxReplies,
  maxReplyLength,
  shownAnswerText,
  untrimmedAnswerText,
} from "../../../src/shared/file-markers.ts";

describe("extractFileMarkers (lesson 124)", () => {
  test("removes marker lines and lists their paths; any case, spaces allowed", () => {
    const markers = extractFileMarkers("Here it is.\n[[attach: Methods/Plan.md]]\n[[OFFER:Methods/Other.md ]]\nBye.");
    expect(markers).toEqual({
      text: "Here it is.\nBye.",
      attach: ["Methods/Plan.md"],
      offer: ["Methods/Other.md"],
      show: [],
      quiet: false,
      done: false,
      replies: [],
    });
  });

  test("a marker inside a sentence or a code fence stays text", () => {
    const answer = "Write [[attach: a.md]] like this:\n```\n[[attach: b.md]]\n```";
    expect(extractFileMarkers(answer)).toEqual({
      text: answer,
      attach: [],
      offer: [],
      show: [],
      quiet: false,
      done: false,
      replies: [],
    });
  });

  test("a file named twice goes once, and attach wins over offer", () => {
    const markers = extractFileMarkers("[[offer: a.md]]\n[[attach: a.md]]\n[[attach: a.md]]\n[[offer: b.md]]");
    expect(markers).toEqual({
      text: "",
      attach: ["a.md"],
      offer: ["b.md"],
      show: [],
      quiet: false,
      done: false,
      replies: [],
    });
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

describe("untrimmedAnswerText (#1128)", () => {
  test("drops the marker lines and keeps the spaces and line ends of the rest", () => {
    expect(untrimmedAnswerText("  Sure \n[[reply: Yes]]\nThen ", false)).toBe("  Sure \nThen ");
  });

  test("holds back an open last line that can start a marker, and keeps its line end", () => {
    expect(untrimmedAnswerText("Sure.\n[[re", true)).toBe("Sure.\n");
    expect(untrimmedAnswerText("[[re", true)).toBe("");
    expect(untrimmedAnswerText("Sure.\n", true)).toBe("Sure.\n");
    expect(untrimmedAnswerText("Sure.\n  ", true)).toBe("Sure.\n");
    expect(untrimmedAnswerText("Sure.\n[[re", false)).toBe("Sure.\n[[re");
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

describe("the show marker of a page (#1129)", () => {
  test("drops a [[show:]] line and lists its path once, in any case", () => {
    const markers = extractFileMarkers(
      "A chart.\n[[show: .eva/scratch/chart.html]]\n[[ SHOW:.eva/scratch/chart.html ]]",
    );
    expect(markers).toMatchObject({ text: "A chart.", show: [".eva/scratch/chart.html"], attach: [], offer: [] });
  });

  test("keeps a show marker inside a code fence or inside a line", () => {
    const answer = "Write [[show: a.html]] like this:\n```\n[[show: b.html]]\n```";
    expect(extractFileMarkers(answer)).toMatchObject({ text: answer, show: [] });
  });

  test("hides the start of a show marker at the end of an open text", () => {
    expect(shownAnswerText("A chart.\n[[sh", true)).toBe("A chart.");
    expect(shownAnswerText("A chart.\n[[show: .eva/scr", true)).toBe("A chart.");
  });
});

describe("the suggested replies of an answer (#1127)", () => {
  test("drops each reply line from the text, and gives the replies in order; any case, spaces allowed", () => {
    const markers = extractFileMarkers("Shall I go on?\n[[reply: Yes, go on]]\n  [[ REPLY:No, stop here ]]  ");
    expect(markers.text).toBe("Shall I go on?");
    expect(markers.replies).toEqual(["Yes, go on", "No, stop here"]);
  });

  test("gives no reply for an answer without one", () => {
    expect(extractFileMarkers("Done.").replies).toEqual([]);
  });

  test("keeps a reply marker inside a sentence or a code fence as text", () => {
    const answer = "Write [[reply: Yes]] like this:\n```\n[[reply: No]]\n```";
    expect(extractFileMarkers(answer)).toMatchObject({ text: answer, replies: [] });
  });

  test("keeps each reply once, and only the first 4", () => {
    const lines = ["A?", "[[reply: One]]", "[[reply: One]]", "[[reply: Two]]", "[[reply: Three]]"];
    const answer = [...lines, "[[reply: Four]]", "[[reply: Five]]"].join("\n");
    expect(extractFileMarkers(answer).replies).toEqual(["One", "Two", "Three", "Four"]);
    expect(maxReplies).toBe(4);
  });

  test("hides an empty reply and one longer than 60 characters, but offers neither", () => {
    const long = "x".repeat(maxReplyLength + 1);
    const longest = "y".repeat(maxReplyLength);
    const answer = `A?\n[[reply: ]]\n[[reply:${long}]]\n[[reply: ${longest}]]`;
    expect(maxReplyLength).toBe(60);
    expect(extractFileMarkers(answer)).toMatchObject({ text: "A?", replies: [longest] });
  });

  test("counts an emoji as one character", () => {
    const reply = "👍".repeat(maxReplyLength);
    expect(extractFileMarkers(`[[reply: ${reply}]]`).replies).toEqual([reply]);
  });

  test("a reply that is too long takes no place of the first 4", () => {
    const answer = [`[[reply: ${"z".repeat(61)}]]`, "[[reply: 1]]", "[[reply: 2]]", "[[reply: 3]]", "[[reply: 4]]"];
    expect(extractFileMarkers(answer.join("\n")).replies).toEqual(["1", "2", "3", "4"]);
  });

  test("hides the start of a reply line at the end of an open text", () => {
    expect(shownAnswerText("Shall I go on?\n[[reply: Ye", true)).toBe("Shall I go on?");
    expect(shownAnswerText("Shall I go on?\n[[rep", true)).toBe("Shall I go on?");
    expect(shownAnswerText("Shall I go on?\n[[reply: Yes]]…", true)).toBe("Shall I go on?");
  });
});

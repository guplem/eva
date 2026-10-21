import { describe, expect, test } from "bun:test";
import { fileBadgeOf, nameEnds } from "../../../../../src/frontends/web/client/file-kinds.ts";

describe("fileBadgeOf", () => {
  test("a well-known type gets its own colour", () => {
    expect(fileBadgeOf("Report.pdf")).toEqual({ label: "PDF", tone: "red" });
    expect(fileBadgeOf("AGENTS.md")).toEqual({ label: "MD", tone: "violet" });
    expect(fileBadgeOf("budget.XLSX")).toEqual({ label: "XLSX", tone: "green" });
    expect(fileBadgeOf("photo.jpeg")).toEqual({ label: "JPEG", tone: "pink" });
    expect(fileBadgeOf("settings.json")).toEqual({ label: "JSON", tone: "yellow" });
  });

  test("another short extension shows in the plain colour", () => {
    expect(fileBadgeOf("notes.txt")).toEqual({ label: "TXT", tone: "plain" });
    expect(fileBadgeOf(".env")).toEqual({ label: "ENV", tone: "plain" });
  });

  test("a name with no extension, or a long one, gets no badge", () => {
    expect(fileBadgeOf("Makefile")).toBeNull();
    expect(fileBadgeOf("archive.")).toBeNull();
    expect(fileBadgeOf(".gitignore")).toBeNull();
    expect(fileBadgeOf("data.sqlite3")).toBeNull();
  });
});

describe("nameEnds", () => {
  test("the tail keeps the extension and a few letters before it", () => {
    expect(nameEnds("Quarterly report for the board.pdf")).toEqual({
      head: "Quarterly report for t",
      tail: "he board.pdf",
    });
  });

  test("the tail is never more than half of the name", () => {
    expect(nameEnds("a.markdown")).toEqual({ head: "a.mar", tail: "kdown" });
    expect(nameEnds("Makefile")).toEqual({ head: "Make", tail: "file" });
  });

  test("the two parts always join to the whole name", () => {
    for (const name of ["", "x", "ab", ".env", "a long name with no extension at all", "report (1).docx"]) {
      const { head, tail } = nameEnds(name);
      expect(head + tail).toBe(name);
    }
  });
});

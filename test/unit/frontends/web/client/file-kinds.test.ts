import { describe, expect, test } from "bun:test";
import {
  decryptedNameOf,
  fileBadgeOf,
  maxMediaBytes,
  mediaOf,
  nameEnds,
  shownMediaOf,
} from "../../../../../src/frontends/web/client/file-kinds.ts";

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

describe("mediaOf", () => {
  test("an image, a sound or a film that a browser shows gets its kind and its type", () => {
    expect(mediaOf("Drawing/draw_2.JPG")).toEqual({ kind: "image", type: "image/jpeg" });
    expect(mediaOf("photo.png")).toEqual({ kind: "image", type: "image/png" });
    expect(mediaOf("voice.m4a")).toEqual({ kind: "audio", type: "audio/mp4" });
    expect(mediaOf("clip.webm")).toEqual({ kind: "video", type: "video/webm" });
  });

  test("a PDF shows in the browser's viewer (#1064)", () => {
    expect(mediaOf("Docs/Report.PDF")).toEqual({ kind: "pdf", type: "application/pdf" });
  });

  test("another file is no media: an SVG, which could run its scripts as Eva, a HEIC photo, a Word file or no extension", () => {
    expect(mediaOf("logo.svg")).toBeNull();
    expect(mediaOf("photo.heic")).toBeNull();
    expect(mediaOf("Letter.docx")).toBeNull();
    expect(mediaOf("Makefile")).toBeNull();
    expect(mediaOf(".png")).toBeNull();
  });
});

describe("shownMediaOf: which open file the page shows as media", () => {
  const binary = { kind: "unreadable", size: 2_000, downloadable: true } as const;

  test("a file that is not text shows as media up to 50 MB (issue 737)", () => {
    expect(shownMediaOf("photo.png", binary)).toEqual({ kind: "image", type: "image/png" });
    expect(shownMediaOf("photo.png", { ...binary, size: maxMediaBytes })).not.toBeNull();
    expect(shownMediaOf("photo.png", { ...binary, size: maxMediaBytes + 1 })).toBeNull();
    expect(shownMediaOf("data.bin", binary)).toBeNull();
  });

  test("a secret file never shows, as the download route never sends it", () => {
    expect(shownMediaOf("Report.pdf", { ...binary, downloadable: false })).toBeNull();
  });

  test("a PDF of plain letters only passes the text check, and still shows as a PDF (#1064)", () => {
    expect(shownMediaOf("Report.pdf", { kind: "file", size: 400 })).toEqual({ kind: "pdf", type: "application/pdf" });
  });

  test("a text file stays text, and an SVG too large for text keeps its message", () => {
    expect(shownMediaOf("logo.svg", { kind: "file", size: 400 })).toBeNull();
    expect(shownMediaOf("notes.md", { kind: "file", size: 400 })).toBeNull();
    expect(shownMediaOf("logo.svg", binary)).toBeNull();
  });

  test("a folder or an encrypted file is no media", () => {
    expect(shownMediaOf("Report.pdf", { kind: "encrypted", size: 400 })).toBeNull();
    expect(shownMediaOf("Media.pdf", { kind: "folder" })).toBeNull();
  });
});

describe("decryptedNameOf", () => {
  test("a downloaded encrypted file loses the .eva-secret end that the Encrypt action added (#1108)", () => {
    expect(decryptedNameOf("photo.jpg.eva-secret")).toBe("photo.jpg");
    expect(decryptedNameOf("notes.md.eva-secret")).toBe("notes.md");
    expect(decryptedNameOf("scan.PDF.EVA-SECRET")).toBe("scan.PDF");
  });

  test("a name that the person chose stays as it is, .secrets included (#1108)", () => {
    expect(decryptedNameOf("photo.jpg.secrets")).toBe("photo.jpg.secrets");
    expect(decryptedNameOf(".env.secrets")).toBe(".env.secrets");
    expect(decryptedNameOf(".eva-secret")).toBe(".eva-secret");
    expect(decryptedNameOf(".env.local")).toBe(".env.local");
    expect(decryptedNameOf("my.eva-secret.txt")).toBe("my.eva-secret.txt");
  });
});

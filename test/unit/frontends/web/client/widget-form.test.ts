import { describe, expect, test } from "bun:test";
import type { WidgetManifest } from "../../../../../src/core/widgets/widget-contract.ts";
import {
  formInputs,
  initialValues,
  isPickable,
  missingInputs,
  ownValue,
  permissionLines,
  promptLine,
  sentValues,
} from "../../../../../src/frontends/web/client/widget-form.ts";

const base = { description: "d", why: "w" };
const manifest: WidgetManifest = {
  contract: 1,
  name: "Habits",
  entry: "index.html",
  size: "medium",
  inputs: [
    { ...base, id: "title", type: "text", label: "Title", required: false, default: "Habits" },
    { ...base, id: "count", type: "number", label: "Count", required: false, default: { bad: true } },
    {
      ...base,
      id: "habits",
      type: "folder",
      label: "Habits folder",
      required: true,
      access: "write",
      files: "*.json",
      why: "Shows and checks your habits.",
    },
    { ...base, id: "notes", type: "file", label: "Notes", required: false, access: "read", why: "Shows a note." },
    { ...base, id: "place", type: "eva-location", label: "Location", required: false, why: "Shows the place." },
  ],
  hosts: [{ url: "https://api.example.com", why: "Reads the weather." }],
};

describe("the activation form", () => {
  test("shows each input but the location, with the vault value or the default", () => {
    expect(formInputs(manifest).map((input) => input.id)).toEqual(["title", "count", "habits", "notes"]);
    expect(initialValues(manifest, {})).toEqual({ title: "Habits" });
    expect(initialValues(manifest, { title: "Mine", habits: "Life/Habits", count: 3 })).toEqual({
      title: "Mine",
      count: 3,
      habits: "Life/Habits",
    });
  });

  test("names each required input with no value, and sends only the values", () => {
    expect(missingInputs(manifest, {})).toEqual(["Habits folder"]);
    expect(missingInputs(manifest, { habits: "  " })).toEqual(["Habits folder"]);
    expect(missingInputs(manifest, { habits: "Life/Habits" })).toEqual([]);
    expect(sentValues(manifest, { title: " Mine ", habits: "Life/Habits", notes: "", count: 0, place: "x" })).toEqual({
      title: "Mine",
      habits: "Life/Habits",
      count: 0,
    });
  });

  test("reads only the own keys of the values, so an id such as constructor stays empty", () => {
    const odd: WidgetManifest = {
      ...manifest,
      inputs: [{ ...base, id: "constructor", type: "text", label: "Name", required: true }],
    };
    expect(initialValues(odd, {})).toEqual({});
    expect(missingInputs(odd, {})).toEqual(["Name"]);
    expect(ownValue({ a: 1 }, "a")).toBe(1);
  });

  test("lists each permission with its reason", () => {
    expect(permissionLines(manifest, { habits: "Life/Habits", notes: "Notes/a.md" })).toEqual([
      { icon: "folder", text: "Reads and writes the folder Life/Habits", why: "Shows and checks your habits." },
      { icon: "file", text: "Reads the file Notes/a.md", why: "Shows a note." },
      { icon: "globe", text: "Reads your last location", why: "Shows the place." },
      { icon: "external", text: "Calls https://api.example.com", why: "Reads the weather." },
    ]);
    expect(permissionLines({ ...manifest, hosts: [] }, {}).map((line) => line.text)).toEqual([
      "Reads your last location",
    ]);
  });

  test("the vault picker hides each place that a widget never reaches", () => {
    expect(isPickable("Life/Habits")).toBe(true);
    for (const path of [".eva", "Scratch", "Life/About me.md", "Projects/2026-01-01-0900-app/repos", "Notes/.git"]) {
      expect(isPickable(path)).toBe(false);
    }
  });
});

describe("promptLine", () => {
  test("fills the manifest's line with the values, and names an empty one", () => {
    const withLine = { ...manifest, prompt: "Habits live in {habits}, titled {title}, by {nobody}." };
    expect(promptLine(withLine, { habits: " Life/Habits ", title: "Mine" })).toBe(
      "Habits live in Life/Habits, titled Mine, by (not set).",
    );
  });

  test("gives the default line of a widget with data and no line, and nothing for one with no data", () => {
    expect(promptLine(manifest, { habits: "Life/Habits" })).toBe("Habits data lives in Life/Habits.");
    expect(promptLine(manifest, {})).toBeNull();
  });
});

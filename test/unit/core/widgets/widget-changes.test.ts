import { describe, expect, test } from "bun:test";
import { grantChange, readOnlyFallbacks, type WidgetGrant } from "../../../../src/core/widgets/widget-changes.ts";
import type { WidgetInput, WidgetManifest } from "../../../../src/core/widgets/widget-contract.ts";

const habits: WidgetInput = {
  id: "habits",
  type: "folder",
  label: "Habits folder",
  description: "One file for each habit.",
  why: "The widget shows your habits.",
  required: true,
  access: "write",
  schema: "schemas/habits.json",
  files: "*.json",
};

function manifest(change: Partial<WidgetManifest> = {}): WidgetManifest {
  return { contract: 1, name: "Habits", entry: "index.html", size: "medium", inputs: [habits], hosts: [], ...change };
}

const approved: WidgetGrant = {
  paths: [
    {
      input: "habits",
      type: "folder",
      path: "Life/Habits",
      access: "write",
      files: "*.json",
      schema: "schemas/habits.json",
    },
  ],
  location: false,
  hosts: [],
  prompt: null,
};
const values = { habits: "Life/Habits" };
const none = new Set<string>();

describe("grantChange", () => {
  test("the same manifest asks for nothing new", () => {
    const change = grantChange(approved, manifest(), values, none, none);
    expect(change.added).toEqual([]);
    expect(change.grant).toEqual(approved);
  });

  test("each new host, the location and a new prompt line are new permissions", () => {
    const location: WidgetInput = { ...habits, id: "here", type: "eva-location", label: "Here" };
    const change = grantChange(
      approved,
      manifest({
        inputs: [habits, location],
        hosts: [{ url: "https://api.example.com/", why: "Weather." }],
        prompt: "Habits live in {habits}.",
      }),
      values,
      none,
      none,
    );
    expect(change.added).toEqual([
      "Read your last location.",
      "Send requests to https://api.example.com.",
      'Tell Eva in each new chat: "Habits live in {habits}."',
    ]);
    expect(change.grant.hosts).toEqual(["https://api.example.com"]);
  });

  test("a read that becomes a write, a new folder, a new pattern and a new schema text are new permissions", () => {
    const read: WidgetGrant = { ...approved, paths: [{ ...approved.paths[0]!, access: "read", schema: null }] };
    expect(grantChange(read, manifest(), values, none, none).added).toEqual([
      "Change the folder Life/Habits, not only read it.",
    ]);
    expect(grantChange(approved, manifest(), { habits: "Life/Other" }, none, none).added).toEqual([
      "Read and change the folder Life/Other (*.json).",
    ]);
    expect(grantChange(approved, manifest({ inputs: [{ ...habits, files: "*" }] }), values, none, none).added).toEqual([
      "Read and change the folder Life/Habits (*).",
    ]);
    expect(grantChange(approved, manifest(), values, new Set(["habits"]), none).added).toEqual([
      "Write the folder Life/Habits in a new data format (schemas/habits.json).",
    ]);
  });

  test("less access, a removed input and an empty optional input ask for nothing", () => {
    expect(
      grantChange(approved, manifest({ inputs: [{ ...habits, access: "read" }] }), values, none, none).added,
    ).toEqual([]);
    expect(grantChange(approved, manifest({ inputs: [] }), values, none, none).added).toEqual([]);
    const notes: WidgetInput = { ...habits, id: "notes", required: false };
    expect(grantChange(approved, manifest({ inputs: [habits, notes] }), values, none, none).added).toEqual([]);
  });

  test("a read-only fallback stays a read, with no new permission", () => {
    const fallback: WidgetGrant = { ...approved, paths: [{ ...approved.paths[0]!, access: "read", schema: null }] };
    const inputs = readOnlyFallbacks(fallback, manifest());
    expect([...inputs]).toEqual(["habits"]);
    const change = grantChange(fallback, manifest(), values, new Set(["habits"]), inputs);
    expect(change.added).toEqual([]);
    expect(change.grant.paths[0]).toMatchObject({ access: "read", schema: null });
    // A read that the old manifest asked for is no fallback.
    expect([...readOnlyFallbacks(fallback, manifest({ inputs: [{ ...habits, access: "read" }] }))]).toEqual([]);
  });

  test("with no approval, every permission is new", () => {
    expect(grantChange(null, manifest(), values, none, none).added).toEqual([
      "Read and change the folder Life/Habits (*.json).",
    ]);
  });
});

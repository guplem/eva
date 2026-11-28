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
  googleCalendar: null,
  googleTasks: null,
  cases: false,
  asks: [],
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

  test("the calendar, more calendar access and the cases are new permissions", () => {
    const calendar: WidgetInput = {
      id: "calendar",
      type: "eva-google-calendar",
      label: "Calendar",
      description: "Your Google Calendar.",
      why: "The widget shows your events.",
      required: true,
      access: "read",
    };
    const { access: _access, ...noAccess } = calendar;
    const cases: WidgetInput = { ...noAccess, id: "cases", type: "eva-cases", label: "Cases" };
    const both = manifest({ contract: 2, inputs: [habits, calendar, cases] });
    const change = grantChange(approved, both, values, none, none);
    expect(change.added).toEqual(["Read your Google Calendar.", "Read your open cases."]);
    expect(change.grant).toMatchObject({ googleCalendar: "read", cases: true });
    expect(grantChange(change.grant, both, values, none, none).added).toEqual([]);
    const write = manifest({ contract: 2, inputs: [habits, { ...calendar, access: "write" }, cases] });
    expect(grantChange(change.grant, write, values, none, none).added).toEqual([
      "Change your Google Calendar and send invitations to other people, not only read it.",
    ]);
    expect(grantChange(approved, write, values, none, none).added).toEqual([
      "Read and change your Google Calendar, and send invitations to other people.",
      "Read your open cases.",
    ]);
    // Less access asks for nothing.
    expect(grantChange({ ...change.grant, googleCalendar: "write" }, both, values, none, none).added).toEqual([]);
  });

  test("the tasks and more tasks access are new permissions", () => {
    const tasks: WidgetInput = {
      id: "tasks",
      type: "eva-google-tasks",
      label: "Tasks",
      description: "Your Google Tasks.",
      why: "The widget shows your tasks.",
      required: false,
      access: "read",
    };
    const reading = manifest({ contract: 4, inputs: [habits, tasks] });
    const change = grantChange(approved, reading, values, none, none);
    expect(change.added).toEqual(["Read your Google Tasks."]);
    expect(change.grant).toMatchObject({ googleTasks: "read" });
    expect(grantChange(change.grant, reading, values, none, none).added).toEqual([]);
    const writing = manifest({ contract: 4, inputs: [habits, { ...tasks, access: "write" }] });
    expect(grantChange(change.grant, writing, values, none, none).added).toEqual([
      "Change your Google Tasks, not only read them.",
    ]);
    expect(grantChange(approved, writing, values, none, none).added).toEqual(["Read and change your Google Tasks."]);
    expect(grantChange({ ...change.grant, googleTasks: "write" }, reading, values, none, none).added).toEqual([]);
    expect(grantChange(approved, manifest(), values, none, none).grant.googleTasks).toBeNull();
  });

  test("each new ask of contract 3 is a new permission, and a removed one asks for nothing", () => {
    const asking = manifest({
      contract: 3,
      asks: [
        { type: "chat", why: "Starts a chat about a habit." },
        { type: "open", why: "Opens the habit's file." },
      ],
    });
    const change = grantChange(approved, asking, values, none, none);
    expect(change.added).toEqual([
      "Write a text in your message box, for you to send.",
      "Open a page of Eva for a place of your vault.",
    ]);
    expect(change.grant.asks).toEqual(["chat", "open"]);
    expect(grantChange(change.grant, asking, values, none, none).added).toEqual([]);
    expect(grantChange({ ...approved, asks: ["chat"] }, asking, values, none, none).added).toEqual([
      "Open a page of Eva for a place of your vault.",
    ]);
    expect(grantChange(change.grant, manifest(), values, none, none).grant.asks).toEqual([]);
    expect(grantChange(change.grant, manifest(), values, none, none).added).toEqual([]);
  });
});

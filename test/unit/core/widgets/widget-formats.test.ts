import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dataFormatFirstLine } from "../../../../src/core/widgets/data-format-file.ts";
import { DataFormatRecord } from "../../../../src/core/widgets/data-format-writer.ts";
import { WidgetApprovals } from "../../../../src/core/widgets/widget-approvals.ts";
import { WidgetCopies } from "../../../../src/core/widgets/widget-copies.ts";
import { placeOfInput } from "../../../../src/core/widgets/widget-formats.ts";
import { widgetTheme } from "../../../../src/core/widgets/widget-policy.ts";
import { Widgets } from "../../../../src/core/widgets/widgets.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

const ownHosts = ["127.0.0.1", "localhost"];
const habitsId = "example-owner/habits";
const trainingId = "example-owner/training";
const schemaHeader = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };

function folderInput(id: string, access: "read" | "write" = "write"): Record<string, unknown> {
  return {
    id,
    type: "folder",
    label: `${id} folder`,
    description: "The folder of the data.",
    why: "The widget shows the data.",
    required: true,
    access,
    schema: `schemas/${id}.json`,
    files: "*.json",
  };
}

const habitsManifest = {
  contract: 1,
  name: "Habits",
  size: "medium",
  inputs: [folderInput("habits")],
  prompt: "Habits live in {habits}, one JSON file for each habit.",
};
const habitsSchema = {
  ...schemaHeader,
  required: ["name", "checks"],
  properties: {
    name: { type: "string" },
    checks: {
      type: "array",
      items: { type: "object", required: ["date"], properties: { date: { type: "string", format: "date" } } },
    },
  },
};

let sandboxes: Record<string, GitSandbox>;
let folder: string;
let vault: string;
let hub: boolean;
let busy: boolean;
let notices: string[][];
let logged: string[];
let widgets: Widgets;

function publish(name: string, files: Readonly<Record<string, string>>): void {
  const sandbox = sandboxes[name];
  if (sandbox === undefined) throw new Error(`No sandbox ${name}.`);
  const work = sandbox.clone(`work-${String(Date.now())}`);
  for (const [path, content] of Object.entries(files)) sandbox.write(work, path, content);
  sandbox.git(work, "add", "-A");
  sandbox.git(work, "commit", "-q", "-m", "widget");
  sandbox.git(work, "push", "-q", "origin", "main");
}

function training(schema: Record<string, unknown>, manifest: Record<string, unknown> = {}): void {
  publish("training", {
    "eva-widget.json": JSON.stringify({
      contract: 1,
      name: "Training",
      size: "small",
      inputs: [folderInput("training")],
      ...manifest,
    }),
    "schemas/training.json": JSON.stringify({ ...schemaHeader, ...schema }),
    "index.html": "<p>training</p>",
  });
}

function vaultFile(path: string, content: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), content);
}

function dataFormat(path = "Life/Habits/DATA_FORMAT.md"): string {
  return readFileSync(join(vault, path), "utf-8");
}

async function approve(id: string, values: Record<string, string>, readOnly = false): Promise<void> {
  const review = await widgets.review(id, ownHosts);
  await widgets.approve(id, review.commit, values, ownHosts, readOnly);
  // The approval writes the formats in the background.
  await widgets.syncFormats();
}

async function failure(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("The call was expected to fail.");
}

beforeEach(() => {
  sandboxes = { habits: createGitSandbox(), training: createGitSandbox() };
  publish("habits", {
    "eva-widget.json": JSON.stringify(habitsManifest),
    "schemas/habits.json": JSON.stringify(habitsSchema),
    "index.html": "<p>habits</p>",
  });
  training({ required: ["place"], properties: { name: { type: "string" }, place: { type: "string" } } });
  folder = mkdtempSync(join(tmpdir(), "eva-widget-formats-"));
  vault = join(folder, "vault");
  vaultFile("Life/Habits/meditate.json", JSON.stringify({ name: "Meditate", checks: [] }));
  vaultFile("Life/Training/run.json", JSON.stringify({ name: "Run" }));
  mkdirSync(join(vault, ".eva"), { recursive: true });
  hub = true;
  busy = false;
  notices = [];
  logged = [];
  widgets = new Widgets({
    vaultPath: vault,
    approvals: new WidgetApprovals(join(folder, "state", "widget-approvals.json")),
    copies: new WidgetCopies({
      folder: join(folder, "widgets"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
      remoteOf: (address) => sandboxes[address.name]?.remote ?? "",
    }),
    projects: () => [],
    baseWidgets: [],
    location: () => null,
    exclusive: (work) => Promise.resolve().then(work),
    redact: (value) => value,
    now: () => new Date("2026-01-01T09:00:00Z"),
    formats: {
      record: new DataFormatRecord(join(folder, "state", "data-formats.json")),
      isHub: () => hub,
      notify: (edited) => notices.push([...edited]),
      log: (reason) => logged.push(reason),
      vaultBusy: () => busy,
    },
  });
  widgets.add("https://github.com/example-owner/habits");
  widgets.add("https://github.com/example-owner/training");
}, gitHookTimeoutMs);

afterEach(() => {
  for (const sandbox of Object.values(sandboxes)) sandbox.dispose();
  rmSync(folder, { recursive: true, force: true });
});

describe("the data format file", () => {
  test("the hub writes it when the person turns on the first widget of the folder", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    const text = dataFormat();
    expect(text.split("\n")[0]).toBe(dataFormatFirstLine);
    expect(text).toContain("- Habits (`example-owner/habits`) reads and writes the files `*.json`");
    expect(text).toContain("| `checks[].date` | string | format date | Habits | Habits |  |");
    expect(logged).toEqual([]);
  });

  test("another computer writes no file", async () => {
    hub = false;
    await approve(habitsId, { habits: "Life/Habits" });
    expect(existsSync(join(vault, "Life/Habits/DATA_FORMAT.md"))).toBe(false);
  });

  test("a second widget with fitting fields writes the same folder, and the file lists the fields of both", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Habits" });
    const text = dataFormat();
    expect(text).toContain("| `name` | string | any | Habits | Habits, Training |  |");
    expect(text).toContain("| `place` | string | any | Training | Training |  |");
    expect(notices).toEqual([]);
  });

  test("a second widget with the same field of another type gets a warning, and works with read access only", async () => {
    training({ properties: { name: { type: "number" } } });
    await approve(habitsId, { habits: "Life/Habits" });
    const error = await failure(() => approve(trainingId, { training: "Life/Habits" }));
    expect(isEvaError(error, "widget_format_conflict")).toBe(true);
    expect((error as Error).message).toBe(
      'Training does not fit the data that the folder holds already. training folder: the field "name" is string for Habits, and number for Training. Turn it on with read access only, or pick another folder.',
    );
    expect(widgets.list().find((item) => item.id === trainingId)?.state).toBe("off");
    await approve(trainingId, { training: "Life/Habits" }, true);
    expect(widgets.list().find((item) => item.id === trainingId)?.state).toBe("on");
    expect(dataFormat()).not.toContain("Training");
    const frames = widgets.frames(widgetTheme("dark", {}), []);
    const token = frames.find((frame) => frame.id === trainingId)?.token ?? "";
    const write = await widgets.serve(token, "data/training/x.json", "PUT", Buffer.from('{"name":1}'));
    expect(write?.status).toBe(403);
  });

  test("a widget in a subfolder conflicts with a widget of the folder above, and its file lists both", async () => {
    vaultFile("Life/Habits/Sport/run.json", "{}");
    await approve(habitsId, { habits: "Life/Habits" });
    training({ properties: { name: { type: "number" } } });
    const error = await failure(() => approve(trainingId, { training: "Life/Habits/Sport" }));
    expect(isEvaError(error, "widget_format_conflict")).toBe(true);
    training({ properties: { place: { type: "string" } } });
    await approve(trainingId, { training: "Life/Habits/Sport" });
    const sport = dataFormat("Life/Habits/Sport/DATA_FORMAT.md");
    expect(sport).toContain("Habits (`example-owner/habits`)");
    expect(sport).toContain("| `place` |");
    expect(dataFormat()).not.toContain("| `place` |");
  });

  test("a widget that only reads is never refused: its conflicting fields leave the format", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    publish("training", {
      "eva-widget.json": JSON.stringify({
        contract: 1,
        name: "Training",
        size: "small",
        inputs: [folderInput("training", "read")],
      }),
      "schemas/training.json": JSON.stringify({ ...schemaHeader, properties: { name: { type: "number" } } }),
      "index.html": "<p>training</p>",
    });
    await approve(trainingId, { training: "Life/Habits" });
    expect(widgets.list().find((item) => item.id === trainingId)?.state).toBe("on");
    expect(dataFormat()).not.toContain("Training");
  });

  test("two inputs of one widget in one folder with another type conflict", async () => {
    publish("training", {
      "eva-widget.json": JSON.stringify({
        contract: 1,
        name: "Training",
        size: "small",
        inputs: [folderInput("training"), { ...folderInput("other"), schema: "schemas/other.json" }],
      }),
      "schemas/training.json": JSON.stringify({ ...schemaHeader, properties: { value: { type: "number" } } }),
      "schemas/other.json": JSON.stringify({ ...schemaHeader, properties: { value: { type: "string" } } }),
      "index.html": "<p>training</p>",
    });
    const error = await failure(() => approve(trainingId, { training: "Life/Training", other: "Life/Training" }));
    expect(isEvaError(error, "widget_format_conflict")).toBe(true);
  });

  test("waits while a chat runs a turn in the vault", async () => {
    busy = true;
    await approve(habitsId, { habits: "Life/Habits" });
    expect(existsSync(join(vault, "Life/Habits/DATA_FORMAT.md"))).toBe(false);
    busy = false;
    await widgets.syncFormats();
    expect(existsSync(join(vault, "Life/Habits/DATA_FORMAT.md"))).toBe(true);
  });

  test("the same widget in another folder has no conflict", async () => {
    training({ properties: { name: { type: "number" } } });
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Training" });
    expect(dataFormat("Life/Training/DATA_FORMAT.md")).toContain("| `name` | number |");
  });

  test("a removal writes the file again without the widget's fields, and the last one leaves the file", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Habits" });
    widgets.remove(trainingId);
    await widgets.syncFormats();
    expect(dataFormat()).not.toContain("| `place` |");
    widgets.remove(habitsId);
    await widgets.syncFormats();
    expect(dataFormat()).toContain("Habits");
  });

  test("a widget that is off keeps its fields", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Habits" });
    widgets.setEnabled(trainingId, false);
    await widgets.syncFormats();
    expect(dataFormat()).toContain("| `place` |");
  });

  test("an edit is lost when the format changes, and the person gets one notice", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    vaultFile("Life/Habits/DATA_FORMAT.md", `${dataFormat()}\nMy own note.\n`);
    await widgets.syncFormats();
    expect(dataFormat()).toContain("My own note.");
    await approve(trainingId, { training: "Life/Habits" });
    expect(dataFormat()).not.toContain("My own note.");
    await widgets.syncFormats();
    expect(notices).toEqual([["Life/Habits/DATA_FORMAT.md"]]);
  });
});

describe("the prompt lines", () => {
  test("give the manifest's line with the person's folder, or a default line, for each widget that is on", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Training" });
    expect(widgets.formats.promptLines()).toEqual([
      "- Habits: Habits live in Life/Habits, one JSON file for each habit.",
      "- Training: Training data lives in Life/Training. Read Life/Training/DATA_FORMAT.md before you write.",
    ]);
    widgets.setEnabled(habitsId, false);
    expect(widgets.formats.promptLines()).toHaveLength(1);
  });

  test("name a DATA_FORMAT.md only when the folder has one", async () => {
    hub = false;
    await approve(trainingId, { training: "Life/Training" });
    expect(widgets.formats.promptLines()).toEqual(["- Training: Training data lives in Life/Training."]);
  });

  test("fill an unknown placeholder with a note", async () => {
    training({ properties: {} }, { prompt: "Training is in {training}, notes in {notes}." });
    await approve(trainingId, { training: "Life/Training" });
    expect(widgets.formats.promptLines()).toEqual(["- Training: Training is in Life/Training, notes in (not set)."]);
  });
});

describe("the check of changed files", () => {
  test("says which file breaks which widget's schema, and passes a file that fits", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Habits" });
    vaultFile("Life/Habits/walk.json", JSON.stringify({ name: "Walk", checks: [{ date: "today" }] }));
    vaultFile("Life/Habits/broken.json", "{");
    vaultFile("Life/Habits/notes.md", "# Notes");
    vaultFile("Life/Habits/fine.json", JSON.stringify({ name: "Fine", checks: [], place: "Home" }));
    expect(
      widgets.formats.check([
        "Life/Habits/walk.json",
        "Life/Habits/broken.json",
        "Life/Habits/notes.md",
        "Life/Habits/fine.json",
        "Life/Habits/gone.json",
        "Notes/other.json",
      ]),
    ).toEqual([
      'Life/Habits/walk.json does not fit the format of Habits: the field "checks.0.date" must match format "date".',
      'Life/Habits/walk.json does not fit the format of Training: the field "place" is missing.',
      "Life/Habits/broken.json is not valid JSON.",
    ]);
  });

  test("leaves out a file as a widget wrote it", async () => {
    await approve(habitsId, { habits: "Life/Habits" });
    await approve(trainingId, { training: "Life/Habits" });
    const token = widgets.frames(widgetTheme("dark", {}), []).find((frame) => frame.id === habitsId)?.token ?? "";
    const written = await widgets.serve(
      token,
      "data/habits/walk.json",
      "PUT",
      Buffer.from(JSON.stringify({ name: "Walk", checks: [] })),
    );
    expect(written?.status).toBe(204);
    expect(widgets.formats.check(["Life/Habits/walk.json"])).toEqual([]);
    vaultFile("Life/Habits/walk.json", JSON.stringify({ name: "Walk", checks: [], extra: 1 }));
    expect(widgets.formats.check(["Life/Habits/walk.json"])).toHaveLength(1);
  });
});

describe("placeOfInput", () => {
  test("puts the format of a file input in its folder, and of an empty input nowhere", () => {
    const file = { input: "goals", type: "file", access: "write", files: null, schema: "s.json" } as const;
    expect(placeOfInput({ ...file, path: "Life/goals.yaml" })).toEqual({
      folder: "Life",
      files: "goals.yaml",
      single: true,
    });
    expect(placeOfInput({ ...file, path: "goals.yaml" })?.folder).toBe("");
    expect(placeOfInput({ ...file, path: null })).toBeNull();
  });
});

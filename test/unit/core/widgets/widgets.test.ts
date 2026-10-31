import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Project } from "../../../../src/core/projects/project-catalog.ts";
import type { LastLocation } from "../../../../src/core/vault/about-me.ts";
import { WidgetApprovals } from "../../../../src/core/widgets/widget-approvals.ts";
import { WidgetCopies } from "../../../../src/core/widgets/widget-copies.ts";
import { readWidgetList, widgetListPath, writeWidgetList } from "../../../../src/core/widgets/widget-list.ts";
import { widgetTheme } from "../../../../src/core/widgets/widget-policy.ts";
import { Widgets, type WidgetsOptions } from "../../../../src/core/widgets/widgets.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

const habitsId = "example-owner/habits";
const ownHosts = ["127.0.0.1", "localhost"];
const theme = widgetTheme("dark", { "--bg": "#000000" });

const manifest = {
  contract: 1,
  name: "Habits",
  size: "medium",
  inputs: [
    {
      id: "title",
      type: "text",
      label: "Title",
      description: "The heading.",
      why: "The widget shows it.",
      required: false,
    },
    {
      id: "habits",
      type: "folder",
      label: "Habits folder",
      description: "One file for each habit.",
      why: "The widget shows and checks your habits.",
      required: true,
      access: "write",
      schema: "schemas/habits.json",
      files: "*.json",
    },
    {
      id: "location",
      type: "eva-location",
      label: "Location",
      description: "Your last location.",
      why: "The widget shows where you are.",
      required: false,
    },
  ],
  hosts: [{ url: "https://api.example.com", why: "The widget reads the weather." }],
};
const habitSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { name: { type: "string" }, checks: { type: "array" } },
};

let sandbox: GitSandbox;
let work: string;
let folder: string;
let vault: string;
let now: Date;
let location: LastLocation | null;
let projects: Project[];
let options: WidgetsOptions;
let widgets: Widgets;

function commit(files: Readonly<Record<string, string>>): string {
  for (const [path, content] of Object.entries(files)) sandbox.write(work, path, content);
  sandbox.git(work, "add", "-A");
  sandbox.git(work, "commit", "-q", "-m", "widget");
  sandbox.git(work, "push", "-q", "origin", "main");
  return sandbox.git(work, "rev-parse", "HEAD");
}

function vaultFile(path: string, content: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), content);
}

function text(body: string | Uint8Array | undefined): string {
  return typeof body === "string" ? body : Buffer.from(body ?? new Uint8Array()).toString();
}

async function failure(work: () => unknown): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("The call was expected to fail.");
}

function project(repos: readonly string[], types: Readonly<Record<string, string>>): Project {
  return { frontMatter: { repos, repoTypes: types } } as unknown as Project;
}

async function approveHabits(
  values: Record<string, string | number | boolean> = { habits: "Life/Habits" },
): Promise<string> {
  const review = await widgets.review(habitsId, ownHosts);
  await widgets.approve(habitsId, review.commit, values, ownHosts);
  const token = widgets.frames(theme, [])[0]?.token;
  if (token === null || token === undefined) throw new Error("The widget must have a token.");
  return token;
}

beforeEach(() => {
  sandbox = createGitSandbox();
  work = sandbox.clone("work");
  commit({
    "eva-widget.json": JSON.stringify(manifest),
    "schemas/habits.json": JSON.stringify(habitSchema),
    "index.html": "<p>habits</p>",
    "main.js": "console.log(1);",
    "config.json": '{"habits":"mock"}',
    "data/habits/index.json": '["mock.json"]',
    "eva/theme.css": ":root{}",
  });
  folder = mkdtempSync(join(tmpdir(), "eva-widgets-"));
  vault = join(folder, "vault");
  vaultFile("Life/Habits/walk.json", JSON.stringify({ name: "Walk", checks: [], streak: 2 }));
  vaultFile("Life/About me.md", "# About me\n");
  vaultFile("Notes/other.json", "{}");
  mkdirSync(join(vault, ".eva"), { recursive: true });
  now = new Date("2026-01-01T09:00:00Z");
  location = { latitude: 41.39, longitude: 2.17, accuracy: 30, at: "2026-01-01T08:00:00Z", source: "web" };
  projects = [];
  options = {
    vaultPath: vault,
    approvals: new WidgetApprovals(join(folder, "state", "widget-approvals.json")),
    copies: new WidgetCopies({
      folder: join(folder, "widgets"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
      remoteOf: () => sandbox.remote,
    }),
    projects: () => projects,
    baseWidgets: ["https://github.com/example-owner/base-widget", "not an address"],
    location: () => location,
    exclusive: (work) => Promise.resolve().then(work),
    redact: (value) => value.replaceAll("ghp_secret", "[hidden]"),
    now: () => now,
  };
  widgets = new Widgets(options);
  widgets.add("https://github.com/Example-Owner/Habits");
}, gitHookTimeoutMs);

afterEach(() => {
  sandbox.dispose();
  rmSync(folder, { recursive: true, force: true });
});

describe("the list", () => {
  test("shows the vault entries, then each widget project, then each base widget, each once", () => {
    projects = [
      project(
        [
          "https://github.com/example-owner/project-widget",
          "https://github.com/example-owner/app",
          "https://github.com/example-owner/habits",
        ],
        {
          "https://github.com/example-owner/project-widget": "widget",
          "https://github.com/example-owner/app": "standard",
          "https://github.com/example-owner/habits": "widget",
        },
      ),
    ];
    expect(widgets.list() as unknown).toEqual([
      {
        id: habitsId,
        repository: "https://github.com/Example-Owner/Habits",
        owner: "Example-Owner",
        name: "Habits",
        sources: ["list", "project"],
        state: "off",
        size: null,
        problems: null,
      },
      expect.objectContaining({ id: "example-owner/project-widget", sources: ["project"], state: "off" }),
      expect.objectContaining({ id: "example-owner/base-widget", sources: ["base"], state: "off" }),
    ]);
  });

  test("adds a widget only once, and only by a GitHub address", async () => {
    expect(isEvaError(await failure(() => widgets.add("example-owner/HABITS")), "widget_invalid")).toBe(true);
    expect(isEvaError(await failure(() => widgets.add("https://example.com/x")), "widget_invalid")).toBe(true);
    expect(isEvaError(await failure(() => widgets.review("example-owner/unknown", ownHosts)), "widget_not_found")).toBe(
      true,
    );
  });

  test("moves a widget, and writes the whole order into the vault", () => {
    widgets.move("example-owner/base-widget", "up");
    expect(widgets.list().map((item) => item.id)).toEqual(["example-owner/base-widget", habitsId]);
    expect(readWidgetList(vault).map((entry) => entry.id)).toEqual(["example-owner/base-widget", habitsId]);
    widgets.move("example-owner/base-widget", "up");
    widgets.move(habitsId, "down");
    expect(widgets.list().map((item) => item.id)).toEqual(["example-owner/base-widget", habitsId]);
    expect(() => widgets.move("example-owner/unknown", "up")).toThrow("No widget");
  });
});

describe("the review and the approval", () => {
  test("shows the manifest at the newest commit, with the values of the vault", async () => {
    const review = await widgets.review(habitsId, ownHosts);
    expect(review).toMatchObject({ id: habitsId, owner: "Example-Owner", problems: [], values: {} });
    expect(review.manifest?.name).toBe("Habits");
    expect(review.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(widgets.list()[0]).toMatchObject({ size: "medium", problems: [] });
  });

  test("names each problem, and a widget with a problem cannot turn on", async () => {
    commit({
      "eva-widget.json": JSON.stringify({
        ...manifest,
        hosts: [{ url: "https://printer.local", why: "x" }],
        entry: "app.html",
      }),
      "schemas/habits.json": JSON.stringify({ type: "object", properties: { temp: {} } }),
    });
    const review = await widgets.review(habitsId, ownHosts);
    expect(review.manifest).toBeNull();
    expect(review.problems.join(" ")).toContain("printer.local");
    expect(review.problems.join(" ")).toContain("app.html");
    expect(review.problems.join(" ")).toContain('"temp"');
    expect(
      isEvaError(await failure(() => widgets.approve(habitsId, review.commit, {}, ownHosts)), "widget_invalid"),
    ).toBe(true);
    commit({ "eva-widget.json": "{ broken" });
    expect((await widgets.review(habitsId, ownHosts)).problems).toEqual(["eva-widget.json is not valid JSON."]);
  });

  test("a page that the widget route cannot serve is a problem", async () => {
    for (const entry of ["data/app.html", "Eva/app.html", ".hidden.html"]) {
      commit({ "eva-widget.json": JSON.stringify({ ...manifest, entry }), [entry]: "<p>x</p>" });
      const review = await widgets.review(habitsId, ownHosts);
      expect(review.problems.some((problem) => problem.startsWith("Eva cannot serve the page"))).toBe(true);
    }
  });

  test("a failed read shows its reason in the list", async () => {
    options = {
      ...options,
      copies: new WidgetCopies({
        ...{ folder: join(folder, "w2"), runner: systemProcessRunner, environment: gitEnvironment },
        remoteOf: () => join(folder, "none"),
      }),
    };
    widgets = new Widgets(options);
    const items = await widgets.reviewAll(ownHosts);
    expect(items[0]?.problems?.[0]).toContain("Eva cannot read");
    // The reason stays for a while, so each open of the list does not read the network again.
    expect((await widgets.reviewAll(ownHosts))[0]?.problems?.[0]).toContain("Eva cannot read");
  });

  test("approves at the reviewed commit, turns the widget on and installs that commit", async () => {
    const review = await widgets.review(habitsId, ownHosts);
    commit({ "index.html": "<p>newer</p>" });
    const items = await widgets.approve(
      habitsId,
      review.commit,
      { habits: " Life/Habits ", title: "Mine", extra: "x" },
      ownHosts,
    );
    expect(items[0]).toMatchObject({ state: "on", size: "medium", name: "Habits" });
    expect(readWidgetList(vault)[0]).toMatchObject({ enabled: true, inputs: { habits: "Life/Habits", title: "Mine" } });
    const record = options.approvals.get(habitsId);
    expect(record).toMatchObject({
      commit: review.commit,
      location: true,
      hosts: ["https://api.example.com"],
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
    });
    const token = widgets.frames(theme, [])[0]?.token ?? "";
    expect(text((await widgets.serve(token, "index.html", "GET", null))?.body)).toBe("<p>habits</p>");
  });

  test("refuses a stale commit and each input value that does not fit", async () => {
    const review = await widgets.review(habitsId, ownHosts);
    expect(
      await failure(() => widgets.approve(habitsId, "c".repeat(40), { habits: "Life/Habits" }, ownHosts)),
    ).toHaveProperty("message", "The widget changed. Open it again.");
    for (const [values, reason] of [
      [{}, "Habits folder needs a value."],
      [{ habits: "  " }, "Habits folder needs a value."],
      [{ habits: "Life" }, null],
      [{ habits: "Life/About me.md" }, "may not reach"],
      [{ habits: "Scratch" }, "may not reach"],
      [{ habits: "Life/Habits/walk.json" }, "pick a folder"],
      [{ habits: "Life/Missing" }, "pick a folder"],
      [{ habits: 3 }, "pick a place"],
      [{ habits: "Life/Habits", title: 4 }, "give a text"],
    ] as const) {
      const result = await failure(() => widgets.approve(habitsId, review.commit, values, ownHosts)).catch(
        (error: unknown) => error,
      );
      if (reason === null) expect(result).toBeInstanceOf(Error);
      else expect((result as Error).message).toContain(reason);
    }
  });

  test("checks each kind of input", async () => {
    const inputs = [
      { id: "count", type: "number", label: "Count", description: "d", why: "w", required: false },
      { id: "show", type: "boolean", label: "Show", description: "d", why: "w", required: false },
      { id: "mode", type: "choice", label: "Mode", description: "d", why: "w", required: false, choices: ["a", "b"] },
      { id: "site", type: "url", label: "Site", description: "d", why: "w", required: false },
      {
        id: "day",
        type: "file",
        label: "Day",
        description: "d",
        why: "w",
        required: false,
        access: "write",
        schema: "schemas/habits.json",
      },
      { id: "notes", type: "file", label: "Notes", description: "d", why: "w", required: false, access: "read" },
    ];
    commit({ "eva-widget.json": JSON.stringify({ ...manifest, hosts: [], inputs }) });
    const review = await widgets.review(habitsId, ownHosts);
    for (const [values, reason] of [
      [{ count: "x" }, "give a number"],
      [{ count: Number.POSITIVE_INFINITY }, "give a number"],
      [{ show: "yes" }, "give yes or no"],
      [{ mode: "c" }, "pick one of the choices"],
      [{ site: "not a site" }, "give a web address"],
      [{ day: "Notes" }, "pick a file, not a folder"],
      [{ day: "Notes/AGENTS.md" }, "JSON or YAML"],
      [{ notes: "Notes/missing.md" }, "pick a file that exists"],
    ] as const) {
      expect(
        ((await failure(() => widgets.approve(habitsId, review.commit, values, ownHosts))) as Error).message,
      ).toContain(reason);
    }
    await widgets.approve(
      habitsId,
      review.commit,
      {
        count: 3,
        show: false,
        mode: "b",
        site: "https://example.com",
        day: "Notes/day.json",
        notes: "Notes/other.json",
      },
      ownHosts,
    );
    expect(options.approvals.get(habitsId)?.location).toBe(false);
    expect(readWidgetList(vault)[0]?.inputs).toEqual({
      count: 3,
      show: false,
      mode: "b",
      site: "https://example.com",
      day: "Notes/day.json",
      notes: "Notes/other.json",
    });
  });
});

describe("on, off and remove", () => {
  test("turning off ends the token at once; turning on again asks nothing and keeps the place", async () => {
    widgets.add("example-owner/second");
    const token = await approveHabits();
    widgets.setEnabled(habitsId, false);
    expect(await widgets.serve(token, "index.html", "GET", null)).toBeNull();
    expect(widgets.frames(theme, [])).toEqual([]);
    widgets.setEnabled(habitsId, true);
    expect(readWidgetList(vault).map((entry) => entry.id)).toEqual([habitsId, "example-owner/second"]);
    expect(widgets.frames(theme, [token])[0]?.token).not.toBe(token);
    expect(
      isEvaError(await failure(() => widgets.setEnabled("example-owner/second", true)), "widget_needs_approval"),
    ).toBe(true);
    expect(
      isEvaError(await failure(() => widgets.setEnabled("example-owner/base-widget", true)), "widget_needs_approval"),
    ).toBe(true);
  });

  test("removing drops the approval, the copy and the entry, and keeps the person's data", async () => {
    projects = [
      project(["https://github.com/example-owner/habits"], { "https://github.com/example-owner/habits": "widget" }),
    ];
    const token = await approveHabits();
    expect(existsSync(join(folder, "widgets", "example-owner", "habits"))).toBe(true);
    const items = widgets.remove(habitsId);
    expect(await widgets.serve(token, "index.html", "GET", null)).toBeNull();
    expect(options.approvals.get(habitsId)).toBeNull();
    expect(existsSync(join(folder, "widgets", "example-owner", "habits"))).toBe(false);
    expect(readWidgetList(vault)).toEqual([]);
    expect(existsSync(join(vault, "Life/Habits/walk.json"))).toBe(true);
    // A widget project stays in the list, off.
    expect(items[0]).toMatchObject({ id: habitsId, sources: ["project"], state: "off" });
  });
});

describe("the grid", () => {
  test("a widget on in the vault with no approval here shows a card to approve", () => {
    writeWidgetList(vault, [{ ...(readWidgetList(vault)[0] ?? ({} as never)), enabled: true }]);
    expect(widgets.frames(theme, [])).toEqual([
      { id: habitsId, name: "Habits", size: "small", src: null, token: null },
    ]);
    expect(widgets.list()[0]?.state).toBe("approve");
  });

  test("keeps a working token, renews an old one, and releases tokens", async () => {
    const token = await approveHabits();
    const [frame] = widgets.frames(theme, [token]);
    expect(frame).toEqual({ id: habitsId, name: "Habits", size: "medium", src: `/widgets/${token}/index.html`, token });
    expect(widgets.frames(theme, ["unknown"])[0]?.token).not.toBe(token);
    now = new Date(now.getTime() + 5.5 * 60 * 60_000);
    expect(widgets.frames(theme, [token])[0]?.token).not.toBe(token);
    // After 6 hours a token ends.
    now = new Date(now.getTime() + 60 * 60_000);
    expect(widgets.isLive(token)).toBe(false);
    const fresh = widgets.frames(theme, [])[0]?.token ?? "";
    expect(widgets.isLive(fresh)).toBe(true);
    widgets.release([fresh]);
    expect(widgets.isLive(fresh)).toBe(false);
    expect(widgets.hostsOf(fresh)).toEqual([]);
  });
});

describe("the widget routes", () => {
  test("answer the contract paths from Eva, never from the copy's mock files", async () => {
    const token = await approveHabits({ habits: "Life/Habits", title: "Mine" });
    expect(widgets.hostsOf(token)).toEqual(["https://api.example.com"]);
    expect(JSON.parse(text((await widgets.serve(token, "config.json", "GET", null))?.body))).toEqual({
      title: "Mine",
      habits: "Life/Habits",
    });
    expect(JSON.parse(text((await widgets.serve(token, "data/habits/index.json", "GET", null))?.body))).toEqual([
      "walk.json",
    ]);
    expect(JSON.parse(text((await widgets.serve(token, "eva/location.json", "GET", null))?.body))).toEqual({
      latitude: 41.39,
      longitude: 2.17,
      accuracy: 30,
      at: "2026-01-01T08:00:00Z",
    });
    location = null;
    expect(text((await widgets.serve(token, "eva/location.json", "GET", null))?.body)).toBe("null");
    const css = await widgets.serve(token, "eva/theme.css", "GET", null);
    expect(css).toMatchObject({ status: 200, contentType: "text/css; charset=utf-8" });
    expect(text(css?.body)).toContain("color-scheme: dark");
    expect((await widgets.serve(token, "eva/other.json", "GET", null))?.status).toBe(404);
    for (const path of ["Config.json", "DATA/habits/index.json", "Eva/theme.css", "data"]) {
      expect({ path, status: (await widgets.serve(token, path, "GET", null))?.status }).toEqual({ path, status: 404 });
    }
    expect((await widgets.serve(token, "data/other/x.json", "GET", null))?.status).toBe(404);
    expect((await widgets.serve(token, "data/habitsx", "GET", null))?.status).toBe(404);
    expect((await widgets.serve(token, "data", "GET", null))?.status).toBe(404);
    expect((await widgets.serve(token, "", "GET", null))?.status).toBe(404);
    expect((await widgets.serve(token, "main.js", "PUT", null))?.status).toBe(405);
    expect((await widgets.serve(token, "main.js", "HEAD", null))?.status).toBe(200);
    expect(await widgets.serve("unknown", "index.html", "GET", null)).toBeNull();
  });

  test("a widget with no location permission gets null", async () => {
    commit({ "eva-widget.json": JSON.stringify({ ...manifest, inputs: manifest.inputs.slice(0, 2) }) });
    const token = await approveHabits();
    expect(text((await widgets.serve(token, "eva/location.json", "GET", null))?.body)).toBe("null");
  });

  test("a write keeps the unknown fields, and a delete removes the file", async () => {
    const token = await approveHabits();
    const body = Buffer.from(JSON.stringify({ name: "Walk", checks: [{ date: "2026-01-01" }] }));
    expect((await widgets.serve(token, "data/habits/walk.json", "PUT", body))?.status).toBe(204);
    expect(JSON.parse(readFileSync(join(vault, "Life/Habits/walk.json"), "utf-8"))).toEqual({
      name: "Walk",
      checks: [{ date: "2026-01-01" }],
      streak: 2,
    });
    expect((await widgets.serve(token, "data/habits/AGENTS.md", "PUT", Buffer.from("# Rules")))?.status).toBe(403);
    expect((await widgets.serve(token, "data/habits/../About me.md", "GET", null))?.status).toBe(404);
    expect((await widgets.serve(token, "data/habits/x.json", "PUT", null))?.status).toBe(400);
    expect((await widgets.serve(token, "data/habits/walk.json", "DELETE", null))?.status).toBe(204);
    expect(existsSync(join(vault, "Life/Habits/walk.json"))).toBe(false);
  });

  test("a schema that the copy no longer holds keeps every old field", async () => {
    const token = await approveHabits();
    rmSync(join(folder, "widgets", "example-owner", "habits", "schemas"), { recursive: true });
    const body = Buffer.from(JSON.stringify({ checks: [] }));
    expect((await widgets.serve(token, "data/habits/walk.json", "PUT", body))?.status).toBe(204);
    expect(JSON.parse(readFileSync(join(vault, "Life/Habits/walk.json"), "utf-8"))).toMatchObject({
      name: "Walk",
      streak: 2,
    });
  });

  test("a folder that an agent changes in the vault gives the widget nothing until a new approval", async () => {
    const token = await approveHabits();
    const raw = JSON.parse(readFileSync(widgetListPath(vault), "utf-8")) as {
      widgets: { inputs: Record<string, string> }[];
    };
    const first = raw.widgets[0];
    if (first === undefined) throw new Error("The entry must be there.");
    first.inputs["habits"] = "Notes";
    writeFileSync(widgetListPath(vault), JSON.stringify(raw));
    expect(await widgets.serve(token, "data/habits/index.json", "GET", null)).toBeNull();
    expect(widgets.frames(theme, [])[0]?.token).toBeNull();
    expect(widgets.list()[0]?.state).toBe("approve");
  });

  test("an empty input that an agent fills in the vault needs a new approval too", async () => {
    commit({
      "eva-widget.json": JSON.stringify({
        ...manifest,
        inputs: [{ ...manifest.inputs[1], required: false }],
      }),
    });
    const token = await approveHabits({});
    expect(options.approvals.get(habitsId)?.paths[0]?.path).toBeNull();
    expect((await widgets.serve(token, "data/habits/index.json", "GET", null))?.status).toBe(404);
    const [entry] = readWidgetList(vault);
    if (entry === undefined) throw new Error("The entry must be there.");
    writeWidgetList(vault, [{ ...entry, inputs: { habits: "Life/Habits" } }]);
    expect(await widgets.serve(token, "config.json", "GET", null)).toBeNull();
  });

  test("a hand edit of the installed manifest gives no new host", async () => {
    const token = await approveHabits();
    writeFileSync(
      join(folder, "widgets", "example-owner", "habits", "eva-widget.json"),
      JSON.stringify({ ...manifest, hosts: [{ url: "https://evil.example.com", why: "x" }] }),
    );
    expect(widgets.hostsOf(token)).toEqual(["https://api.example.com"]);
  });
});

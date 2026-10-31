import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Project } from "../../../../src/core/projects/project-catalog.ts";
import { WidgetApprovals } from "../../../../src/core/widgets/widget-approvals.ts";
import { WidgetCopies } from "../../../../src/core/widgets/widget-copies.ts";
import { readWidgetList } from "../../../../src/core/widgets/widget-list.ts";
import { widgetTheme } from "../../../../src/core/widgets/widget-policy.ts";
import { PreviewGrants } from "../../../../src/core/widgets/widget-previews.ts";
import { Widgets, type WidgetsOptions } from "../../../../src/core/widgets/widgets.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

const id = "example-owner/habits";
const url = "https://github.com/example-owner/habits";
const ownHosts = ["127.0.0.1", "localhost"];
const theme = widgetTheme("dark", { "--bg": "#000000" });
const place = { project: "2026-01-01-0900-habits", clone: "clone-0", repository: "habits" };

const habits = {
  id: "habits",
  type: "folder",
  label: "Habits folder",
  description: "One file for each habit.",
  why: "The widget shows and checks your habits.",
  required: true,
  access: "write",
  schema: "schemas/habits.json",
  files: "*.json",
};
const here = {
  id: "location",
  type: "eva-location",
  label: "Location",
  description: "Your last location.",
  why: "The widget shows where you are.",
  required: false,
};
const manifest = { contract: 1, name: "Habits", size: "medium", inputs: [habits, here], hosts: [] };
const schema = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { name: { type: "string" }, checks: { type: "array" } },
});

let sandbox: GitSandbox;
let folder: string;
let vault: string;
let clone: string;
let options: WidgetsOptions;
let widgets: Widgets;

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
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

const widgetFiles = {
  "eva-widget.json": JSON.stringify(manifest),
  "schemas/habits.json": schema,
  "index.html": "<p>main</p>",
  "config.json": '{"habits":"mock"}',
  "data/habits/index.json": '["walk.json"]',
  "data/habits/walk.json": '{"name":"Mock walk"}',
  "example/location.json": '{"latitude":1,"longitude":2}',
  ".gitignore": "secret.txt\n",
};

beforeEach(() => {
  sandbox = createGitSandbox();
  const work = sandbox.clone("work");
  for (const [path, content] of Object.entries(widgetFiles)) sandbox.write(work, path, content);
  sandbox.git(work, "add", "-A");
  sandbox.git(work, "commit", "-q", "-m", "widget");
  sandbox.git(work, "push", "-q", "origin", "main");
  folder = mkdtempSync(join(tmpdir(), "eva-widget-previews-"));
  vault = join(folder, "vault");
  write(vault, "Life/Habits/walk.json", JSON.stringify({ name: "Walk", checks: [] }));
  mkdirSync(join(vault, ".eva"), { recursive: true });
  const projectPath = join(vault, "Projects", place.project);
  clone = join(projectPath, "repos", "clone-0", "habits");
  mkdirSync(dirname(clone), { recursive: true });
  sandbox.git(dirname(clone), "clone", "-q", sandbox.remote, "habits");
  const project = {
    id: place.project,
    path: projectPath,
    frontMatter: { repos: [url], repoTypes: { [url]: "widget" } },
  };
  options = {
    vaultPath: vault,
    approvals: new WidgetApprovals(join(folder, "state", "widget-approvals.json")),
    copies: new WidgetCopies({
      folder: join(folder, "widgets"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
      remoteOf: () => sandbox.remote,
    }),
    previewGrants: new PreviewGrants(join(folder, "state", "widget-previews.json")),
    projects: () => [project as unknown as Project],
    baseWidgets: [],
    location: () => ({ latitude: 41.39, longitude: 2.17, accuracy: 30, at: "2026-01-01T08:00:00Z", source: "web" }),
    exclusive: (work) => Promise.resolve().then(work),
    redact: (value) => value,
    now: () => new Date("2026-01-01T09:00:00Z"),
  };
  widgets = new Widgets(options);
}, gitHookTimeoutMs);

afterEach(() => {
  sandbox.dispose();
  rmSync(folder, { recursive: true, force: true });
});

async function get(token: string, path: string): Promise<{ status: number | null; body: string }> {
  const answer = await widgets.serve(token, path, "GET", null);
  return { status: answer?.status ?? null, body: text(answer?.body) };
}

describe("the preview of a clone", () => {
  test("shows a change that is not pushed, with the clone's example data", async () => {
    write(clone, "index.html", "<p>not pushed</p>");
    const preview = await widgets.preview(place, "example", theme, ownHosts);
    expect(preview).toMatchObject({ name: "Habits", size: "medium", mode: "example", problems: [], ask: null });
    const token = preview.token ?? "";
    expect(preview.src).toBe(`/widgets/${token}/index.html`);
    expect(widgets.isLive(token)).toBe(true);
    expect(await get(token, "index.html")).toEqual({ status: 200, body: "<p>not pushed</p>" });
    expect((await get(token, "config.json")).body).toBe('{"habits":"mock"}');
    expect((await get(token, "data/habits/walk.json")).body).toBe('{"name":"Mock walk"}');
    expect((await get(token, "eva/location.json")).body).toBe('{"latitude":1,"longitude":2}');
    expect((await get(token, "eva/theme.css")).body).toContain("--bg");
    // A write fails, so the widget shows its demo note, and the vault stays as it was.
    expect((await widgets.serve(token, "data/habits/walk.json", "PUT", new Uint8Array()))?.status).toBe(405);
    expect(readFileSync(join(vault, "Life/Habits/walk.json"), "utf-8")).toContain('"Walk"');
  });

  test("never serves git data, a hidden name, an ignored file or a link", async () => {
    write(clone, "secret.txt", "token");
    const token = (await widgets.preview(place, "example", theme, ownHosts)).token ?? "";
    for (const path of [".git/config", ".gitignore", "secret.txt", "../habits/index.html", "", "eva/other.css"])
      expect({ path, status: (await get(token, path)).status }).toEqual({ path, status: 404 });
    try {
      symlinkSync(vault, join(clone, "up"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    expect((await get(token, "up/Life/Habits/walk.json")).status).toBe(404);
  });

  test("a widget that is not set up asks for each permission at the first switch to My data", async () => {
    const asked = await widgets.preview(place, "mine", theme, ownHosts);
    expect(asked.token).toBeNull();
    expect(asked.ask).toMatchObject({ setUp: false, values: {} });
    expect(asked.ask?.added).toEqual(["Read your last location."]);
    const approved = await widgets.approvePreview(
      place,
      asked.ask?.digest ?? "",
      { habits: "Life/Habits" },
      theme,
      ownHosts,
    );
    const token = approved.token ?? "";
    expect(approved.ask).toBeNull();
    expect(JSON.parse((await get(token, "config.json")).body)).toEqual({ habits: "Life/Habits" });
    expect((await get(token, "data/habits/walk.json")).body).toContain('"Walk"');
    expect(JSON.parse((await get(token, "eva/location.json")).body)).toMatchObject({ latitude: 41.39 });
    // My data writes the real vault.
    const put = await widgets.serve(token, "data/habits/walk.json", "PUT", Buffer.from('{"name":"Walk","checks":[1]}'));
    expect(put?.status).toBe(204);
    expect(readFileSync(join(vault, "Life/Habits/walk.json"), "utf-8")).toContain("1");
    // The approval of a preview reaches neither the approved records nor the vault list.
    expect(options.approvals.get(id)).toBeNull();
    expect(readWidgetList(vault)).toEqual([]);
    // A second open asks nothing.
    expect((await widgets.preview(place, "mine", theme, ownHosts)).ask).toBeNull();
  });

  test("a widget that is set up uses its approval, and asks only for what the clone adds", async () => {
    widgets.add(url);
    const review = await widgets.review(id, ownHosts);
    await widgets.approve(id, review.commit, { habits: "Life/Habits" }, ownHosts);
    const same = await widgets.preview(place, "mine", theme, ownHosts);
    expect(same.ask).toBeNull();
    expect(JSON.parse((await get(same.token ?? "", "config.json")).body)).toEqual({ habits: "Life/Habits" });
    write(
      clone,
      "eva-widget.json",
      JSON.stringify({ ...manifest, hosts: [{ url: "https://rain.example.com", why: "The rain." }] }),
    );
    const asked = await widgets.preview(place, "mine", theme, ownHosts);
    expect(asked.ask).toMatchObject({ setUp: true, added: ["Send requests to https://rain.example.com."] });
    const approved = await widgets.approvePreview(
      place,
      asked.ask?.digest ?? "",
      asked.ask?.values ?? {},
      theme,
      ownHosts,
    );
    expect(widgets.hostsOf(approved.token ?? "")).toEqual(["https://rain.example.com"]);
    // The installed widget still has no such host.
    expect(options.approvals.get(id)?.hosts).toEqual([]);
    const frame = widgets.frames(theme, [])[0]?.token ?? "";
    expect(widgets.hostsOf(frame)).toEqual([]);
  });

  test("an approval for a manifest that changed since the ask fails", async () => {
    const asked = await widgets.preview(place, "mine", theme, ownHosts);
    write(clone, "eva-widget.json", JSON.stringify({ ...manifest, name: "Other" }));
    const error = await failure(() =>
      widgets.approvePreview(place, asked.ask?.digest ?? "", { habits: "Life/Habits" }, theme, ownHosts),
    );
    expect(isEvaError(error, "widget_invalid")).toBe(true);
  });

  test("a manifest problem shows no frame, and an unknown clone or repository fails", async () => {
    write(clone, "eva-widget.json", "{ broken");
    const broken = await widgets.preview(place, "example", theme, ownHosts);
    expect(broken.src).toBeNull();
    expect(broken.problems).toEqual(["eva-widget.json is not valid JSON."]);
    expect(
      isEvaError(
        await failure(() => widgets.preview({ ...place, clone: "clone-9" }, "example", theme, ownHosts)),
        "project_not_found",
      ),
    ).toBe(true);
    expect(
      isEvaError(
        await failure(() => widgets.preview({ ...place, project: "none" }, "example", theme, ownHosts)),
        "project_not_found",
      ),
    ).toBe(true);
  });

  test("a write that conflicts with another widget's data cannot get My data", async () => {
    widgets.add(url);
    const review = await widgets.review(id, ownHosts);
    await widgets.approve(id, review.commit, { habits: "Life/Habits" }, ownHosts);
    // A clone of another widget that names a field of the folder with another type.
    const other = "https://github.com/example-owner/other";
    const projectPath = join(vault, "Projects", place.project);
    options = {
      ...options,
      projects: () =>
        [
          { id: place.project, path: projectPath, frontMatter: { repos: [other], repoTypes: { [other]: "widget" } } },
        ] as unknown as Project[],
    };
    widgets = new Widgets(options);
    // The folder name of the clone is the repository name.
    sandbox.git(dirname(clone), "clone", "-q", sandbox.remote, "other");
    const otherClone = join(dirname(clone), "other");
    write(
      otherClone,
      "schemas/habits.json",
      JSON.stringify({ ...JSON.parse(schema), properties: { name: { type: "number" } } }),
    );
    const otherPlace = { ...place, repository: "other" };
    const asked = await widgets.preview(otherPlace, "mine", theme, ownHosts);
    const error = await failure(() =>
      widgets.approvePreview(otherPlace, asked.ask?.digest ?? "", { habits: "Life/Habits" }, theme, ownHosts),
    );
    expect(isEvaError(error, "widget_format_conflict")).toBe(true);
  });

  test("a write checks the schema of the open, not a schema that an agent changed since", async () => {
    const asked = await widgets.preview(place, "mine", theme, ownHosts);
    const token =
      (await widgets.approvePreview(place, asked.ask?.digest ?? "", { habits: "Life/Habits" }, theme, ownHosts))
        .token ?? "";
    const strict = JSON.parse(schema) as { properties: Record<string, unknown> };
    write(
      clone,
      "schemas/habits.json",
      JSON.stringify({
        ...strict,
        properties: { ...strict.properties, streak: { type: "number" } },
        required: ["streak"],
      }),
    );
    const put = await widgets.serve(token, "data/habits/walk.json", "PUT", Buffer.from('{"name":"Walk"}'));
    expect(put?.status).toBe(204);
    // A new open sees the change, and asks again.
    expect((await widgets.preview(place, "mine", theme, ownHosts)).ask?.added).toEqual([
      "Write the folder Life/Habits in a new data format (schemas/habits.json).",
    ]);
  });

  test("the grant and the token go when the clone goes", async () => {
    const asked = await widgets.preview(place, "mine", theme, ownHosts);
    const approved = await widgets.approvePreview(
      place,
      asked.ask?.digest ?? "",
      { habits: "Life/Habits" },
      theme,
      ownHosts,
    );
    rmSync(dirname(clone), { recursive: true, force: true });
    expect(widgets.isLive(approved.token ?? "")).toBe(false);
    await widgets.checkUpdates();
    expect(JSON.parse(readFileSync(join(folder, "state", "widget-previews.json"), "utf-8"))).toEqual({
      version: 1,
      previews: [],
    });
  });
});

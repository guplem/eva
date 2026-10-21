import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  type NewProjectInput,
  type NewProjectSteps,
} from "../../../../src/core/projects/new-project.ts";
import { discoverProjects } from "../../../../src/core/projects/project-catalog.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";

let vault: string;
const projectsFolder = (): string => join(vault, "Projects");

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-new-project-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

const input: NewProjectInput = {
  name: "Example App",
  description: "A small app to try Eva.",
  status: "active",
  tags: ["work", "#demo"],
  github: false,
  drive: false,
};

/** Steps that a test must not reach. */
const noSteps: NewProjectSteps = {
  createRepository: () => Promise.reject(new Error("No repository in this test.")),
  createDriveFolder: () => Promise.reject(new Error("No Drive folder in this test.")),
};

function fileOf(projectId: string): string {
  return readFileSync(join(projectsFolder(), projectId, "AGENTS.md"), "utf-8");
}

describe("createProject", () => {
  test("writes the folder and an AGENTS.md that the project list reads", async () => {
    const result = await createProject(
      input,
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      noSteps,
    );

    expect(result).toEqual({ projectId: "2026-10-21-1542-example-app", github: null, drive: null });
    expect(fileOf(result.projectId)).toBe(
      [
        "---",
        "created: 2026-10-21T15:42",
        "status: active",
        "tags:",
        "  - work",
        "  - demo",
        "---",
        "",
        "# Example App",
        "",
        "A small app to try Eva.",
        "",
      ].join("\n"),
    );
    const [project] = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(project).toMatchObject({
      id: "2026-10-21-1542-example-app",
      title: "Example App",
      description: "A small app to try Eva.",
      warnings: [],
    });
  });

  test("without a description, the file has the title only", async () => {
    const result = await createProject(
      { ...input, description: "  ", tags: [] },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      noSteps,
    );

    expect(fileOf(result.projectId)).toBe("---\ncreated: 2026-10-21T15:42\nstatus: active\n---\n\n# Example App\n");
  });

  test("creates the repository and the Drive folder, and the file names both", async () => {
    const asked: string[] = [];
    const result = await createProject(
      { ...input, github: true, drive: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        createRepository: (name, description) => {
          asked.push(`repository ${name}: ${description}`);
          return Promise.resolve("https://github.com/example/example-app");
        },
        createDriveFolder: (name) => {
          asked.push(`folder ${name}`);
          return Promise.resolve("https://drive.google.com/drive/folders/folder-1");
        },
      },
    );

    expect(asked.toSorted()).toEqual(["folder Example App", "repository example-app: A small app to try Eva."]);
    expect(result).toEqual({
      projectId: "2026-10-21-1542-example-app",
      github: { url: "https://github.com/example/example-app" },
      drive: { url: "https://drive.google.com/drive/folders/folder-1" },
    });
    const text = fileOf(result.projectId);
    expect(text).toContain("repos:\n  - https://github.com/example/example-app\n");
    expect(text).toEndWith(
      "A small app to try Eva.\n\n- Google Drive folder: https://drive.google.com/drive/folders/folder-1\n",
    );
    const [project] = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(project?.frontMatter.repos).toEqual(["https://github.com/example/example-app"]);
    expect(project?.description).toBe("A small app to try Eva.");
  });

  test("without a description, the Drive link never reads as the description", async () => {
    await createProject(
      { ...input, description: "", drive: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      { ...noSteps, createDriveFolder: () => Promise.resolve("https://drive.google.com/drive/folders/folder-1") },
    );

    const [project] = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(project?.description).toBeNull();
  });

  test("a long name gives a repository name that GitHub takes", async () => {
    const names: string[] = [];
    await createProject(
      { ...input, name: "A very long project name ".repeat(8), github: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        ...noSteps,
        createRepository: (name) => {
          names.push(name);
          return Promise.resolve("https://github.com/example/x");
        },
      },
    );

    expect(names[0]?.length).toBeLessThanOrEqual(60);
    const [project] = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(project?.id).toBe(`2026-10-21-1542-${names[0] ?? ""}`);
  });

  test("a failed step keeps the project and says why", async () => {
    const result = await createProject(
      { ...input, github: true, drive: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        createRepository: () => Promise.reject(new EvaError("github_failed", "name already exists on this account")),
        createDriveFolder: () => Promise.reject(new EvaError("google_failed", "Turn on Google Drive first.")),
      },
    );

    expect(result).toEqual({
      projectId: "2026-10-21-1542-example-app",
      github: { problem: "name already exists on this account" },
      drive: { problem: "Turn on Google Drive first." },
    });
    expect(fileOf(result.projectId)).not.toContain("repos:");
  });

  test("an id that exists fails, and the old project stays as it was", async () => {
    const options = { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" };
    await createProject(input, options, noSteps);

    const error = await createProject({ ...input, description: "Another one." }, options, noSteps).catch(
      (caught: unknown) => caught,
    );

    expect(isEvaError(error, "project_invalid")).toBe(true);
    expect(fileOf("2026-10-21-1542-example-app")).toContain("A small app to try Eva.");
  });

  test("a bad value fails before any folder or step", async () => {
    mkdirSync(projectsFolder());
    for (const bad of [
      { ...input, name: "!!!" },
      { ...input, name: "Two\nlines" },
      { ...input, tags: ["two words"] },
    ]) {
      const error = await createProject(
        { ...bad, github: true },
        { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
        noSteps,
      ).catch((caught: unknown) => caught);
      expect(isEvaError(error, "project_invalid")).toBe(true);
    }
    expect(existsSync(join(projectsFolder(), "2026-10-21-1542-two-lines"))).toBe(false);
  });
});

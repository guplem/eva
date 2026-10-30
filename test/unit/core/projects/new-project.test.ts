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
  repository: null,
  drive: false,
};

const standard = { type: "standard", visibility: "private" } as const;

/** Steps that a test must not reach. */
const noSteps: NewProjectSteps = {
  createRepository: () => Promise.reject(new Error("No repository in this test.")),
  createDriveFolder: () => Promise.reject(new Error("No Drive folder in this test.")),
  setUpRepository: () => Promise.reject(new Error("No repository setup in this test.")),
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

    expect(result).toEqual({ projectId: "2026-10-21-1542-example-app", github: null, drive: null, setup: null });
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

  test("creates the repository and the Drive folder, the file names both, then the repository gets its setup", async () => {
    const asked: string[] = [];
    const result = await createProject(
      { ...input, repository: { type: "vibe-coded", visibility: "public" }, drive: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        setUpRepository: (projectId, url, type) => {
          // The setup reads the project file, so the file names the repository and its type first.
          expect(fileOf(projectId)).toContain(`repo_types:\n  ${url}: ${type}\n`);
          asked.push(`setup ${url} as ${type}`);
          return Promise.resolve({ sessionId: "chat-1", problems: [] });
        },
        createRepository: (name, description, visibility) => {
          asked.push(`repository ${name} (${visibility}): ${description}`);
          return Promise.resolve("https://github.com/example/example-app");
        },
        createDriveFolder: (name) => {
          asked.push(`folder ${name}`);
          return Promise.resolve("https://drive.google.com/drive/folders/folder-1");
        },
      },
    );

    expect(asked.toSorted()).toEqual([
      "folder Example App",
      "repository example-app (public): A small app to try Eva.",
      "setup https://github.com/example/example-app as vibe-coded",
    ]);
    expect(result).toEqual({
      projectId: "2026-10-21-1542-example-app",
      github: { url: "https://github.com/example/example-app" },
      drive: { url: "https://drive.google.com/drive/folders/folder-1" },
      setup: { sessionId: "chat-1", problems: [] },
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

  test("a widget project tells the agent to read the rules of the repository first, as a list item", async () => {
    const result = await createProject(
      { ...input, description: "", repository: { type: "widget", visibility: "public" } },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        ...noSteps,
        createRepository: () => Promise.resolve("https://github.com/example/habits-widget"),
        setUpRepository: () => Promise.resolve({ sessionId: "chat-1", problems: [] }),
      },
    );
    const text = fileOf(result.projectId);
    expect(text).toEndWith(
      "# Example App\n\n- This project is a widget for Eva's home page. Before any work, read `habits-widget/AGENTS.md` in the clone.\n",
    );
    const [project] = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(project?.description).toBeNull();
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
      { ...input, name: "A very long project name ".repeat(8), repository: standard },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        ...noSteps,
        setUpRepository: () => Promise.resolve({ sessionId: null, problems: [] }),
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
      { ...input, repository: standard, drive: true },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        createRepository: () => Promise.reject(new EvaError("github_failed", "name already exists on this account")),
        createDriveFolder: () => Promise.reject(new EvaError("google_failed", "Turn on Google Drive first.")),
        setUpRepository: () => Promise.reject(new Error("No setup without a repository.")),
      },
    );

    expect(result).toEqual({
      projectId: "2026-10-21-1542-example-app",
      github: { problem: "name already exists on this account" },
      drive: { problem: "Turn on Google Drive first." },
      setup: null,
    });
    expect(fileOf(result.projectId)).not.toContain("repos:");
  });

  test("a failed setup keeps the project and the repository, and says why", async () => {
    const result = await createProject(
      { ...input, repository: standard },
      { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
      {
        ...noSteps,
        createRepository: () => Promise.resolve("https://github.com/example/example-app"),
        setUpRepository: () => Promise.reject(new EvaError("github_failed", "GitHub did not answer in time.")),
      },
    );

    expect(result.github).toEqual({ url: "https://github.com/example/example-app" });
    expect(result.setup).toEqual({ sessionId: null, problems: ["GitHub did not answer in time."] });
    expect(fileOf(result.projectId)).toContain("repo_types:");
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
        { ...bad, repository: standard },
        { projectsFolder: projectsFolder(), wallClock: "2026-10-21T15:42" },
        noSteps,
      ).catch((caught: unknown) => caught);
      expect(isEvaError(error, "project_invalid")).toBe(true);
    }
    expect(existsSync(join(projectsFolder(), "2026-10-21-1542-two-lines"))).toBe(false);
  });
});

/**
 * Creates a new project from the form: its folder, its `AGENTS.md`, and, when asked, a GitHub
 * repository of a type and a Google Drive folder. The setup of the repository comes last, by its
 * type. The local folder comes first, so a failed step loses nothing: the project stays, and the
 * result says which step failed and why.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import type { ProjectStatus } from "./project-catalog.ts";
import type { RepositoryVisibility } from "../vault/github-repositories.ts";
import { applyProjectDetails, setRepositoryType } from "./project-file.ts";
import { formatProjectId, projectSlug } from "./project-id.ts";
import type { RepositoryTypeName } from "./repository-types.ts";

/** The repository that the form asks for. */
export interface NewRepository {
  readonly type: RepositoryTypeName;
  readonly visibility: RepositoryVisibility;
}

export interface NewProjectInput {
  /** The title. The folder name takes its slug. */
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly tags: readonly string[];
  /** A GitHub repository named after the slug, or null for none. */
  readonly repository: NewRepository | null;
  /** True creates a Google Drive folder named after the title. */
  readonly drive: boolean;
}

export interface NewProjectOptions {
  /** The vault's `Projects/` folder. */
  readonly projectsFolder: string;
  /** Now, in the configured time zone, as `YYYY-MM-DDTHH:mm`. */
  readonly wallClock: string;
}

/** The optional steps. Each one throws an `EvaError` that the person can read. */
export interface NewProjectSteps {
  /** Gives the address of the new repository. */
  readonly createRepository: (name: string, description: string, visibility: RepositoryVisibility) => Promise<string>;
  /** Gives the link of the new folder. */
  readonly createDriveFolder: (name: string) => Promise<string>;
  /** Applies the setup of the type to the new repository, once the project file names it. */
  readonly setUpRepository: (projectId: string, url: string, type: RepositoryTypeName) => Promise<NewProjectSetup>;
}

export type NewProjectStep = { readonly url: string } | { readonly problem: string };

/** What the setup of a new repository did. */
export interface NewProjectSetup {
  /** The Project chat that does the rest of the setup, or null when nothing needed a chat. */
  readonly sessionId: string | null;
  /** One sentence for each part of the setup that failed. */
  readonly problems: readonly string[];
}

export interface NewProjectResult {
  readonly projectId: string;
  /** Null when the form did not ask for the step. */
  readonly github: NewProjectStep | null;
  readonly drive: NewProjectStep | null;
  /** Null when Eva created no repository. */
  readonly setup: NewProjectSetup | null;
}

/** GitHub keeps at most 350 characters of a description, on one line. */
const repositoryDescriptionLimit = 350;

/** Throws `project_invalid` for a bad value or an id that exists, before any step runs. */
export async function createProject(
  input: NewProjectInput,
  options: NewProjectOptions,
  steps: NewProjectSteps,
): Promise<NewProjectResult> {
  const title = input.name.trim();
  const description = input.description.replaceAll("\r\n", "\n").trim();
  const projectId = formatProjectId(options.wallClock, title);
  const textWith = (results: { repository: string | null; driveFolder: string | null }): string =>
    projectText(options.wallClock, title, description, input, results);
  // A bad title or tag fails here, before the folder or a step exists.
  const first = textWith({ repository: null, driveFolder: null });

  const folder = join(options.projectsFolder, projectId);
  mkdirSync(options.projectsFolder, { recursive: true });
  try {
    // Not recursive, so an existing project is never written over.
    mkdirSync(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new EvaError("project_invalid", `The project ${projectId} exists already. Pick another name.`);
    throw error;
  }
  const file = join(folder, "AGENTS.md");
  try {
    writeFileAtomic(file, first);
  } catch (error) {
    // The list skips a folder with no AGENTS.md, so an empty one would only block the next send.
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }

  const oneLine = description.replace(/\s+/g, " ").slice(0, repositoryDescriptionLimit);
  const [github, drive] = await Promise.all([
    input.repository === null
      ? null
      : runStep(() => steps.createRepository(projectSlug(title), oneLine, input.repository?.visibility ?? "private")),
    input.drive ? runStep(() => steps.createDriveFolder(title)) : null,
  ]);
  const repository = github !== null && "url" in github ? github.url : null;
  const driveFolder = drive !== null && "url" in drive ? drive.url : null;
  const type = input.repository?.type;
  if (repository !== null || driveFolder !== null) {
    const text = textWith({ repository, driveFolder });
    writeFileAtomic(file, repository === null || type === undefined ? text : setRepositoryType(text, repository, type));
  }
  const setup =
    repository === null || type === undefined
      ? null
      : await setUp(() => steps.setUpRepository(projectId, repository, type));
  return { projectId, github, drive, setup };
}

async function setUp(step: () => Promise<NewProjectSetup>): Promise<NewProjectSetup> {
  try {
    return await step();
  } catch (error) {
    if (isEvaError(error)) return { sessionId: null, problems: [error.message] };
    throw error;
  }
}

async function runStep(step: () => Promise<string>): Promise<NewProjectStep> {
  try {
    return { url: await step() };
  } catch (error) {
    if (isEvaError(error)) return { problem: error.message };
    throw error;
  }
}

/**
 * The text of the new `AGENTS.md`. The project file editor writes the front matter, so it checks
 * the values the same way. The Drive link is a line of the body: a new key would be a schema change.
 */
function projectText(
  wallClock: string,
  title: string,
  description: string,
  input: NewProjectInput,
  results: { readonly repository: string | null; readonly driveFolder: string | null },
): string {
  const parts = [
    `# ${title}`,
    description,
    // A list item, so the catalog never reads the link as the description.
    results.driveFolder === null ? "" : `- Google Drive folder: ${results.driveFolder}`,
  ];
  const body = parts.filter((part) => part !== "").join("\n\n");
  return applyProjectDetails(`---\ncreated: ${wallClock}\n---\n\n${body}\n`, {
    title,
    status: input.status,
    tags: input.tags,
    repos: results.repository === null ? [] : [results.repository],
  });
}

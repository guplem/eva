/**
 * Creates a new project from the form: its folder, its `AGENTS.md`, and, when asked, a GitHub
 * repository and a Google Drive folder. The local folder comes first, so a failed step loses
 * nothing: the project stays, and the result says which step failed and why.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import type { ProjectStatus } from "./project-catalog.ts";
import { applyProjectDetails } from "./project-file.ts";
import { formatProjectId, projectSlug } from "./project-id.ts";

export interface NewProjectInput {
  /** The title. The folder name takes its slug. */
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly tags: readonly string[];
  /** True creates a private GitHub repository named after the slug. */
  readonly github: boolean;
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
  readonly createRepository: (name: string, description: string) => Promise<string>;
  /** Gives the link of the new folder. */
  readonly createDriveFolder: (name: string) => Promise<string>;
}

export type NewProjectStep = { readonly url: string } | { readonly problem: string };

export interface NewProjectResult {
  readonly projectId: string;
  /** Null when the form did not ask for the step. */
  readonly github: NewProjectStep | null;
  readonly drive: NewProjectStep | null;
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
    input.github ? runStep(() => steps.createRepository(projectSlug(title), oneLine)) : null,
    input.drive ? runStep(() => steps.createDriveFolder(title)) : null,
  ]);
  const repository = github !== null && "url" in github ? github.url : null;
  const driveFolder = drive !== null && "url" in drive ? drive.url : null;
  if (repository !== null || driveFolder !== null) writeFileAtomic(file, textWith({ repository, driveFolder }));
  return { projectId, github, drive };
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

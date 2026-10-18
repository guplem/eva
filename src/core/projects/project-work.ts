/**
 * The projects of a running Eva: Project chats, the clone that each one gets, project work that
 * reports to an Assistant chat, the setup report of a project's repositories, and the edits of
 * its `AGENTS.md`.
 */
import type { EngineName, ModelAlias } from "../../shared/engine-port.ts";
import { join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { evaRepository } from "../../shared/version.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import {
  createClone,
  describeClone,
  githubSlug,
  isCleanFolder,
  listClones,
  type Clone,
  type CloneDetails,
  type CloneOriginStore,
} from "./clones.ts";
import type { Project } from "./project-catalog.ts";
import {
  applyProjectDetails,
  checkProjectFile,
  fileVersion,
  matchFileStyle,
  projectFileOf,
  type ProjectDetails,
  type ProjectFile,
} from "./project-file.ts";
import { ghApiRequest, readRepositoryFacts, type GithubRequest } from "./repository-facts.ts";
import { evaluateSetup, unreadableReport, type RepositoryFacts, type SetupReport } from "./repository-setup.ts";

export interface NewChatInput {
  readonly source: SessionRecord["source"];
  readonly model: ModelAlias;
  /** The engine of this chat; without one, the configured default. */
  readonly engine?: EngineName;
  readonly telegramTopicId?: number;
  readonly title?: string;
}

export interface NewProjectChatInput extends NewChatInput {
  readonly projectId: string;
  readonly cloneName?: string;
}

export interface ProjectWorkInput {
  readonly projectId: string;
  readonly request: string;
  /** The Assistant chat that receives the result, or null. */
  readonly reportToSessionId: string | null;
}

export interface ProjectWorkOptions {
  readonly sessions: SessionManager;
  /** The projects of the vault now. */
  readonly projects: () => Project[];
  readonly defaultEngine: EngineName;
  readonly runner: ProcessRunner;
  /** The environment of Eva's own git and `gh` commands. */
  readonly gitEnvironment: Record<string, string>;
  readonly cloneOrigins: CloneOriginStore;
  /** Runs a task that nobody awaits, and logs its failure (lesson 50). */
  readonly inBackground: (what: string, task: () => Promise<unknown>) => void;
  /** One GET of the GitHub API, for the setup report. Default: `gh api`. */
  readonly githubRequest?: GithubRequest;
}

/** The number of characters of a project answer that the report to the Assistant chat keeps. */
const reportTextLimit = 3_000;

export class ProjectWork {
  private readonly options: ProjectWorkOptions;
  /** Clones that project work has taken, so two chats never get the same working tree (lesson 49). */
  private readonly reservedClones: Set<string>;
  /** The last clone choice of each project, so the next choice waits for it (lesson 49). */
  private readonly cloneChoices: Map<string, Promise<unknown>>;

  constructor(options: ProjectWorkOptions) {
    this.reservedClones = new Set();
    this.cloneChoices = new Map();
    this.options = options;
  }

  /** A Project chat in the named clone, or in a free clone, or in a new clone. */
  async createSession(input: NewProjectChatInput): Promise<SessionRecord> {
    const project = this.project(input.projectId);
    const clone =
      input.cloneName === undefined
        ? await this.oneCloneChoiceAtATime(project, () => this.freeOrNewClone(project))
        : listClones(project.path).find((candidate) => candidate.name === input.cloneName);
    if (clone === undefined)
      throw new EvaError("project_not_found", `Project ${project.id} has no clone ${input.cloneName ?? ""}.`);
    return this.options.sessions.createSession({
      mode: "project",
      engine: input.engine ?? this.options.defaultEngine,
      model: input.model,
      startFolder: clone.path,
      source: input.source,
      projectId: project.id,
      clone: clone.name,
    });
  }

  /**
   * Gives work to a project: a Project chat in a free clone runs the request, and its
   * result goes back to the Assistant chat that asked, as a new message.
   */
  async start(input: ProjectWorkInput): Promise<SessionRecord> {
    const project = this.project(input.projectId);
    const sessions = this.options.sessions;
    // The reservation happens inside the choice, so a second work cannot pick the same clone.
    const clone = await this.oneCloneChoiceAtATime(project, async () => {
      const chosen = await this.freeOrNewClone(project);
      this.reservedClones.add(chosen.path);
      return chosen;
    });
    const session = sessions.createSession({
      mode: "project",
      engine: this.options.defaultEngine,
      model: "default",
      startFolder: clone.path,
      source: "cli",
      projectId: project.id,
      clone: clone.name,
    });
    this.options.inBackground("Project work", async () => {
      try {
        await sessions.send(session.id, input.request);
      } finally {
        this.reservedClones.delete(clone.path);
      }
      if (input.reportToSessionId === null) return;
      const last = sessions.get(session.id).turns.at(-1);
      const result = last?.failure === null ? last.answerText : `It failed: ${last?.failure ?? "no answer"}`;
      const details = await describeClone(clone, this.options.runner, this.options.gitEnvironment);
      const place = [
        `clone ${clone.name}`,
        ...(details.branch === null ? [] : [`branch ${details.branch}`]),
        ...(details.pullRequest === null ? [] : [`pull request #${String(details.pullRequest)}`]),
      ].join(", ");
      await sessions.send(
        input.reportToSessionId,
        `[Project work finished: ${project.id}, ${place}, chat ${session.id}]\n\n${capReportText(result)}`,
      );
    });
    return session;
  }

  /**
   * The setup report of each repository of a project, judged against Eva's own repository.
   * A repository that Eva cannot read gets a report with only the reason.
   */
  async repositorySetup(projectId: string): Promise<SetupReport[]> {
    const project = this.project(projectId);
    if (project.frontMatter.repos.length === 0) return [];
    const request = this.options.githubRequest ?? ghApiRequest(this.options.runner, this.options.gitEnvironment);
    const read = async (slug: string): Promise<RepositoryFacts | string> => {
      try {
        return await readRepositoryFacts(slug, request);
      } catch (error) {
        if (isEvaError(error, "github_failed")) return error.message;
        throw error;
      }
    };
    let reference = await read(evaRepository);
    // A gap in the reference would turn into false greens, such as "has every standard label".
    if (
      typeof reference !== "string" &&
      (reference.files === null || reference.labels === null || !Array.isArray(reference.allowRules))
    ) {
      reference = `Eva could not read all of her reference repository, ${evaRepository}. Try again later.`;
    }
    const readReference = reference;
    return Promise.all(
      project.frontMatter.repos.map(async (url) => {
        const slug = githubSlug(url);
        if (slug === null) return unreadableReport(url, null, "Only a repository on GitHub has a setup report.");
        if (typeof readReference === "string") return unreadableReport(url, slug, readReference);
        const target = await read(slug);
        if (typeof target === "string") return unreadableReport(url, slug, target);
        if (target.isArchived)
          return unreadableReport(url, slug, "This repository is archived, so it takes no changes.");
        return evaluateSetup(readReference, target);
      }),
    );
  }

  /** The clones of a project, with their branch and pull request. */
  async clones(projectId: string): Promise<CloneDetails[]> {
    const project = this.project(projectId);
    return Promise.all(
      listClones(project.path).map((clone) => describeClone(clone, this.options.runner, this.options.gitEnvironment)),
    );
  }

  /** Clones a project's repository into its next free folder (the "New clone" button). */
  async newClone(projectId: string, repositoryUrl?: string): Promise<Clone> {
    const project = this.project(projectId);
    return this.oneCloneChoiceAtATime(project, () => this.cloneInto(project, repositoryUrl));
  }

  /** A project's `AGENTS.md` with its version, for the details editor. */
  projectFile(projectId: string): ProjectFile {
    return projectFileOf(projectText(this.projectFilePath(projectId), projectId));
  }

  /** Sets the status, tags, repositories and title. The idle sweep commits the change. */
  saveProjectDetails(projectId: string, version: string, details: ProjectDetails): ProjectFile {
    return this.changeProjectFile(projectId, version, (text) => applyProjectDetails(text, details));
  }

  /** Replaces the whole `AGENTS.md`, with the line endings of the file on disk. */
  saveProjectFile(projectId: string, version: string, edited: string): ProjectFile {
    return this.changeProjectFile(projectId, version, (text) => matchFileStyle(edited, text));
  }

  /**
   * Reads, checks the version, changes and writes in one synchronous step, so no other save
   * can come between the check and the write.
   */
  private changeProjectFile(projectId: string, version: string, change: (text: string) => string): ProjectFile {
    const path = this.projectFilePath(projectId);
    const before = projectText(path, projectId);
    if (fileVersion(before) !== version) {
      throw new EvaError("project_changed", "The project file changed since you opened it. Load it again.");
    }
    const text = change(before);
    checkProjectFile(text);
    if (text !== before) writeFileAtomic(path, text);
    return projectFileOf(text);
  }

  /** The path comes from the project list, never from the id, so an id cannot point outside it. */
  private projectFilePath(projectId: string): string {
    return join(this.project(projectId).path, "AGENTS.md");
  }

  private project(projectId: string): Project {
    const project = this.options.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${projectId} in the vault.`);
    return project;
  }

  private async cloneInto(project: Project, repositoryUrl?: string): Promise<Clone> {
    const url = repositoryUrl ?? project.frontMatter.repos[0];
    if (url === undefined)
      throw new EvaError("project_not_found", `Project ${project.id} lists no repository to clone.`);
    return createClone({
      projectPath: project.path,
      repositoryUrl: url,
      runner: this.options.runner,
      environment: this.options.gitEnvironment,
      origins: this.options.cloneOrigins,
    });
  }

  /** Call it only inside `oneCloneChoiceAtATime`, or two callers can get the same clone. */
  private async freeOrNewClone(project: Project): Promise<Clone> {
    // A clone with a record goes first: one with none asks a trust question, and work may run with nobody to answer it.
    const clones = listClones(project.path);
    const recorded = clones.filter((clone) => {
      const kind = this.options.cloneOrigins.origin(clone.path)?.kind;
      return kind === "cloned" || kind === "answered";
    });
    const sessions = this.options.sessions;
    for (const clone of [...recorded, ...clones.filter((clone) => !recorded.includes(clone))]) {
      const busy =
        this.reservedClones.has(clone.path) ||
        sessions.list().some((session) => session.startFolder === clone.path && sessions.isBusy(session.id));
      if (!busy && (await isCleanFolder(clone.path, this.options.runner, this.options.gitEnvironment))) return clone;
    }
    return this.cloneInto(project);
  }

  /**
   * Runs one clone choice of a project after the previous one ends. A choice awaits git, so
   * without this chain two callers could pick the same free clone or the same new folder (lesson 49).
   */
  private oneCloneChoiceAtATime<Chosen>(project: Project, choose: () => Promise<Chosen>): Promise<Chosen> {
    const previous = this.cloneChoices.get(project.path) ?? Promise.resolve();
    const choice = previous.then(choose, choose);
    this.cloneChoices.set(
      project.path,
      choice.catch(() => undefined),
    );
    return choice;
  }
}

/** Keeps the end of a long project answer: the end usually holds the result, and a phone chat stays short. */
function capReportText(text: string): string {
  if (text.length <= reportTextLimit) return text;
  return `(The answer is longer. The full answer is in the project chat.)\n\n…${text.slice(-reportTextLimit)}`;
}

function projectText(path: string, projectId: string): string {
  const text = readTextTolerant(path);
  if (text === null) throw new EvaError("project_not_found", `Eva cannot read the AGENTS.md of ${projectId}.`);
  return text;
}

/**
 * The projects of a running Eva: Project chats, the clone that each one gets, project work that
 * reports to an Assistant chat, the setup report of a project's repositories, and the edits of
 * its `AGENTS.md`.
 */
import type { EffortLevel, EngineName, ModelAlias } from "../../shared/engine-port.ts";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import { cheapestModel, type ModelCalls } from "../model-calls/model-calls.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { evaRepository } from "../../shared/version.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import {
  cloneRepository,
  countChanges,
  createClone,
  describeRepository,
  githubSlug,
  listClones,
  listRepositories,
  readGitState,
  repositoryName,
  type Clone,
  type CloneDetails,
  type CloneOriginStore,
  type CloneRepository,
  type RepositoryBranch,
} from "./clones.ts";
import {
  commitAndPush,
  describeChanges,
  fallbackCommitMessage,
  fetchClone,
  fetchDefaultBranch,
  hasLocalWork,
  pullClone,
  readSyncState,
  readyToPush,
  switchToBranch,
} from "./clone-sync.ts";
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
  /** Without one, the engine's own level. */
  readonly effort?: EffortLevel;
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
  /** Writes a commit message when the person leaves the note empty. Without it, a plain message. */
  readonly modelCalls?: Pick<ModelCalls, "ask">;
  readonly logger?: Logger;
}

/** The clones after a fetch or a pull, and a reason for each clone that failed. */
export interface CloneFetch {
  readonly clones: CloneDetails[];
  readonly problems: string[];
}

const commitMessagePrompt = [
  "You write git commit messages. Answer with the message only, with no quotes and no code fence.",
  "Write one subject line of at most 72 characters, in the imperative mood, such as: Add the login page.",
  "Add a short body after a blank line only when the subject cannot say why.",
  "Follow the style and the language of the recent commits of the repository.",
].join("\n");

/** The number of characters of a project answer that the report to the Assistant chat keeps. */
const reportTextLimit = 3_000;

const finishedPrompt = [
  "You read a chat between a person and a coding agent, and judge whether its task has finished.",
  "A task has finished when the agent did what the person asked, or the person dropped it, and nothing is left to do.",
  "A task has not finished when the agent asked a question, waits for the person, or listed steps that are still open.",
  "Answer with FINISHED or NOT FINISHED only.",
].join("\n");

/** The last turns of a chat that the finished check reads, and the characters of each text it keeps. */
const finishedTurnLimit = 6;
const finishedTextLimit = 2_000;

export class ProjectWork {
  private readonly options: ProjectWorkOptions;
  /** Clones that project work has taken, so two chats never get the same working tree (lesson 49). */
  private readonly reservedClones: Set<string>;
  /** Repositories with a pull or a push running, so two never share one index. */
  private readonly syncingRepositories: Set<string>;
  /** The last clone choice of each project, so the next choice waits for it (lesson 49). */
  private readonly cloneChoices: Map<string, Promise<unknown>>;
  /** The finished check of each chat tree, by its turn count, so an unchanged chat costs one model call. */
  private readonly finishedChecks: Map<string, { readonly turns: number; readonly finished: boolean }>;

  constructor(options: ProjectWorkOptions) {
    this.reservedClones = new Set();
    this.syncingRepositories = new Set();
    this.cloneChoices = new Map();
    this.finishedChecks = new Map();
    this.options = options;
  }

  /** A Project chat in the named clone, or in a free clone, or in a new clone. */
  async createSession(input: NewProjectChatInput): Promise<SessionRecord> {
    const project = this.project(input.projectId);
    const inClone = (clone: Clone | undefined): SessionRecord => {
      if (clone === undefined)
        throw new EvaError("project_not_found", `Project ${project.id} has no clone ${input.cloneName ?? ""}.`);
      // A clone has one chat tree (issue 521): a second open chat would share its branches.
      if (this.chatsIn(clone).some((chat) => !chat.closed))
        throw new EvaError("session_busy", `Clone ${clone.name} already has an open chat. Start a new chat instead.`);
      return this.options.sessions.createSession({
        mode: "project",
        engine: input.engine ?? this.options.defaultEngine,
        model: input.model,
        ...(input.effort === undefined ? {} : { effort: input.effort }),
        startFolder: clone.path,
        source: input.source,
        projectId: project.id,
        clone: clone.name,
      });
    };
    if (input.cloneName !== undefined) {
      const name = input.cloneName;
      // Inside the clone choice, so a reuse cannot reset the clone under the new chat.
      return this.oneCloneChoiceAtATime(project, async () => {
        const clone = listClones(project.path).find((candidate) => candidate.name === name);
        if (clone !== undefined && this.reservedClones.has(clone.path))
          throw new EvaError("session_busy", `Eva is preparing clone ${clone.name}. Try again in a moment.`);
        // A clone with only closed chats gets the same reset as a free one, so no new chat starts on an old branch.
        const chats = clone === undefined ? [] : this.chatsIn(clone);
        if (clone === undefined || chats.length === 0 || chats.some((chat) => !chat.closed)) return inClone(clone);
        const ready = await this.reuse(project, clone);
        if (ready === null)
          throw new EvaError(
            "session_busy",
            `Eva could not prepare clone ${clone.name} for a new chat. Start a new chat instead.`,
          );
        return inClone(ready);
      });
    }
    // The chat exists before the next choice starts, so its creation already keeps the clone.
    return this.oneCloneChoiceAtATime(project, async () => inClone(await this.freeOrNewClone(project)));
  }

  /**
   * The git state of each repository of a Project chat's clone folder, for a chat summary, or null when
   * git fails for each one. The clone folder itself is no repository: git there would read the vault.
   */
  async gitState(folder: string): Promise<string | null> {
    const states = await Promise.all(
      listRepositories(folder).map(async (repository) => {
        const state = await readGitState(repository.path, this.options.runner, this.options.gitEnvironment);
        return state === null ? null : `Repository ${repository.name}:\n${state}`;
      }),
    );
    const known = states.filter((state) => state !== null);
    return known.length === 0 ? null : known.join("\n\n");
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
    // Before the work starts, so a front end can show the Project chat with its first message.
    if (input.reportToSessionId !== null)
      sessions.announceProjectWork(input.reportToSessionId, {
        projectId: project.id,
        projectSessionId: session.id,
        request: input.request,
      });
    this.options.inBackground("Project work", async () => {
      try {
        await sessions.send(session.id, input.request);
      } finally {
        this.reservedClones.delete(clone.path);
      }
      if (input.reportToSessionId === null) return;
      const reportTo = input.reportToSessionId;
      // The person may delete either chat while the work runs: the Project chat then keeps the result.
      const exists = (id: string): boolean => sessions.list().some((candidate) => candidate.id === id);
      const last = exists(session.id) ? sessions.get(session.id).turns.at(-1) : undefined;
      const result = last?.failure === null ? last.answerText : `It failed: ${last?.failure ?? "no answer"}`;
      const details = await Promise.all(
        listClones(project.path)
          .find((candidate) => candidate.path === clone.path)
          ?.repositories.map((repository) =>
            describeRepository(repository, this.options.runner, this.options.gitEnvironment),
          ) ?? [],
      );
      if (!exists(reportTo)) {
        this.options.logger?.log("info", "The project work ended, but its asking chat is gone.", {
          projectChat: session.id,
        });
        return;
      }
      const place = [`clone ${clone.name}`, ...details.map(repositoryPlace)].join("; ");
      await sessions.send(
        reportTo,
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

  /** The clones of a project, with the branch, pull request, changes and sync of each repository. */
  async clones(projectId: string): Promise<CloneDetails[]> {
    const project = this.project(projectId);
    return Promise.all(listClones(project.path).map((clone) => this.describe(clone)));
  }

  private async describe(clone: Clone): Promise<CloneDetails> {
    const { runner, gitEnvironment } = this.options;
    const repositories = await Promise.all(
      clone.repositories.map(async (repository) => {
        const [details, changes, sync] = await Promise.all([
          describeRepository(repository, runner, gitEnvironment),
          countChanges(repository, runner, gitEnvironment),
          readSyncState(repository, runner, gitEnvironment),
        ]);
        return { ...details, ...sync, changes };
      }),
    );
    return { name: clone.name, path: clone.path, index: clone.index, repositories };
  }

  /** Fetches each repository, then gives the clones with fresh counts and the fetches that failed. */
  async fetchClones(projectId: string): Promise<CloneFetch> {
    const project = this.project(projectId);
    const { runner, gitEnvironment } = this.options;
    const reasons = await Promise.all(
      listClones(project.path).flatMap((clone) =>
        clone.repositories.map(async (repository) => {
          const reason = await fetchClone(repository, runner, gitEnvironment);
          return reason === null ? null : `${clone.name}/${repository.name}: ${reason}`;
        }),
      ),
    );
    return { clones: await this.clones(projectId), problems: reasons.filter((reason) => reason !== null) };
  }

  /** A fast-forward pull of one repository of a clone. */
  async pullClone(projectId: string, cloneName: string, repositoryName: string): Promise<void> {
    const { repository } = this.idleRepository(projectId, cloneName, repositoryName);
    await this.oneSyncAtATime(repository, () =>
      pullClone(repository, this.options.runner, this.options.gitEnvironment),
    );
  }

  /** Pulls each repository that is behind and has no running chat. One failure does not stop the others. */
  async pullClones(projectId: string): Promise<CloneFetch> {
    const project = this.project(projectId);
    const { runner, gitEnvironment } = this.options;
    const reasons = await Promise.all(
      (await this.clones(projectId)).flatMap((clone) =>
        clone.repositories
          .filter((repository) => (repository.behind ?? 0) > 0)
          .map(async (repository) => {
            try {
              this.idleRepository(project.id, clone.name, repository.name);
              await this.oneSyncAtATime(repository, () => pullClone(repository, runner, gitEnvironment));
              return null;
            } catch (error) {
              if (!isEvaError(error)) throw error;
              return error.message;
            }
          }),
      ),
    );
    return { clones: await this.clones(projectId), problems: reasons.filter((reason) => reason !== null) };
  }

  /**
   * Commits every change of one repository of a clone and pushes its branch. With an empty note, a
   * model writes the message from the diff, and a plain message stands in when no model answers.
   */
  async pushClone(
    projectId: string,
    cloneName: string,
    repositoryName: string,
    note: string,
  ): Promise<{ readonly message: string }> {
    const { repository } = this.idleRepository(projectId, cloneName, repositoryName);
    const { runner, gitEnvironment } = this.options;
    return this.oneSyncAtATime(repository, async () => {
      const trimmed = note.trim();
      // A repository that Eva cannot push safely fails here, before a model call that would be lost.
      const { files } = await readyToPush(repository, runner, gitEnvironment);
      const message = trimmed.length > 0 || files.length === 0 ? trimmed : await this.commitMessage(repository);
      // The model call takes seconds, and a chat may start a turn meanwhile.
      this.idleRepository(projectId, cloneName, repositoryName);
      await commitAndPush(repository, message, runner, gitEnvironment);
      return { message };
    });
  }

  private async commitMessage(repository: CloneRepository): Promise<string> {
    const changes = await describeChanges(repository, this.options.runner, this.options.gitEnvironment);
    const fallback = fallbackCommitMessage(changes.files);
    const modelCalls = this.options.modelCalls;
    if (modelCalls === undefined) return fallback;
    const engine = this.options.defaultEngine;
    const result = await modelCalls.ask({
      engine,
      model: cheapestModel(engine, "default"),
      systemPrompt: commitMessagePrompt,
      prompt: "Write the commit message for these changes.",
      context: {
        files: changes.files.join("\n"),
        diff: changes.diff,
        "recent-commits": changes.recentSubjects.join("\n"),
      },
    });
    if (!result.ok) {
      this.options.logger?.log("warn", `A commit message failed: ${result.reason}`);
      return fallback;
    }
    return cleanCommitMessage(result.text) ?? fallback;
  }

  private async oneSyncAtATime<Result>(repository: CloneRepository, work: () => Promise<Result>): Promise<Result> {
    if (this.syncingRepositories.has(repository.path))
      throw new EvaError("session_busy", `Eva already pulls or pushes ${repository.name}. Try again when it ends.`);
    this.syncingRepositories.add(repository.path);
    try {
      return await work();
    } finally {
      this.syncingRepositories.delete(repository.path);
    }
  }

  /** True while Eva pulls or pushes any repository of the clone. */
  private isSyncing(clone: Clone): boolean {
    return clone.repositories.some((repository) => this.syncingRepositories.has(repository.path));
  }

  /** A repository of a clone with no running chat: git must not change files under a turn. */
  private idleRepository(
    projectId: string,
    cloneName: string,
    repositoryName: string,
  ): { readonly clone: Clone; readonly repository: CloneRepository } {
    const project = this.project(projectId);
    const clone = listClones(project.path).find((candidate) => candidate.name === cloneName);
    if (clone === undefined)
      throw new EvaError("project_not_found", `Project ${project.id} has no clone ${cloneName}.`);
    // The path comes from the clone's list, never from the name, so a name cannot point outside it.
    const repository = clone.repositories.find((candidate) => candidate.name === repositoryName);
    if (repository === undefined)
      throw new EvaError("project_not_found", `Clone ${clone.name} has no repository ${repositoryName}.`);
    const sessions = this.options.sessions;
    if (this.reservedClones.has(clone.path) || this.chatsIn(clone).some((chat) => sessions.isBusy(chat.id)))
      throw new EvaError("session_busy", `Eva is working in ${clone.name}. Try again when she finishes.`);
    return { clone, repository };
  }

  /** The chats of a clone, closed ones and forks too. */
  private chatsIn(clone: Clone): SessionRecord[] {
    return this.options.sessions.list().filter((session) => session.startFolder === clone.path);
  }

  /** Clones every repository of a project into its next free clone folder (the "New clone" button). */
  async newClone(projectId: string): Promise<Clone> {
    const project = this.project(projectId);
    return this.oneCloneChoiceAtATime(project, () => this.cloneInto(project));
  }

  /**
   * Deletes a clone folder and its chats with their forks, and returns the ids of the deleted chats.
   * A chat whose folder is gone could not run again. The engine keeps its own transcripts.
   */
  async deleteClone(projectId: string, cloneName: string): Promise<{ deletedChats: string[] }> {
    const project = this.project(projectId);
    // Inside the clone choice, so a new chat cannot take the clone while it goes.
    return this.oneCloneChoiceAtATime(project, () => {
      // The path comes from the clone list, never from the name, so a name cannot point outside it.
      const clone = listClones(project.path).find((candidate) => candidate.name === cloneName);
      if (clone === undefined)
        throw new EvaError("project_not_found", `Project ${project.id} has no clone ${cloneName}.`);
      const sessions = this.options.sessions;
      const chats = this.chatsIn(clone);
      // An engine that runs in the folder would lose its files, and Windows refuses to delete a folder in use.
      if (
        this.reservedClones.has(clone.path) ||
        this.isSyncing(clone) ||
        chats.some((chat) => sessions.isActive(chat.id))
      )
        throw new EvaError("session_busy", `Eva is still working in ${clone.name}. Stop her chats there first.`);
      const deletedChats: string[] = [];
      for (const chat of chats) {
        // A fork goes with its parent, so it can be gone already.
        if (!deletedChats.includes(chat.id)) deletedChats.push(...sessions.delete(chat.id));
      }
      // Retries, because a virus scanner or an indexer on Windows can hold a file for a moment.
      rmSync(clone.path, { recursive: true, force: true, maxRetries: 5 });
      return Promise.resolve({ deletedChats });
    });
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

  private async cloneInto(project: Project): Promise<Clone> {
    if (project.frontMatter.repos.length === 0)
      throw new EvaError("project_not_found", `Project ${project.id} lists no repository to clone.`);
    return createClone({
      projectPath: project.path,
      repositoryUrls: project.frontMatter.repos,
      runner: this.options.runner,
      environment: this.options.gitEnvironment,
      origins: this.options.cloneOrigins,
    });
  }

  /** Call it only inside `oneCloneChoiceAtATime`, or two callers can get the same clone. */
  private async freeOrNewClone(project: Project): Promise<Clone> {
    // A clone with a record of each repository goes first: one with none asks a trust question,
    // and work may run with nobody to answer it.
    const clones = listClones(project.path);
    const recorded = clones.filter((clone) =>
      clone.repositories.every((repository) => {
        const kind = this.options.cloneOrigins.origin(repository.path)?.kind;
        return kind === "cloned" || kind === "answered";
      }),
    );
    for (const clone of [...recorded, ...clones.filter((clone) => !recorded.includes(clone))]) {
      const reused = await this.reuse(project, clone);
      if (reused !== null) return reused;
    }
    return this.cloneInto(project);
  }

  /**
   * Prepares a clone for a new chat, or gives null when the clone is not free (issue 521). A clone is
   * free when no work of it is only on this computer, nothing runs in it, and its chat has finished.
   * Eva then closes that chat, puts each repository on its default branch, and clones each repository
   * that the project gained since.
   */
  private async reuse(project: Project, clone: Clone): Promise<Clone | null> {
    const sessions = this.options.sessions;
    const isQuiet = (): boolean =>
      !this.isSyncing(clone) && !this.chatsIn(clone).some((chat) => sessions.isActive(chat.id));
    if (this.reservedClones.has(clone.path) || !isQuiet()) return null;
    // From the first check on, so no pull, push or delete runs git in the clone at the same time.
    this.reservedClones.add(clone.path);
    try {
      return await this.prepareForReuse(project, clone, isQuiet);
    } catch (error) {
      // The chat stays as it was, or closed when only the last local step failed. A later choice tries again.
      if (!isEvaError(error)) throw error;
      this.options.logger?.log("warn", `Eva could not prepare ${clone.name} for a new chat: ${error.message}`, {
        project: project.id,
      });
      return null;
    } finally {
      this.reservedClones.delete(clone.path);
    }
  }

  /** Call it only from `reuse`, which reserves the clone. */
  private async prepareForReuse(project: Project, clone: Clone, isQuiet: () => boolean): Promise<Clone | null> {
    const sessions = this.options.sessions;
    const openChats = (): SessionRecord[] => this.chatsIn(clone).filter((chat) => !chat.closed);
    // The ids and turn counts, so a later check sees a new fork or a turn that came and went.
    const stateOf = (chats: readonly SessionRecord[]): string =>
      chats
        .map((chat) => `${chat.id}:${String(chat.turns.length)}`)
        .sort()
        .join(" ");
    if (await this.holdsLocalWork(clone)) return null;
    const open = openChats();
    const before = stateOf(open);
    if (open.length > 0 && !(await this.hasFinished(open))) return null;
    // The network steps go first: when one fails, the chat stays open and nothing changed.
    const { runner, gitEnvironment, cloneOrigins } = this.options;
    const branches = new Map<string, string>();
    for (const repository of clone.repositories)
      branches.set(repository.path, await fetchDefaultBranch(repository, runner, gitEnvironment));
    const present = new Set(clone.repositories.map((repository) => folderKey(repository.name)));
    for (const url of project.frontMatter.repos) {
      if (present.has(folderKey(repositoryName(url)))) continue;
      await cloneRepository(clone.path, url, { runner, environment: gitEnvironment, origins: cloneOrigins });
    }
    const current = listClones(project.path).find((candidate) => candidate.path === clone.path);
    if (current === undefined) return null;
    // The model call and the network take seconds: a turn, a fork or a commit may have come meanwhile.
    if (!isQuiet() || stateOf(openChats()) !== before || (await this.holdsLocalWork(current))) return null;
    for (const chat of open) sessions.close(chat.id);
    for (const repository of clone.repositories) {
      const branch = branches.get(repository.path);
      if (branch !== undefined) await switchToBranch(repository, branch, runner, gitEnvironment);
    }
    return current;
  }

  /**
   * True when the clone holds anything that is not on a remote. A file in the clone folder itself,
   * outside every repository, is in no repository, so it counts too. A file that the operating system
   * writes, such as `desktop.ini`, holds no work.
   */
  private async holdsLocalWork(clone: Clone): Promise<boolean> {
    const repositoryNames = new Set([...clone.repositories.map((repository) => repository.name), ...systemFiles]);
    let names: string[];
    try {
      names = readdirSync(clone.path);
    } catch {
      return true;
    }
    if (names.some((name) => !repositoryNames.has(name) && !repositoryNames.has(folderKey(name)))) return true;
    const { runner, gitEnvironment } = this.options;
    const work = await Promise.all(
      clone.repositories.map((repository) => hasLocalWork(repository, runner, gitEnvironment)),
    );
    return work.some(Boolean);
  }

  /**
   * Asks the cheapest model whether the chats of a clone have finished their task. A chat with no
   * turn has not: the person may be about to write. A failed call counts as not finished, so the
   * chat keeps its clone.
   */
  private async hasFinished(chats: readonly SessionRecord[]): Promise<boolean> {
    const turns = chats.flatMap((chat) => chat.turns);
    if (turns.length === 0) return false;
    const key = chats
      .map((chat) => chat.id)
      .sort()
      .join(" ");
    const cached = this.finishedChecks.get(key);
    if (cached?.turns === turns.length) return cached.finished;
    const modelCalls = this.options.modelCalls;
    if (modelCalls === undefined) return false;
    const engine = chats[0]?.engine ?? this.options.defaultEngine;
    const result = await modelCalls.ask({
      engine,
      model: cheapestModel(engine, chats[0]?.modelAlias ?? "default"),
      systemPrompt: finishedPrompt,
      prompt: "Has the task of this chat finished?",
      context: { chat: chats.map(chatText).join("\n\n") },
    });
    if (!result.ok) {
      this.options.logger?.log("warn", `The finished check of a chat failed: ${result.reason}`);
      return false;
    }
    const finished = /^\W*finished\b/i.test(result.text.trim());
    this.finishedChecks.set(key, { turns: turns.length, finished });
    return finished;
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

/**
 * A model can wrap the message in a code fence or quotes, or add a label. The first line is the
 * subject, and a body may follow it.
 */
function cleanCommitMessage(text: string): string | null {
  const lines = text
    .trim()
    .replace(/^```[\w-]*\s*\n?|\n?```$/g, "")
    .split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().length > 0);
  if (start === -1) return null;
  const subject = (lines[start] ?? "")
    .trim()
    .replace(/^(commit\s+)?(message|subject)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (subject.length === 0) return null;
  const body = lines
    .slice(start + 1)
    .join("\n")
    .trim();
  return body.length === 0 ? subject : `${subject}\n\n${body}`;
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

/** Such as `example-web on branch fix-login with pull request #42`, for the report of project work. */
function repositoryPlace(repository: RepositoryBranch): string {
  return [
    repository.name,
    ...(repository.branch === null ? [] : [`on branch ${repository.branch}`]),
    ...(repository.pullRequest === null ? [] : [`with pull request #${String(repository.pullRequest)}`]),
  ].join(" ");
}

/** The last turns of a chat, for the finished check. The end of a long text usually holds its result. */
function chatText(chat: SessionRecord): string {
  const keepEnd = (text: string): string =>
    text.length <= finishedTextLimit ? text : `…${text.slice(-finishedTextLimit)}`;
  return chat.turns
    .slice(-finishedTurnLimit)
    .map((turn) => {
      const answer = turn.failure === null ? turn.answerText : `(The turn failed: ${turn.failure})`;
      return `Person: ${keepEnd(turn.userText)}\nAgent: ${keepEnd(answer)}`;
    })
    .join("\n\n");
}

/** Files that the operating system writes in a folder that the person opened. */
const systemFiles = ["desktop.ini", "thumbs.db", ".DS_Store"];

/** Windows folder names ignore case, so a repository folder matches its URL name in any case there. */
function folderKey(name: string): string {
  return process.platform === "win32" ? name.toLowerCase() : name;
}

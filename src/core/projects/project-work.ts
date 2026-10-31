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
import { chatKind } from "../../shared/chat-kind.ts";
import { cheapestModel, type ModelCalls } from "../model-calls/model-calls.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { ChatSummarizer } from "../sessions/chat-summary.ts";
import type { HistoryPoint, RetryFiles, SessionManager } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";
import { copyGivenFiles, mentionsFolderName, withBaseNames } from "./clone-files.ts";
import { copySnapshot, deleteSnapshots, restoreSnapshot } from "./clone-snapshots.ts";
import {
  cloneRepository,
  countChanges,
  createClone,
  describeRepository,
  githubSlug,
  listClones,
  listRepositories,
  readGitState,
  type Clone,
  type CloneDetails,
  type CloneOriginStore,
  type CloneRepository,
  type RepositoryBranch,
} from "./clones.ts";
import { repositoryName } from "./repository-name.ts";
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
import type { NewProjectSetup } from "./new-project.ts";
import type { Project } from "./project-catalog.ts";
import {
  applyProjectDetails,
  checkProjectFile,
  fileVersion,
  matchFileStyle,
  projectFileOf,
  setRepositoryType,
  type ProjectDetails,
  type ProjectFile,
} from "./project-file.ts";
import { ghApiRequest, readRepositoryFacts, type GithubRequest } from "./repository-facts.ts";
import { ghApiWrite, runDirectFixes, type GithubWrite } from "./repository-fixes.ts";
import {
  chatRequest,
  missesFacts,
  unreadableReport,
  type RepositoryFacts,
  type SetupReport,
} from "./repository-setup.ts";
import { repositoryTypeOf, type RepositoryTypeName } from "./repository-types.ts";
import { manifestPath } from "../widgets/widget-contract.ts";

export interface NewChatInput {
  readonly source: SessionRecord["source"];
  /** Without one, the settings' model for new chats. */
  readonly model?: ModelAlias;
  /** Without one, the settings' effort for new chats. */
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

/** Where a fork of a Project chat runs, and from which files (issue 523). */
export type ForkFiles = "snapshot-clone" | "clean-clone" | "same-clone";

/** What a retry of a Project chat does with the files (issue 523). */
export type RetryChoice = RetryFiles | "new-clone";

/** A new branch of a chat, and a note for the person when it could not keep its history, or null. */
export interface BranchResult {
  readonly session: SessionRecord;
  readonly notice: string | null;
}

export interface ProjectWorkOptions {
  readonly sessions: SessionManager;
  /** The environment of the engines' turns, which names their config folders. */
  readonly engineEnvironment?: Readonly<Record<string, string>>;
  /** Writes a summary when a chat that moves to another clone cannot take its history along. */
  readonly summarizer?: Pick<ChatSummarizer, "summarize">;
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
  /** One call of the GitHub API that changes a repository, for its direct fixes. Default: `gh api`. */
  readonly githubWrite?: GithubWrite;
  /** Writes a commit message when the person leaves the note empty. Without it, a plain message. */
  readonly modelCalls?: Pick<ModelCalls, "ask">;
  readonly logger?: Logger;
}

/** What a run of direct fixes did. */
export interface RepositoryFixResult {
  /** The labels of the items that Eva fixed. */
  readonly fixed: readonly string[];
  /** One sentence for each direct fix that failed. */
  readonly problems: readonly string[];
  /** One line for each fix that is not on the branch yet, such as a pull request that waits for CI. */
  readonly notes: readonly string[];
  /** The request for a chat: the items that need one, and the failed direct fixes. Null: none. */
  readonly chatRequest: string | null;
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

/** The end of the request of a new repository's setup chat: the standard has agents merge their own work. */
const setupChatEnd =
  "Turn on auto-merge for the pull request, so that it merges itself once its checks pass. Fix each check that fails.";

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
    if (project.frontMatter.type === "specialist") {
      if (input.cloneName !== undefined) throw noClones();
      return this.specialistChat(project, input);
    }
    const inClone = (clone: Clone | undefined): SessionRecord => {
      if (clone === undefined)
        throw new EvaError("project_not_found", `Project ${project.id} has no clone ${input.cloneName ?? ""}.`);
      // A clone has one chat tree (issue 521): a second open chat would share its branches.
      if (this.chatsIn(clone).some((chat) => !chat.closed))
        throw new EvaError("session_busy", `Clone ${clone.name} already has an open chat. Start a new chat instead.`);
      return this.options.sessions.createSession({
        mode: "project",
        engine: input.engine ?? this.options.defaultEngine,
        ...(input.model === undefined ? {} : { model: input.model }),
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
   * A chat in the folder of a specialist (#703). It has no clone: it saves its work in the vault.
   * Only the vault reaches the person's other machines, so a specialist elsewhere gets no chat.
   */
  private specialistChat(project: Project, input: NewChatInput & { reportsTo?: string }): SessionRecord {
    if (project.vaultFolder === null)
      throw new EvaError(
        "project_invalid",
        `${project.title} is outside the vault, so Eva cannot sync it. Move it to the vault's Projects folder.`,
      );
    return this.options.sessions.createSession({
      mode: "project",
      engine: input.engine ?? this.options.defaultEngine,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      startFolder: project.path,
      source: input.source,
      projectId: project.id,
      ...(input.reportsTo === undefined ? {} : { reportsTo: input.reportsTo }),
    });
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
   * A fork of a chat at one answer (issue 523). In the same clone it is a branch of the chat. In a new
   * clone it starts with the files of that answer, or on the default branch, and goes on from the answer.
   */
  async fork(sessionId: string, atMessageId: string, files: ForkFiles = "same-clone"): Promise<BranchResult> {
    const sessions = this.options.sessions;
    const from = sessions.get(sessionId);
    if (chatKind(from) === "specialist" && files !== "same-clone") throw noClones();
    if (from.mode !== "project" || files === "same-clone")
      return { session: sessions.fork(sessionId, atMessageId), notice: null };
    const turns = sessions.branchTurns(sessionId);
    const end = turns.findIndex((turn) => turn.lastMessageId === atMessageId);
    // The fork goes on from the engine session that holds the answer: this chat's own, or where a moved turn ran.
    if (end === -1 || !from.turns.some((turn) => turn.lastMessageId === atMessageId))
      throw new EvaError("session_not_found", `Session ${sessionId} has no answer ${atMessageId}.`);
    return this.branchInNewClone({
      from,
      point: sessions.historyPointAt(sessionId, atMessageId),
      snapshot: files === "snapshot-clone" ? sessions.endSnapshotAt(sessionId, atMessageId) : null,
      history: turns.slice(0, end + 1),
      retryTurn: null,
    });
  }

  /**
   * A retry of a turn (issue 523): it undoes the turn's files, keeps them, or runs in a new clone with
   * the files from before the turn. A new clone never starts clean: the retried message needs the earlier work.
   */
  async retry(sessionId: string, turnIndex: number, files: RetryChoice = "keep"): Promise<BranchResult> {
    const sessions = this.options.sessions;
    const from = sessions.get(sessionId);
    if (chatKind(from) === "specialist" && files === "new-clone") throw noClones();
    if (from.mode !== "project" || files !== "new-clone")
      return {
        session: await sessions.retry(sessionId, turnIndex, files === "new-clone" ? "keep" : files),
        notice: null,
      };
    const point = sessions.retryPoint(sessionId, turnIndex);
    const turn = from.turns[turnIndex];
    if (turn === undefined)
      throw new EvaError("session_not_found", `Session ${sessionId} has no turn ${String(turnIndex)}.`);
    const turns = sessions.branchTurns(sessionId);
    return this.branchInNewClone({
      from,
      point,
      snapshot: sessions.startSnapshotOf(from, turnIndex),
      history: turns.slice(0, turns.length - (from.turns.length - turnIndex)),
      retryTurn: turn,
    });
  }

  /**
   * Makes a chat in a new clone that goes on from a point of another chat. The clone gets the files of
   * the snapshot, or is a free or new clone with no snapshot. When the engine cannot take the history
   * along, the chat starts from a summary that the person reads first.
   */
  private async branchInNewClone(input: {
    readonly from: SessionRecord;
    readonly point: HistoryPoint | null;
    readonly snapshot: string | null;
    /** The turns up to the point, for a summary. Already redacted. */
    readonly history: SessionRecord["turns"];
    /** The turn whose message to send again at once, for a retry, or null. */
    readonly retryTurn: SessionRecord["turns"][number] | null;
  }): Promise<BranchResult> {
    const { from, point, snapshot } = input;
    const sessions = this.options.sessions;
    if (from.projectId === null) throw new EvaError("project_not_found", "This Project chat names no project.");
    if (from.closed)
      throw new EvaError("session_closed", "This chat is closed, because Eva reused its clone. Start a new chat.");
    const project = this.project(from.projectId);
    // The chat exists before the next choice starts, so its creation already keeps the clone.
    const { session, carried } = await this.oneCloneChoiceAtATime(project, async () => {
      const clone =
        snapshot === null
          ? await this.freeOrNewClone(project, from.startFolder)
          : await this.cloneAt(project, from, snapshot);
      // The history names the files that the chat was given, so they go along (#706).
      copyGivenFiles(from.startFolder, clone.path);
      const carried =
        point === null ||
        sessions.carryHistory(from.engine, {
          engineSessionId: point.engineSessionId,
          toFolder: clone.path,
          environment: this.options.engineEnvironment ?? {},
        });
      const place = { startFolder: clone.path, clone: clone.name };
      return { session: sessions.createMovedBranch(from.id, carried ? point : null, place), carried };
    });
    if (carried) {
      // The send never rejects: a failure of the turn is its turn_failed event.
      if (input.retryTurn !== null) void sessions.sendAgain(session.id, input.retryTurn);
      return { session: sessions.get(session.id), notice: null };
    }
    const summary =
      this.options.summarizer === undefined
        ? { ok: false as const, reason: "This Eva writes no summaries." }
        : await this.options.summarizer.summarize({
            engine: from.engine,
            model: from.modelAlias,
            // The summary becomes the new chat's first message, so it must name no vault folder (#706).
            turns: input.history.map((turn) => ({ ...turn, userText: withBaseNames(turn.userText) })),
            gitState: null,
          });
    const draft = [summary.ok ? summary.text : null, input.retryTurn?.userText ?? null]
      .filter((part) => part !== null)
      .join("\n\n");
    const notice =
      `Eva could not take the history of this chat to ${session.clone ?? "the new clone"}, so the new chat starts ` +
      (summary.ok
        ? "from a summary. Read it, then send it."
        : `with no history. The summary failed too: ${summary.reason}`);
    return { session: sessions.continueFrom(session.id, from.id, draft.length === 0 ? null : draft), notice };
  }

  /**
   * A new clone with the files of a snapshot of the chat's clone. The snapshot refs are not on GitHub,
   * so the new clone fetches them from the old clone's folder. A failure removes the new clone.
   */
  private async cloneAt(project: Project, from: SessionRecord, snapshot: string): Promise<Clone> {
    const clone = await this.cloneInto(project);
    const run = { runner: this.options.runner, environment: this.options.gitEnvironment };
    try {
      await copySnapshot(from.startFolder, clone.path, snapshot, run);
      await restoreSnapshot(clone.path, snapshot, run);
    } catch (error) {
      rmSync(clone.path, { recursive: true, force: true, maxRetries: 5 });
      throw error;
    }
    return clone;
  }

  /**
   * Gives work to a project: a Project chat in a free clone runs the request, and its
   * result goes back to the Assistant chat that asked, as a new message.
   */
  async start(input: ProjectWorkInput): Promise<SessionRecord> {
    const project = this.project(input.projectId);
    const sessions = this.options.sessions;
    const reportsTo = input.reportToSessionId === null ? {} : { reportsTo: input.reportToSessionId };
    // A specialist does the work in its own folder, with no clone (#703).
    const clone =
      project.frontMatter.type === "specialist"
        ? null
        : // The reservation happens inside the choice, so a second work cannot pick the same clone.
          await this.oneCloneChoiceAtATime(project, async () => {
            const chosen = await this.freeOrNewClone(project);
            this.reservedClones.add(chosen.path);
            return chosen;
          });
    const session =
      clone === null
        ? this.specialistChat(project, { source: "cli", ...reportsTo })
        : sessions.createSession({
            mode: "project",
            engine: this.options.defaultEngine,
            startFolder: clone.path,
            source: "cli",
            projectId: project.id,
            clone: clone.name,
            ...reportsTo,
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
        // At once, so the chat is busy and cannot go. A specialist's turn itself waits for the asking turn.
        await sessions.send(session.id, input.request);
      } finally {
        if (clone !== null) this.reservedClones.delete(clone.path);
      }
      if (input.reportToSessionId === null) return;
      // The person may delete either chat while the work runs: the Project chat then keeps the result.
      const exists = (id: string): boolean => sessions.list().some((candidate) => candidate.id === id);
      // A delete of the asking branch moves the report to the fork that took its place (issue 647).
      const reportTo = (exists(session.id) ? sessions.get(session.id).reportsTo : null) ?? input.reportToSessionId;
      const last = exists(session.id) ? sessions.get(session.id).turns.at(-1) : undefined;
      const failed = last?.failure !== null;
      const result = failed ? `It failed: ${last?.failure ?? "no answer"}` : last.answerText;
      const details = await Promise.all(
        listClones(project.path)
          .find((candidate) => candidate.path === clone?.path)
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
      const place = clone === null ? "specialist" : [`clone ${clone.name}`, ...details.map(repositoryPlace)].join("; ");
      const report = {
        projectId: project.id,
        projectTitle: project.title,
        projectSessionId: session.id,
        request: input.request,
        clone: clone?.name ?? null,
        repositories: details.map(({ name, branch, pullRequest }) => ({ name, branch, pullRequest })),
        failed,
        result: result.slice(-reportTextLimit),
        resultCut: result.length > reportTextLimit,
      };
      await sessions.send(
        reportTo,
        `[Project work finished: ${project.id}, ${place}, chat ${session.id}]\n\n${capReportText(result)}`,
        "eva",
        { projectReport: report },
      );
    });
    return session;
  }

  /**
   * The setup report of each repository of a project, by the repository's type. A repository
   * with no known type gets no report, and one that Eva cannot read gets only the reason.
   */
  async repositorySetup(projectId: string): Promise<SetupReport[]> {
    const project = this.project(projectId);
    if (project.frontMatter.type === "specialist") throw noClones();
    return this.reports(project, project.frontMatter.repos);
  }

  /** The reports of these repositories of the project. */
  private async reports(project: Project, urls: readonly string[]): Promise<SetupReport[]> {
    if (urls.length === 0) return [];
    // Each reference is read once, and only when a repository of its type needs it.
    const references = new Map<string, Promise<RepositoryFacts | string>>();
    const readReference = (slug: string): Promise<RepositoryFacts | string> => {
      const known = references.get(slug);
      if (known !== undefined) return known;
      const reading = this.readFacts(slug).then((facts) =>
        // A gap in the reference would turn into false greens, such as "has every standard label".
        typeof facts !== "string" && (facts.files === null || facts.labels === null || !Array.isArray(facts.allowRules))
          ? `Eva could not read all of her reference repository, ${slug}. Try again later.`
          : facts,
      );
      references.set(slug, reading);
      return reading;
    };
    return Promise.all(
      urls.map(async (url) => {
        const slug = githubSlug(url);
        if (slug === null) return unreadableReport(url, null, "Only a repository on GitHub has a setup report.", null);
        const type = repositoryTypeOf(project.frontMatter.repoTypes[url]);
        if (type === null) {
          const proposed = await this.proposedType(slug);
          return {
            ...unreadableReport(url, slug, null, null),
            ...(proposed === null ? {} : { proposedType: proposed }),
          };
        }
        const [target, reference] = await Promise.all([
          this.readFacts(slug),
          type.reference === null ? null : readReference(type.reference),
        ]);
        if (typeof reference === "string") return unreadableReport(url, slug, reference, type.name);
        if (typeof target === "string") return unreadableReport(url, slug, target, type.name);
        if (target.isArchived)
          return unreadableReport(url, slug, "This repository is archived, so it takes no changes.", type.name);
        // The address of the project file, so a Fix or a type change finds the repository again.
        return { ...type.report(target, reference), repositoryUrl: url };
      }),
    );
  }

  /** The type that a repository's files show: a widget has its manifest at the root (#688). */
  private async proposedType(slug: string): Promise<RepositoryTypeName | null> {
    const request = this.options.githubRequest ?? ghApiRequest(this.options.runner, this.options.gitEnvironment);
    try {
      const answer = await request(`repos/${slug}/contents/${manifestPath}`, true);
      return answer.status === 200 ? "widget" : null;
    } catch (error) {
      if (isEvaError(error, "github_failed")) return null;
      throw error;
    }
  }

  /** The facts of a repository, or the reason that Eva cannot read them. */
  private async readFacts(slug: string): Promise<RepositoryFacts | string> {
    const request = this.options.githubRequest ?? ghApiRequest(this.options.runner, this.options.gitEnvironment);
    try {
      return await readRepositoryFacts(slug, request);
    } catch (error) {
      if (isEvaError(error, "github_failed")) return error.message;
      throw error;
    }
  }

  /**
   * Runs the direct fixes of the named items of a repository's report, or of every red and yellow
   * item when `items` is null. The result has the request for a chat: the items that need one, and
   * the direct fixes that failed, so a coding agent can try them.
   */
  async fixRepository(
    projectId: string,
    repository: string,
    items: readonly string[] | null,
  ): Promise<RepositoryFixResult> {
    const project = this.project(projectId);
    // A fix can open a chat of the project, which for a specialist would run a GitHub request in the vault.
    if (project.frontMatter.type === "specialist") throw noClones();
    return (await this.runFixes(project, repository, items)).result;
  }

  private async runFixes(
    project: Project,
    repository: string,
    items: readonly string[] | null,
  ): Promise<{ result: RepositoryFixResult; needsChanges: boolean; report: SetupReport }> {
    if (!project.frontMatter.repos.includes(repository))
      throw new EvaError("project_invalid", `The project does not list the repository ${repository}.`);
    const [report] = await this.reports(project, [repository]);
    if (report === undefined) throw new EvaError("project_invalid", "Eva could not read the repository's report.");
    if (report.problem !== null) throw new EvaError("github_failed", report.problem);
    const slug = report.slug;
    if (slug === null || report.type === null)
      throw new EvaError("project_invalid", "Pick the type of this repository first.");
    const all = report.sections.flatMap((section) => section.items);
    const chosen =
      items === null
        ? all.filter((item) => item.light === "red" || item.light === "yellow")
        : all.filter((item) => items.includes(item.label));
    const direct = chosen.flatMap((item) =>
      item.directFix === undefined || item.light === "grey" ? [] : [{ label: item.label, directFix: item.directFix }],
    );
    const outcome = await runDirectFixes(slug, direct, this.githubWrite());
    const failed = new Set(outcome.failed.map((entry) => entry.label));
    const forChat = chosen.filter((item) => item.directFix === undefined || failed.has(item.label));
    const problems = outcome.failed.map((entry) => `${entry.label}: ${entry.reason}`);
    const request = chatRequest(slug, forChat);
    // The chat opens instead of the report, so it says why each direct fix failed.
    const refused =
      problems.length === 0
        ? ""
        : `\n\nEva tried these commands herself, and GitHub refused them:\n\n${problems.map((problem) => `- ${problem}`).join("\n")}`;
    // The chat hides the report, so it names each pull request, for the person and for the agent.
    const opened =
      outcome.notes.length === 0
        ? ""
        : `\n\nEva already opened these pull requests. Leave their files as they are:\n\n${outcome.notes.map((note) => `- ${note}`).join("\n")}`;
    return {
      result: {
        fixed: outcome.fixed,
        problems,
        notes: outcome.notes,
        chatRequest: request === null ? null : request + refused + opened,
      },
      needsChanges: forChat.some((item) => item.directFix === undefined && item.light !== "grey"),
      report,
    };
  }

  /**
   * The setup of a new repository, by its type: the type's own first step, then every direct
   * fix of its report, then one Project chat for the rest. A chat that changes files merges its
   * own pull request, as the vibe-coded standard says.
   */
  async setUpRepository(projectId: string, url: string): Promise<NewProjectSetup> {
    const project = this.project(projectId);
    if (project.frontMatter.type === "specialist") throw noClones();
    const type = repositoryTypeOf(project.frontMatter.repoTypes[url]);
    const slug = githubSlug(url);
    if (type?.afterCreate !== undefined && slug !== null) {
      try {
        await type.afterCreate(slug, this.githubWrite(), { title: project.title });
      } catch (error) {
        if (!isEvaError(error, "github_failed")) throw error;
        // The fixes would land on a repository with no template, so the setup stops here.
        throw new EvaError("github_failed", `Eva could not push the first files: ${error.message}`, { cause: error });
      }
    }
    const { result, needsChanges, report } = await this.runFixes(project, url, null);
    // GitHub can serve a new repository's files or labels a moment late. Their items are grey then, so
    // neither a fix nor the chat would cover them.
    const unread = missesFacts(report);
    const problems = unread
      ? [
          ...result.problems,
          "GitHub did not show all of the new repository yet. Open Repository setup later, and press Fix all.",
        ]
      : [...result.problems];
    if (type?.afterFixes !== undefined && slug !== null) {
      try {
        await type.afterFixes(slug, this.githubWrite());
      } catch (error) {
        if (!isEvaError(error, "github_failed")) throw error;
        problems.push(`Eva could not finish the last setup step: ${error.message}`);
      }
    }
    const fixes =
      result.chatRequest === null
        ? null
        : needsChanges
          ? `${result.chatRequest}\n\n${setupChatEnd}`
          : result.chatRequest;
    // A type with its own first chat, such as a widget, opens it instead; the setup items that are left come last.
    const first = type?.firstChat === undefined || slug === null ? null : type.firstChat(slug);
    const request =
      first === null ? fixes : fixes === null ? first : `${first}\n\nThe setup also left these items:\n\n${fixes}`;
    // With no chat, the setup messages are the only place that names an open pull request.
    if (request === null) return { sessionId: null, problems: [...problems, ...result.notes] };
    const session = await this.start({ projectId, request, reportToSessionId: null });
    return { sessionId: session.id, problems };
  }

  private githubWrite(): GithubWrite {
    return this.options.githubWrite ?? ghApiWrite(this.options.runner, this.options.gitEnvironment);
  }

  /** Sets the type of one repository of a project, in its `AGENTS.md`. */
  setRepositoryType(projectId: string, repository: string, type: RepositoryTypeName): ProjectFile {
    const path = this.projectFilePath(projectId);
    const before = projectText(path, projectId);
    const text = setRepositoryType(before, repository, type);
    checkProjectFile(text);
    if (text !== before) writeFileAtomic(path, text);
    return projectFileOf(text);
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
      model: "haiku",
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

  /** True while Eva pulls or pushes any repository in the clone folder, so an undo waits (issue 523). */
  isSyncingFolder(clonePath: string): boolean {
    return listRepositories(clonePath).some((repository) => this.syncingRepositories.has(repository.path));
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
        if (!deletedChats.includes(chat.id)) deletedChats.push(...sessions.delete(chat.id, { forgetSnapshots: false }));
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
    this.checkTypeChange(projectId, before, text);
    if (text !== before) writeFileAtomic(path, text);
    return projectFileOf(text);
  }

  /**
   * A chat of a specialist works in the project folder, and a chat of a software project in a clone.
   * A new type would change the kind of each chat under the person, so it waits for none (#703).
   */
  private checkTypeChange(projectId: string, before: string, after: string): void {
    const typeOf = (text: string): string | undefined => projectFileOf(text).details?.type;
    if (typeOf(before) === typeOf(after)) return;
    const project = this.project(projectId);
    if (project.clones.length > 0)
      throw new EvaError("project_invalid", `${project.title} has clones. Delete them before you change its type.`);
    if (this.options.sessions.list().some((chat) => chat.projectId === projectId))
      throw new EvaError("project_invalid", `${project.title} has chats. Delete them before you change its type.`);
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
    // Every new clone comes here, so no path, such as a cached page's New clone, clones into a specialist.
    if (project.frontMatter.type === "specialist") throw noClones();
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

  /**
   * Call it only inside `oneCloneChoiceAtATime`, or two callers can get the same clone. A fork names the
   * clone of the chat it comes from: a reuse would close that chat.
   */
  private async freeOrNewClone(project: Project, except: string | null = null): Promise<Clone> {
    // A clone with a record of each repository goes first: one with none asks a trust question,
    // and work may run with nobody to answer it.
    const clones = listClones(project.path).filter((clone) => clone.path !== except);
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
    // The closed chats take no retry or fork, so their snapshots and their given files serve nobody (issue 523).
    await deleteSnapshots(current.path, "all", { runner, environment: gitEnvironment });
    rmSync(join(current.path, mentionsFolderName), { recursive: true, force: true, maxRetries: 5 });
    return current;
  }

  /**
   * True when the clone holds anything that is not on a remote. A file in the clone folder itself,
   * outside every repository, is in no repository, so it counts too. A file that the operating system
   * writes, such as `desktop.ini`, holds no work.
   */
  private async holdsLocalWork(clone: Clone): Promise<boolean> {
    // The files that the person gave a chat are copies of vault files and attachments, not work (#706).
    const repositoryNames = new Set([
      ...clone.repositories.map((repository) => repository.name),
      ...systemFiles,
      mentionsFolderName,
    ]);
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
      model: cheapestModel(engine, chats[0]?.modelAlias ?? "haiku"),
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

/** A specialist saves its work in the vault, so it never gets a clone (#703). */
function noClones(): EvaError {
  return new EvaError(
    "project_invalid",
    "A specialist has no clones and no repository: its chats work in its own folder.",
  );
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

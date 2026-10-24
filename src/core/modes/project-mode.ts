/**
 * Project mode: the harness exactly as if the person opened the clone folder, above its repositories.
 * Eva adds no prompt and no plugin. She only decides trust: an untrusted clone runs with
 * its hooks, project settings and project MCP servers off. Trust follows the URL that Eva
 * cloned from, never the clone's live `origin`. The first time a clone of an unknown
 * repository opens, Eva asks the person, as Claude Code itself does. A folder that Eva has
 * no record of cloning, or that is not the folder she cloned, is asked about too, and the
 * answer holds for that folder only.
 */
import { basename, delimiter, dirname } from "node:path";
import {
  isTrustedByDefault,
  listRepositories,
  shownUrl,
  type CloneOriginStore,
  type TrustStore,
} from "../projects/clones.ts";
import { EvaError } from "../../shared/errors.ts";
import { deleteSnapshots, restoreSnapshot, takeSnapshot, type SnapshotRun } from "../projects/clone-snapshots.ts";
import type { PrepareContext, PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

export interface ProjectPreparerOptions {
  readonly trustStore: TrustStore;
  /** The URL that Eva cloned each clone from. Trust follows it, not the live `origin` (issue #15). */
  readonly cloneOrigins: CloneOriginStore;
  /** Read on each turn, so a changed list or a new GitHub login applies with no restart. */
  readonly trustedOwners: () => readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /** The `origin` URL of a clone, or null when it has none. Only a folder that Eva did not clone uses it. */
  readonly readRemote: (cloneFolder: string) => Promise<string | null>;
  /** Eva's own git for the snapshots of a clone's files (issue 523). Without it, a turn keeps none. */
  readonly snapshots?: SnapshotRun;
}

export class ProjectPreparer implements TurnPreparer {
  private readonly options: ProjectPreparerOptions;

  constructor(options: ProjectPreparerOptions) {
    this.options = options;
  }

  async prepare(session: SessionRecord, context: PrepareContext): Promise<PreparedTurn> {
    return {
      startFolder: session.startFolder,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: await this.isCloneTrusted(session.startFolder, context),
      environment: withGitCeiling(this.options.environment, dirname(session.startFolder)),
    };
  }

  afterTurn(_session: SessionRecord, _outcome: TurnOutcome): Promise<string | null> {
    return Promise.resolve(null);
  }

  /** Keeps the files of every repository of the clone, so a retry or a fork can go back to them. */
  snapshot(session: SessionRecord, id: string): Promise<boolean> {
    const run = this.options.snapshots;
    return run === undefined ? Promise.resolve(false) : takeSnapshot(session.startFolder, id, run);
  }

  forget(session: SessionRecord, ids: readonly string[]): void {
    const run = this.options.snapshots;
    // A ref left behind costs little, and a reuse of the clone deletes it.
    if (run !== undefined) void deleteSnapshots(session.startFolder, ids, run).catch(() => undefined);
  }

  restore(session: SessionRecord, id: string): Promise<void> {
    const run = this.options.snapshots;
    if (run === undefined) return Promise.reject(new EvaError("snapshot_missing", "This Eva keeps no snapshots."));
    return restoreSnapshot(session.startFolder, id, run);
  }

  /**
   * A clone is trusted only when each of its repositories is (issue 521): the agent starts above them
   * all. Eva asks about each unknown repository in turn, and stops at the first one that is not trusted.
   */
  private async isCloneTrusted(cloneFolder: string, context: PrepareContext): Promise<boolean> {
    const repositories = listRepositories(cloneFolder);
    if (repositories.length === 0) return false;
    for (const repository of repositories) if (!(await this.isTrusted(repository.path, context))) return false;
    return true;
  }

  private async isTrusted(cloneFolder: string, context: PrepareContext): Promise<boolean> {
    const origin = this.options.cloneOrigins.origin(cloneFolder);
    if (origin === null) return this.isUnknownFolderTrusted(cloneFolder, context);
    if (origin.kind === "answered") return origin.decision === "trusted";
    if (origin.kind === "replaced") {
      // The question shows the URL that Eva recorded, never one that the new folder claims.
      return this.askAboutFolder(
        cloneFolder,
        origin.url,
        context,
        `${basename(cloneFolder)} is not the folder that Eva cloned from ${shownUrl(origin.url)}. ` +
          "Eva cannot check what it holds now.",
      );
    }
    const remote = origin.url;
    const decision = this.options.trustStore.decision(remote);
    if (decision !== "unknown") return decision === "trusted";
    if (isTrustedByDefault(remote, this.options.trustedOwners())) return true;
    const answer = await askTrust(
      context,
      "Trust this repository",
      `${shownUrl(remote)}: allow its hooks, settings and MCP servers to run? Deny keeps them off.`,
    );
    if (answer !== null) this.options.trustStore.remember(remote, answer);
    return answer === "trusted";
  }

  /**
   * A folder with no record: made by hand, or by Eva before she kept records. Its live `origin` is
   * only a claim, since code in the folder can change it, so neither the answers by URL nor the owner
   * allowlist apply.
   */
  private async isUnknownFolderTrusted(cloneFolder: string, context: PrepareContext): Promise<boolean> {
    let remote: string | null;
    try {
      remote = await this.options.readRemote(cloneFolder);
    } catch {
      remote = null;
    }
    if (remote === null) return false;
    return this.askAboutFolder(
      cloneFolder,
      remote,
      context,
      `Eva has no record of cloning ${basename(cloneFolder)}. It says it comes from ${shownUrl(remote)}, ` +
        "but Eva cannot check that.",
    );
  }

  /** Asks about one folder. The answer holds for that folder only, not for every clone of the URL. */
  private async askAboutFolder(
    cloneFolder: string,
    url: string,
    context: PrepareContext,
    reason: string,
  ): Promise<boolean> {
    const answer = await askTrust(
      context,
      "Trust this clone",
      `${reason} Allow its hooks, settings and MCP servers to run? Deny keeps them off.`,
    );
    if (answer !== null) this.options.cloneOrigins.recordAnswer(cloneFolder, url, answer);
    return answer === "trusted";
  }
}

/** The person's answer, or null when the question expired. */
async function askTrust(
  context: PrepareContext,
  question: string,
  detail: string,
): Promise<"trusted" | "untrusted" | null> {
  const answer = await context.ask(question, detail);
  // Only the person's own answer is kept. An expired question leaves this turn untrusted and asks again next time.
  if (answer === "expired") return null;
  return answer === "allow" ? "trusted" : "untrusted";
}

/**
 * Git stops its search for a repository at the folder of the clones. The clone folder itself is no
 * repository, so without this a git command there would read the vault's repository above it.
 */
function withGitCeiling(
  environment: Readonly<Record<string, string>>,
  clonesFolder: string,
): Readonly<Record<string, string>> {
  const current = environment["GIT_CEILING_DIRECTORIES"];
  const ceiling = current === undefined || current === "" ? clonesFolder : `${current}${delimiter}${clonesFolder}`;
  return { ...environment, GIT_CEILING_DIRECTORIES: ceiling };
}

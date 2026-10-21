/**
 * Project mode: the harness exactly as if the person opened the clone.
 * Eva adds no prompt and no plugin. She only decides trust: an untrusted clone runs with
 * its hooks, project settings and project MCP servers off. Trust follows the URL that Eva
 * cloned from, never the clone's live `origin`. The first time a clone of an unknown
 * repository opens, Eva asks the person, as Claude Code itself does. A folder that Eva has
 * no record of cloning, or that is not the folder she cloned, is asked about too, and the
 * answer holds for that folder only.
 */
import { basename } from "node:path";
import { isTrustedByDefault, shownUrl, type CloneOriginStore, type TrustStore } from "../projects/clones.ts";
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
      trusted: await this.isTrusted(session.startFolder, context),
      environment: this.options.environment,
    };
  }

  afterTurn(_session: SessionRecord, _outcome: TurnOutcome): Promise<string | null> {
    return Promise.resolve(null);
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

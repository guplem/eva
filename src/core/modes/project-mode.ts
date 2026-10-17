/**
 * Project mode: the harness exactly as if the person opened the clone.
 * Eva adds no prompt and no plugin. She only decides trust: an untrusted clone runs with
 * its hooks, project settings and project MCP servers off. The first time a clone of
 * an unknown repository opens, Eva asks the person, as Claude Code itself does.
 */
import { basename } from "node:path";
import { isTrustedByDefault, type CloneOriginStore, type TrustStore } from "../projects/clones.ts";
import type { PrepareContext, PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

export interface ProjectPreparerOptions {
  readonly trustStore: TrustStore;
  /** The URL that Eva cloned each clone from. Trust follows it, not the live `origin` (issue #15). */
  readonly cloneOrigins: CloneOriginStore;
  readonly trustedOwners: readonly string[];
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
    if (origin === null) return this.isFolderTrusted(cloneFolder, context);
    if (origin.decision !== undefined) return origin.decision === "trusted";
    const remote = origin.url;
    const decision = this.options.trustStore.decision(remote);
    if (decision !== "unknown") return decision === "trusted";
    if (isTrustedByDefault(remote, this.options.trustedOwners)) return true;
    const answer = await context.ask(
      "Trust this repository",
      `${remote}: allow its hooks, settings and MCP servers to run? Deny keeps them off.`,
    );
    // Only the person's own answer is kept. An expired question leaves this turn untrusted and asks again next time.
    if (answer === "expired") return false;
    this.options.trustStore.remember(remote, answer === "allow" ? "trusted" : "untrusted");
    return answer === "allow";
  }

  /**
   * A folder that Eva did not clone. Its live `origin` is only a claim, since code in the folder can
   * change it, so neither the answers by URL nor the owner allowlist apply. The person's answer
   * holds for this folder only.
   */
  private async isFolderTrusted(cloneFolder: string, context: PrepareContext): Promise<boolean> {
    let remote: string | null;
    try {
      remote = await this.options.readRemote(cloneFolder);
    } catch {
      remote = null;
    }
    if (remote === null) return false;
    const answer = await context.ask(
      "Trust this clone",
      `Eva did not clone ${basename(cloneFolder)}. Its origin says ${remote}, which Eva cannot check. ` +
        "Allow its hooks, settings and MCP servers to run? Deny keeps them off.",
    );
    if (answer === "expired") return false;
    this.options.cloneOrigins.recordAnswer(cloneFolder, remote, answer === "allow" ? "trusted" : "untrusted");
    return answer === "allow";
  }
}

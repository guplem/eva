/**
 * Project mode: the harness exactly as if the person opened the clone (docs/plan.md D8).
 * Eva adds no prompt and no plugin. She only decides trust: an untrusted clone runs with
 * its hooks, project settings and project MCP servers off (§12). The first time a clone of
 * an unknown repository opens, Eva asks the person, as Claude Code itself does.
 */
import { isTrustedByDefault, type TrustStore } from "../projects/clones.ts";
import type { PrepareContext, PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

export interface ProjectPreparerOptions {
  readonly trustStore: TrustStore;
  readonly trustedOwners: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /** The `origin` URL of a clone, or null when it has none. */
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
    let remote: string | null;
    try {
      remote = await this.options.readRemote(cloneFolder);
    } catch {
      remote = null;
    }
    if (remote === null) return false;
    const decision = this.options.trustStore.decision(remote);
    if (decision !== "unknown") return decision === "trusted";
    if (isTrustedByDefault(remote, this.options.trustedOwners)) return true;
    const answer = await context.ask(
      "Trust this repository",
      `${remote}: allow its hooks, settings and MCP servers to run? Deny keeps them off.`,
    );
    this.options.trustStore.remember(remote, answer === "allow" ? "trusted" : "untrusted");
    return answer === "allow";
  }
}

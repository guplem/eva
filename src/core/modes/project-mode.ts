/**
 * Project mode: the harness exactly as if the person opened the clone (docs/plan.md D8).
 * Eva adds no prompt and no plugin. She only decides trust: an untrusted clone runs with
 * its hooks and project MCP servers off (§12).
 */
import { isTrustedByDefault, type TrustStore } from "../projects/clones.ts";
import type { PreparedTurn, TurnOutcome, TurnPreparer } from "../sessions/session-manager.ts";
import type { SessionRecord } from "../sessions/session-store.ts";

export interface ProjectPreparerOptions {
  readonly trustStore: TrustStore;
  readonly trustedOwners: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /** The `origin` URL of a clone, or null when it has none. */
  readonly readRemote: (cloneFolder: string) => string | null;
}

export class ProjectPreparer implements TurnPreparer {
  private readonly options: ProjectPreparerOptions;

  constructor(options: ProjectPreparerOptions) {
    this.options = options;
  }

  prepare(session: SessionRecord): Promise<PreparedTurn> {
    return Promise.resolve({
      startFolder: session.startFolder,
      appendSystemPrompt: null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: this.isTrusted(session.startFolder),
      environment: this.options.environment,
    });
  }

  afterTurn(_session: SessionRecord, _outcome: TurnOutcome): Promise<string | null> {
    return Promise.resolve(null);
  }

  private isTrusted(cloneFolder: string): boolean {
    let remote: string | null;
    try {
      remote = this.options.readRemote(cloneFolder);
    } catch {
      remote = null;
    }
    if (remote === null) return false;
    const decision = this.options.trustStore.decision(remote);
    if (decision !== "unknown") return decision === "trusted";
    return isTrustedByDefault(remote, this.options.trustedOwners);
  }
}

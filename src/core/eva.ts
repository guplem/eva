/**
 * One Eva instance: the core that every front end talks to (docs/plan.md §4). It joins the
 * vault sync, the projects, the sessions and the two modes, and runs the idle sweep.
 */
import { join } from "node:path";
import type { EnginePort, ModelAlias } from "../shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../shared/environment.ts";
import { EvaError } from "../shared/errors.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import { Redactor } from "../shared/redaction.ts";
import type { EvaConfig, EvaSecrets, HomePaths } from "./instance/home.ts";
import { AssistantPreparer } from "./modes/assistant-mode.ts";
import { ProjectPreparer } from "./modes/project-mode.ts";
import { createClone, listClones, TrustStore, type Clone } from "./projects/clones.ts";
import { discoverProjects, searchProjects, type Project, type ProjectQuery } from "./projects/project-catalog.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { SessionStore, type SessionRecord } from "./sessions/session-store.ts";
import { VaultSync, type VaultSyncState } from "./vault/vault-sync.ts";

export interface EvaOptions {
  readonly paths: HomePaths;
  readonly config: EvaConfig;
  readonly secrets: EvaSecrets;
  readonly engines: readonly EnginePort[];
  readonly runner: ProcessRunner;
  /** The environment Eva started with. Child processes only get its allowlisted part. */
  readonly processEnvironment: EnvironmentMap;
  readonly now: () => Date;
  readonly basePrompt: string;
  readonly gatherMs?: number;
}

export interface EvaStatus {
  readonly vaultPath: string | null;
  readonly role: EvaConfig["role"];
  readonly vaultSync: VaultSyncState;
  readonly sessionCount: number;
  readonly busySessionIds: readonly string[];
}

export interface NewChatInput {
  readonly source: SessionRecord["source"];
  readonly model: ModelAlias;
  readonly telegramTopicId?: number;
}

export interface NewProjectChatInput extends NewChatInput {
  readonly projectId: string;
  readonly cloneName?: string;
}

const approvalTimeoutMs = 10 * 60_000;
const gitStatusTimeoutMs = 20_000;
const noVaultState: VaultSyncState = {
  status: "skipped",
  lastCommitAt: null,
  lastPushAt: null,
  lastError: "No vault is configured.",
  withheldFiles: [],
};

export class Eva {
  readonly sessions: SessionManager;
  private readonly options: EvaOptions;
  private readonly vaultSync: VaultSync | null;
  private readonly gitEnvironment: Record<string, string>;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: EvaOptions) {
    this.options = options;
    const vaultPath = options.config.vaultPath;
    this.gitEnvironment = buildChildEnvironment(options.processEnvironment, baseEnvironmentAllowlist);
    this.vaultSync =
      vaultPath === null
        ? null
        : new VaultSync({ vaultPath, runner: options.runner, environment: this.gitEnvironment, now: options.now });

    const redactor = new Redactor();
    for (const secret of Object.values(options.secrets)) redactor.addSecret(secret);
    const engineEnvironment = this.engineEnvironment();
    const vaultSync = this.vaultSync;

    this.sessions = new SessionManager({
      engines: options.engines,
      store: new SessionStore(options.paths.sessions),
      preparers: {
        assistant: new AssistantPreparer({
          vaultPath: vaultPath ?? "",
          vaultSync: vaultSync ?? {
            pull: () => Promise.resolve(noVaultState),
            save: () => Promise.resolve(noVaultState),
          },
          basePrompt: options.basePrompt,
          runner: options.runner,
          environment: engineEnvironment,
          now: options.now,
          timeZone: options.config.timeZone ?? "UTC",
        }),
        project: new ProjectPreparer({
          trustStore: new TrustStore(options.paths.trust),
          trustedOwners: options.config.trust.trustedRepositoryOwners,
          environment: engineEnvironment,
          readRemote: (folder) => readOriginUrl(folder, this.gitEnvironment),
        }),
      },
      now: options.now,
      newId: () => crypto.randomUUID(),
      redactor,
      gatherMs: options.gatherMs ?? 1_000,
      approvalTimeoutMs,
    });
  }

  /** Starts the idle sweep (plan §6). */
  startBackgroundWork(): void {
    if (this.sweepTimer !== null || !this.options.config.sync.enabled) return;
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, this.options.config.sync.sweepSeconds * 1_000);
  }

  stop(): void {
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Saves changes made outside a turn. It never runs during an Assistant turn (lessons 22, 30). */
  async sweep(): Promise<VaultSyncState["status"]> {
    if (this.vaultSync === null) return "skipped";
    const assistantBusy = this.sessions
      .list()
      .some((session) => session.mode === "assistant" && this.sessions.isBusy(session.id));
    if (assistantBusy) return "skipped";
    return (await this.vaultSync.save()).status;
  }

  status(): EvaStatus {
    const sessions = this.sessions.list();
    return {
      vaultPath: this.options.config.vaultPath,
      role: this.options.config.role,
      vaultSync: this.vaultSync?.currentState ?? noVaultState,
      sessionCount: sessions.length,
      busySessionIds: sessions.filter((session) => this.sessions.isBusy(session.id)).map((session) => session.id),
    };
  }

  projects(query: ProjectQuery = {}): Project[] {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return [];
    return searchProjects(discoverProjects({ vaultPath, extraRoots: this.options.config.projectRoots }), query);
  }

  createAssistantSession(input: NewChatInput): SessionRecord {
    const vaultPath = this.requireVault();
    return this.sessions.createSession({
      mode: "assistant",
      engine: this.options.config.engines.default,
      model: input.model,
      startFolder: vaultPath,
      source: input.source,
      ...(input.telegramTopicId === undefined ? {} : { telegramTopicId: input.telegramTopicId }),
    });
  }

  /** A Project chat in the named clone, or in a free clone, or in a new clone (plan §3.4). */
  async createProjectSession(input: NewProjectChatInput): Promise<SessionRecord> {
    const project = this.projects().find((candidate) => candidate.id === input.projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${input.projectId} in the vault.`);
    const clone =
      input.cloneName === undefined
        ? await this.freeOrNewClone(project)
        : listClones(project.path).find((candidate) => candidate.name === input.cloneName);
    if (clone === undefined)
      throw new EvaError("project_not_found", `Project ${project.id} has no clone ${input.cloneName ?? ""}.`);
    return this.sessions.createSession({
      mode: "project",
      engine: this.options.config.engines.default,
      model: input.model,
      startFolder: clone.path,
      source: input.source,
      projectId: project.id,
      clone: clone.name,
    });
  }

  /** Clones a project's repository into its next free folder (the "New clone" button). */
  async newClone(projectId: string, repositoryUrl?: string): Promise<Clone> {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${projectId} in the vault.`);
    const url = repositoryUrl ?? project.frontMatter.repos[0];
    if (url === undefined)
      throw new EvaError("project_not_found", `Project ${projectId} lists no repository to clone.`);
    return createClone({
      projectPath: project.path,
      repositoryUrl: url,
      runner: this.options.runner,
      environment: this.gitEnvironment,
    });
  }

  private async freeOrNewClone(project: Project): Promise<Clone> {
    for (const clone of listClones(project.path)) {
      const busy = this.sessions
        .list()
        .some((session) => session.startFolder === clone.path && this.sessions.isBusy(session.id));
      if (!busy && (await this.isClean(clone.path))) return clone;
    }
    return this.newClone(project.id);
  }

  private async isClean(folder: string): Promise<boolean> {
    const result = await this.options.runner.run(["git", "status", "--porcelain"], {
      cwd: folder,
      environment: this.gitEnvironment,
      timeoutMs: gitStatusTimeoutMs,
    });
    return result.exitCode === 0 && result.stdout.trim().length === 0;
  }

  private requireVault(): string {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) throw new EvaError("vault_not_found", "No vault is configured. Run `eva setup`.");
    return vaultPath;
  }

  /** The engine's environment: the allowlist, the Claude token, and an own config folder when asked (plan §4.4). */
  private engineEnvironment(): Record<string, string> {
    const extra: Record<string, string> = {};
    const token = this.options.secrets.claudeOauthToken;
    if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    if (this.options.config.engines.claudeCode.ownConfigFolder) {
      extra["CLAUDE_CONFIG_DIR"] = join(this.options.paths.enginesFolder, "claude");
    }
    return buildChildEnvironment(this.options.processEnvironment, baseEnvironmentAllowlist, extra);
  }
}

function readOriginUrl(folder: string, environment: Record<string, string>): string | null {
  const result = Bun.spawnSync(["git", "remote", "get-url", "origin"], {
    cwd: folder,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const url = result.stdout.toString().trim();
  return result.exitCode === 0 && url.length > 0 ? url : null;
}

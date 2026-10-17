/**
 * One Eva instance: the core that every front end talks to (docs/plan.md §4). It joins the
 * vault sync, the projects, the sessions and the two modes, and runs the idle sweep.
 */
import { chmodSync } from "node:fs";
import { delimiter, join } from "node:path";
import { writeFileAtomic } from "../shared/files.ts";
import type { EngineName, EnginePort, McpServerSpec, ModelAlias } from "../shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../shared/environment.ts";
import { EvaError } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import type { TurnUsage } from "../shared/events.ts";
import { Redactor } from "../shared/redaction.ts";
import { evaVersion } from "../shared/version.ts";
import { runCheck, type CheckName, type CheckResult } from "./checks.ts";
import { parseConfig, saveConfig, type EvaConfig, type EvaSecrets, type HomePaths } from "./instance/home.ts";
import { AssistantPreparer } from "./modes/assistant-mode.ts";
import { ProjectPreparer } from "./modes/project-mode.ts";
import {
  createClone,
  describeClone,
  listClones,
  TrustStore,
  type Clone,
  type CloneDetails,
} from "./projects/clones.ts";
import { Scheduler } from "./schedules/scheduler.ts";
import { cleanScratch } from "./files/vault-files.ts";
import { googleMcpServer } from "./google/google-mcp.ts";
import { createTranscriber, type Transcribe } from "./voice/transcriber.ts";
import { githubTokenVariable } from "./vault/vault-clone.ts";
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
  /** The claude program, for the engine check. */
  readonly claudeExecutable?: string | null;
  /** Where background failures and sync problems go (lessons 16, 50). */
  readonly logger?: Logger;
  /**
   * The command that starts this Eva, such as `[bun, main.ts]` or `[eva.exe]`. Eva writes it as an
   * `eva` script that an agent can run, for `eva work` (plan §5.3). Null: no script.
   */
  readonly evaCommand?: readonly string[] | null;
}

export interface ProjectWorkInput {
  readonly projectId: string;
  readonly request: string;
  /** The Assistant chat that receives the result, or null. */
  readonly reportToSessionId: string | null;
}

/** The last finished turn's token counts, so a broken prompt cache shows (lesson 120). */
export interface LastTurnStatus extends TurnUsage {
  readonly at: string;
  readonly costUsd: number | null;
}

export interface EvaStatus {
  readonly version: string;
  readonly vaultPath: string | null;
  readonly role: EvaConfig["role"];
  readonly vaultSync: VaultSyncState;
  readonly sessionCount: number;
  readonly busySessionIds: readonly string[];
  readonly lastTurn: LastTurnStatus | null;
}

export interface PublicSettings {
  readonly config: EvaConfig;
  /** Whether each secret is set. The values never leave the core. */
  readonly secretsSet: Readonly<
    Record<"telegramBotToken" | "claudeOauthToken" | "githubToken" | "localApiToken", boolean>
  >;
}

export interface NewChatInput {
  readonly source: SessionRecord["source"];
  readonly model: ModelAlias;
  /** The engine of this chat; without one, the configured default (plan §7.2). */
  readonly engine?: EngineName;
  readonly telegramTopicId?: number;
  readonly title?: string;
}

export interface NewProjectChatInput extends NewChatInput {
  readonly projectId: string;
  readonly cloneName?: string;
}

const approvalTimeoutMs = 10 * 60_000;
/** A turn may run long (a big refactor), but never for ever. */
const turnTimeoutMs = 2 * 60 * 60_000;
const gitStatusTimeoutMs = 20_000;
const scheduleTickMs = 30_000;
const noVaultState: VaultSyncState = {
  status: "skipped",
  lastCommitAt: null,
  lastPushAt: null,
  lastError: "No vault is configured.",
  withheldFiles: [],
};

export class Eva {
  readonly sessions: SessionManager;
  /** Null when no vault is configured. */
  readonly schedules: Scheduler | null;
  /** Null until a whisper model is configured. */
  readonly transcribe: Transcribe | null;
  private readonly options: EvaOptions;
  private readonly vaultSync: VaultSync | null;
  private readonly gitEnvironment: Record<string, string>;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastTurn: LastTurnStatus | null = null;
  /** Clones that project work has taken, so two chats never get the same working tree (lesson 49). */
  private readonly reservedClones = new Set<string>();

  constructor(options: EvaOptions) {
    this.options = options;
    const vaultPath = options.config.vaultPath;
    // Only Eva's own git commands get the GitHub token; an agent's environment never does (lesson 96).
    const githubToken = options.secrets.githubToken;
    this.gitEnvironment = buildChildEnvironment(
      options.processEnvironment,
      baseEnvironmentAllowlist,
      githubToken === undefined ? {} : { [githubTokenVariable]: githubToken },
    );
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
          vaultSync:
            vaultSync === null
              ? { pull: () => Promise.resolve(noVaultState), save: () => Promise.resolve(noVaultState) }
              : {
                  pull: async () => this.logSyncState(await vaultSync.pull()),
                  save: async () => this.logSyncState(await vaultSync.save()),
                },
          basePrompt: options.basePrompt,
          runner: options.runner,
          environment: engineEnvironment,
          now: options.now,
          timeZone: options.config.timeZone ?? "UTC",
          mcpServers: this.assistantMcpServers(),
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        }),
        project: new ProjectPreparer({
          trustStore: new TrustStore(options.paths.trust),
          trustedOwners: options.config.trust.trustedRepositoryOwners,
          environment: engineEnvironment,
          readRemote: (folder) => readOriginUrl(folder, options.runner, this.gitEnvironment),
        }),
      },
      now: options.now,
      newId: () => crypto.randomUUID(),
      redactor,
      gatherMs: options.gatherMs ?? 1_000,
      approvalTimeoutMs,
      turnTimeoutMs,
    });

    const voice = options.config.voice;
    this.transcribe =
      voice.modelPath === null
        ? null
        : createTranscriber({
            tools: { ...voice, modelPath: voice.modelPath },
            runner: options.runner,
            environment: this.gitEnvironment,
            temporaryRoot: options.paths.stateFolder,
          });

    this.sessions.subscribe((event) => {
      if (event.kind === "turn_finished") this.lastTurn = { ...event.usage, at: event.at, costUsd: event.costUsd };
    });

    this.schedules =
      vaultPath === null
        ? null
        : new Scheduler({
            vaultPath,
            statePath: options.paths.schedulesState,
            timeZone: options.config.timeZone ?? "UTC",
            isHub: options.config.role === "hub",
            now: options.now,
            chats: {
              createChat: (name, model) => this.createAssistantSession({ source: "schedule", model, title: name }).id,
              send: (sessionId, prompt) => this.sessions.send(sessionId, prompt),
            },
          });
  }

  /** Starts the idle sweep (plan §6) and the schedule checks (plan §9). */
  startBackgroundWork(): void {
    if (this.sweepTimer === null && this.options.config.sync.enabled) {
      this.sweepTimer = setInterval(() => {
        this.inBackground("The idle sweep", () => this.sweep());
      }, this.options.config.sync.sweepSeconds * 1_000);
    }
    const schedules = this.schedules;
    if (this.scheduleTimer === null && schedules !== null) {
      this.scheduleTimer = setInterval(() => {
        this.inBackground("The schedule check", () => schedules.tick());
      }, scheduleTickMs);
    }
  }

  /** Resolves when no chat runs a turn, including its save after the turn. */
  async idle(timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    while (this.sessions.list().some((session) => this.sessions.isBusy(session.id))) {
      if (Date.now() - started > timeoutMs) return;
      await Bun.sleep(20);
    }
  }

  stop(): void {
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    if (this.scheduleTimer !== null) clearInterval(this.scheduleTimer);
    this.sweepTimer = null;
    this.scheduleTimer = null;
  }

  /** Saves changes made outside a turn, and empties old Scratch files. It never runs during an Assistant turn (lessons 22, 30). */
  async sweep(): Promise<VaultSyncState["status"]> {
    if (this.vaultSync === null) return "skipped";
    cleanScratch(this.options.config.vaultPath ?? "", this.options.now());
    const assistantBusy = this.sessions
      .list()
      .some((session) => session.mode === "assistant" && this.sessions.isBusy(session.id));
    if (assistantBusy) return "skipped";
    return this.logSyncState(await this.vaultSync.save()).status;
  }

  status(): EvaStatus {
    const sessions = this.sessions.list();
    return {
      version: evaVersion,
      vaultPath: this.options.config.vaultPath,
      role: this.options.config.role,
      vaultSync: this.vaultSync?.currentState ?? noVaultState,
      sessionCount: sessions.length,
      busySessionIds: sessions.filter((session) => this.sessions.isBusy(session.id)).map((session) => session.id),
      lastTurn: this.lastTurn,
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
      engine: input.engine ?? this.options.config.engines.default,
      model: input.model,
      startFolder: vaultPath,
      source: input.source,
      ...(input.telegramTopicId === undefined ? {} : { telegramTopicId: input.telegramTopicId }),
      ...(input.title === undefined ? {} : { title: input.title }),
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
      engine: input.engine ?? this.options.config.engines.default,
      model: input.model,
      startFolder: clone.path,
      source: input.source,
      projectId: project.id,
      clone: clone.name,
    });
  }

  /**
   * Gives work to a project (plan §5.3): a Project chat in a free clone runs the request, and its
   * result goes back to the Assistant chat that asked, as a new message.
   */
  async startProjectWork(input: ProjectWorkInput): Promise<SessionRecord> {
    const project = this.projects().find((candidate) => candidate.id === input.projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${input.projectId} in the vault.`);
    const clone = await this.freeOrNewClone(project);
    this.reservedClones.add(clone.path);
    const session = this.sessions.createSession({
      mode: "project",
      engine: this.options.config.engines.default,
      model: "default",
      startFolder: clone.path,
      source: "cli",
      projectId: project.id,
      clone: clone.name,
    });
    this.inBackground("Project work", async () => {
      try {
        await this.sessions.send(session.id, input.request);
      } finally {
        this.reservedClones.delete(clone.path);
      }
      const last = this.sessions.get(session.id).turns.at(-1);
      const result = last?.failure === null ? last.answerText : `It failed: ${last?.failure ?? "no answer"}`;
      if (input.reportToSessionId !== null) {
        await this.sessions.send(
          input.reportToSessionId,
          `[Project work finished: ${project.id}, clone ${clone.name}, chat ${session.id}]\n\n${result}`,
        );
      }
    });
    return session;
  }

  /** The clones of a project, with their branch and pull request. */
  async clones(projectId: string): Promise<CloneDetails[]> {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${projectId} in the vault.`);
    return Promise.all(
      listClones(project.path).map((clone) => describeClone(clone, this.options.runner, this.gitEnvironment)),
    );
  }

  publicSettings(): PublicSettings {
    const secrets = this.options.secrets;
    return {
      config: this.options.config,
      secretsSet: {
        telegramBotToken: secrets.telegramBotToken !== undefined,
        claudeOauthToken: secrets.claudeOauthToken !== undefined,
        githubToken: secrets.githubToken !== undefined,
        localApiToken: secrets.localApiToken !== undefined,
      },
    };
  }

  /** Checks and saves a settings change. The running instance keeps its settings until a restart. */
  updateSettings(patch: Readonly<Record<string, unknown>>): { saved: true; restartNeeded: true } {
    const merged: Record<string, unknown> = { ...this.options.config };
    for (const [key, value] of Object.entries(patch)) {
      const current = merged[key];
      merged[key] =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        current !== null &&
        typeof current === "object"
          ? { ...current, ...value }
          : value;
    }
    saveConfig(this.options.paths, parseConfig(merged, "The settings change"));
    return { saved: true, restartNeeded: true };
  }

  runCheck(name: CheckName): Promise<CheckResult> {
    return runCheck(name, {
      vaultPath: this.options.config.vaultPath,
      runner: this.options.runner,
      environment: this.gitEnvironment,
      claudeExecutable: this.options.claudeExecutable ?? null,
      telegramToken: this.options.secrets.telegramBotToken ?? null,
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
      const busy =
        this.reservedClones.has(clone.path) ||
        this.sessions.list().some((session) => session.startFolder === clone.path && this.sessions.isBusy(session.id));
      if (!busy && (await this.isClean(clone.path))) return clone;
    }
    return this.newClone(project.id);
  }

  private async isClean(folder: string): Promise<boolean> {
    const result = await this.options.runner.run(["git", "status", "--porcelain"], {
      cwd: folder,
      environment: { ...this.gitEnvironment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: gitStatusTimeoutMs,
    });
    return result.exitCode === 0 && result.stdout.trim().length === 0;
  }

  private requireVault(): string {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) throw new EvaError("vault_not_found", "No vault is configured. Run `eva setup`.");
    return vaultPath;
  }

  /** Runs a task that nobody awaits, and logs its failure instead of losing it (lesson 50). */
  private inBackground(what: string, task: () => Promise<unknown>): void {
    task().catch((error: unknown) => {
      this.options.logger?.log("error", `${what} failed.`, {
        reason: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    });
  }

  /** Logs a sync problem and the files that the secret scan held back (lessons 16, 26). */
  private logSyncState(state: VaultSyncState): VaultSyncState {
    if (state.status === "conflict" || state.status === "error" || state.status === "offline") {
      this.options.logger?.log(state.status === "offline" ? "warn" : "error", "Vault sync failed.", {
        status: state.status,
        reason: state.lastError,
      });
    }
    if (state.withheldFiles.length > 0) {
      this.options.logger?.log("warn", "Vault sync held back files that look like secrets.", {
        files: state.withheldFiles,
      });
    }
    return state;
  }

  private assistantMcpServers(): Record<string, McpServerSpec> {
    const google = googleMcpServer({
      config: this.options.config.google,
      secrets: this.options.secrets,
      credentialsFolder: join(this.options.paths.enginesFolder, "google"),
      environment: this.gitEnvironment,
    });
    return google === null ? {} : { google };
  }

  /** The folder of the `eva` scripts for agents, or null when Eva does not know her own command. */
  private writeEvaScripts(): string | null {
    const command = this.options.evaCommand ?? null;
    if (command === null || command.length === 0) return null;
    const folder = join(this.options.paths.root, "bin");
    writeEvaScriptFiles(folder, command);
    return folder;
  }

  /** The engine's environment: the allowlist, the Claude token, and an own config folder when asked (plan §4.4). */
  private engineEnvironment(): Record<string, string> {
    const extra: Record<string, string> = { EVA_HOME: this.options.paths.root };
    const scripts = this.writeEvaScripts();
    if (scripts !== null) {
      // The agent finds `eva` first, so `eva work` reaches this instance.
      const path = this.options.processEnvironment["PATH"] ?? this.options.processEnvironment["Path"] ?? "";
      extra["PATH"] = `${scripts}${delimiter}${path}`;
    }
    const token = this.options.secrets.claudeOauthToken;
    if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    if (this.options.config.engines.claudeCode.ownConfigFolder) {
      extra["CLAUDE_CONFIG_DIR"] = join(this.options.paths.enginesFolder, "claude");
    }
    return buildChildEnvironment(this.options.processEnvironment, baseEnvironmentAllowlist, extra);
  }
}

/** Writes `eva` (for a POSIX shell and Git Bash) and `eva.cmd` into `<home>/bin`. */
function writeEvaScriptFiles(folder: string, command: readonly string[]): void {
  const shellQuote = (part: string): string => `'${part.replaceAll("'", "'\\''")}'`;
  writeFileAtomic(join(folder, "eva"), `#!/bin/sh\nexec ${command.map(shellQuote).join(" ")} "$@"\n`);
  chmodSync(join(folder, "eva"), 0o755);
  writeFileAtomic(join(folder, "eva.cmd"), `@${command.map((part) => `"${part}"`).join(" ")} %*\r\n`);
}

/** Through the process seam, so it has a timeout and tests can fake it (lessons 81, 102). */
async function readOriginUrl(
  folder: string,
  runner: ProcessRunner,
  environment: Record<string, string>,
): Promise<string | null> {
  const result = await runner.run(["git", "remote", "get-url", "origin"], {
    cwd: folder,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: gitStatusTimeoutMs,
  });
  const url = result.stdout.trim();
  return result.exitCode === 0 && url.length > 0 ? url : null;
}

/**
 * One Eva instance: the core that every front end talks to (docs/plan.md §4). It joins the
 * vault sync, the projects, the sessions and the two modes, and runs the idle sweep.
 */
import { chmodSync } from "node:fs";
import { hostname } from "node:os";
import { delimiter, join, resolve } from "node:path";
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
import type { EvaConfig, EvaSecrets, HomePaths } from "./instance/home.ts";
import { applySettingsChange, saveSettings } from "./instance/settings.ts";
import { claimHub, machineRole, readHubClaim, type MachineRole } from "./instance/hub.ts";
import type { RemoteAccess } from "./instance/machine-defaults.ts";
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
import { Updater, type UpdateChannel, type UpdateStatus } from "./updates/updater.ts";

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
  /** Deletes the log files past their retention; the background tick calls it once a day. */
  readonly removeOldLogs?: () => void;
  /**
   * The command that starts this Eva, such as `[bun, main.ts]` or `[eva.exe]`. Eva writes it as an
   * `eva` script that an agent can run, for `eva work` (plan §5.3). Null: no script.
   */
  readonly evaCommand?: readonly string[] | null;
  /** Where Eva's own updates come from. Null: no updates (plan §10). */
  readonly updateChannel?: UpdateChannel | null;
  /** Stops Eva after an update, so that the new version starts. */
  readonly restartForUpdate?: () => void;
  /** The web UI's address for the phone through Tailscale, now. Null: Tailscale does not run here. */
  readonly remoteAccess?: () => RemoteAccess | null;
  /**
   * The platform's default home folder. An instance with another home is an extra instance on
   * the same OS user, so its engines get their own config folders (plan §4.4, lesson 111).
   */
  readonly defaultHome?: string;
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
  readonly role: MachineRole;
  /** This machine's name, as `.eva/hub.json` names the hub. */
  readonly machine: string;
  /** The hub's machine name, or null before any machine claims it. */
  readonly hub: string | null;
  readonly vaultSync: VaultSyncState;
  readonly sessionCount: number;
  readonly busySessionIds: readonly string[];
  readonly lastTurn: LastTurnStatus | null;
  readonly update: UpdateStatus | null;
  readonly remoteAccess: RemoteAccess | null;
  /** The web UI on this machine only, which needs the token. */
  readonly localUrl: string;
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
/** The number of characters of a project answer that the report to the Assistant chat keeps. */
const reportTextLimit = 3_000;
const scheduleTickMs = 30_000;
const backgroundTickMs = 60_000;
const housekeepingIntervalMs = 24 * 60 * 60_000;
/** Settings that apply at once; any other change waits for a restart. */
const liveSettingKeys: readonly string[] = ["updates", "sync.pullIntervalMinutes"];
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
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private lastPullAt: Date | null = null;
  private settings: EvaConfig;
  private readonly updater: Updater | null;
  private readonly machine: string;
  private lastRole: MachineRole;
  private readonly roleListeners = new Set<(role: MachineRole) => void>();
  private lastTurn: LastTurnStatus | null = null;
  /** Clones that project work has taken, so two chats never get the same working tree (lesson 49). */
  private readonly reservedClones = new Set<string>();
  /** A slow git step can outlast a timer period; these flags keep each task from running twice at once. */
  private sweeping: boolean;
  private backgroundTicking: boolean;
  private lastHousekeepingAt: Date | null;
  /** The last clone choice of each project, so the next choice waits for it (lesson 49). */
  private readonly cloneChoices = new Map<string, Promise<unknown>>();

  constructor(options: EvaOptions) {
    this.options = options;
    this.sweeping = false;
    this.backgroundTicking = false;
    this.lastHousekeepingAt = null;
    this.settings = options.config;
    this.machine = options.config.machineName ?? hostname();
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
      store: new SessionStore(options.paths.sessions, {
        now: options.now,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      }),
      preparers: {
        assistant: new AssistantPreparer({
          vaultPath: vaultPath ?? "",
          vaultSync:
            vaultSync === null
              ? { pull: () => Promise.resolve(noVaultState), save: () => Promise.resolve(noVaultState) }
              : {
                  pull: async () => {
                    this.lastPullAt = options.now();
                    return this.logSyncState(await vaultSync.pull());
                  },
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
            isHub: () => this.role() === "hub",
            now: options.now,
            chats: {
              createChat: (name, model) => this.createAssistantSession({ source: "schedule", model, title: name }).id,
              send: (sessionId, prompt) => this.sessions.send(sessionId, prompt),
            },
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });

    this.lastRole = this.role();
    const channel = options.updateChannel ?? null;
    this.updater =
      channel === null
        ? null
        : new Updater({
            channel,
            frequency: () => this.settings.updates.frequency,
            isIdle: () => !this.sessions.list().some((session) => this.sessions.isBusy(session.id)),
            restart: options.restartForUpdate ?? ((): void => undefined),
            now: options.now,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
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
    this.backgroundTimer ??= setInterval(() => {
      this.inBackground("The vault fetch and the update check", () => this.backgroundTick());
    }, backgroundTickMs);
  }

  /**
   * Once a minute: fetches the vault and checks for updates, each at the pace that the settings
   * ask for, and cleans up old files once a day.
   */
  async backgroundTick(): Promise<void> {
    if (this.backgroundTicking) return;
    this.backgroundTicking = true;
    try {
      await this.pullIfDue();
      this.noticeRoleChange();
      this.cleanUpIfDue();
      await this.updater?.tick();
    } finally {
      this.backgroundTicking = false;
    }
  }

  /** "hub" when this machine runs Telegram and the schedules (plan §4.4). */
  role(): MachineRole {
    return machineRole(this.options.config.vaultPath, this.machine);
  }

  /** Calls the listener when this machine becomes the hub or stops being it. Returns an unsubscribe. */
  onRoleChange(listener: (role: MachineRole) => void): () => void {
    this.roleListeners.add(listener);
    return () => {
      this.roleListeners.delete(listener);
    };
  }

  /** "Make this machine the hub": writes the claim, and pushes it so the old hub sees it at its next fetch. */
  async becomeHub(): Promise<EvaStatus> {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath !== null && readHubClaim(vaultPath)?.machine !== this.machine) {
      claimHub(vaultPath, this.machine, this.options.now());
      this.options.logger?.log("info", "This machine is now the hub.", { machine: this.machine });
      await this.syncVault();
    }
    this.noticeRoleChange();
    return this.status();
  }

  /** "Sync now": brings the remote's changes in, then commits and pushes this machine's changes. */
  async syncVault(): Promise<VaultSyncState> {
    if (this.vaultSync === null) return noVaultState;
    if (this.assistantBusy())
      return {
        ...this.vaultSync.currentState,
        status: "skipped",
        lastError: "Eva is working in an Assistant chat. Sync again when it ends.",
      };
    this.lastPullAt = this.options.now();
    this.logSyncState(await this.vaultSync.pull());
    return this.logSyncState(await this.vaultSync.save());
  }

  updateStatus(): UpdateStatus | null {
    return this.updater?.status() ?? null;
  }

  async checkForUpdate(): Promise<UpdateStatus | null> {
    return (await this.updater?.check()) ?? null;
  }

  /** Installs a newer version as soon as no chat runs a turn, then restarts. */
  async updateNow(): Promise<UpdateStatus | null> {
    return (await this.updater?.updateNow()) ?? null;
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
    if (this.backgroundTimer !== null) clearInterval(this.backgroundTimer);
    this.sweepTimer = null;
    this.scheduleTimer = null;
    this.backgroundTimer = null;
  }

  /** Saves changes made outside a turn. It never runs during an Assistant turn (lessons 22, 30). */
  async sweep(): Promise<VaultSyncState["status"]> {
    if (this.vaultSync === null || this.sweeping || this.assistantBusy()) return "skipped";
    this.sweeping = true;
    try {
      return this.logSyncState(await this.vaultSync.save()).status;
    } finally {
      this.sweeping = false;
    }
  }

  status(): EvaStatus {
    const sessions = this.sessions.list();
    return {
      version: evaVersion,
      vaultPath: this.options.config.vaultPath,
      role: this.role(),
      machine: this.machine,
      hub:
        this.options.config.vaultPath === null
          ? this.machine
          : (readHubClaim(this.options.config.vaultPath)?.machine ?? null),
      vaultSync: this.vaultSync?.currentState ?? noVaultState,
      sessionCount: sessions.length,
      busySessionIds: sessions.filter((session) => this.sessions.isBusy(session.id)).map((session) => session.id),
      lastTurn: this.lastTurn,
      update: this.updateStatus(),
      remoteAccess: this.options.remoteAccess?.() ?? null,
      localUrl: `http://127.0.0.1:${String(this.options.config.port)}`,
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
        ? await this.oneCloneChoiceAtATime(project, () => this.freeOrNewClone(project))
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
    // The reservation happens inside the choice, so a second work cannot pick the same clone.
    const clone = await this.oneCloneChoiceAtATime(project, async () => {
      const chosen = await this.freeOrNewClone(project);
      this.reservedClones.add(chosen.path);
      return chosen;
    });
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
      if (input.reportToSessionId === null) return;
      const last = this.sessions.get(session.id).turns.at(-1);
      const result = last?.failure === null ? last.answerText : `It failed: ${last?.failure ?? "no answer"}`;
      const details = await describeClone(clone, this.options.runner, this.gitEnvironment);
      const place = [
        `clone ${clone.name}`,
        ...(details.branch === null ? [] : [`branch ${details.branch}`]),
        ...(details.pullRequest === null ? [] : [`pull request #${String(details.pullRequest)}`]),
      ].join(", ");
      await this.sessions.send(
        input.reportToSessionId,
        `[Project work finished: ${project.id}, ${place}, chat ${session.id}]\n\n${capReportText(result)}`,
      );
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
      config: this.settings,
      secretsSet: {
        telegramBotToken: secrets.telegramBotToken !== undefined,
        claudeOauthToken: secrets.claudeOauthToken !== undefined,
        githubToken: secrets.githubToken !== undefined,
        localApiToken: secrets.localApiToken !== undefined,
      },
    };
  }

  /**
   * Checks and saves a settings change: the person's part in the vault, the machine's part in
   * `config.json`. The update frequency and the vault fetch apply at once; the rest at a restart.
   */
  updateSettings(patch: Readonly<Record<string, unknown>>): { saved: true; restartNeeded: boolean } {
    const changed = applySettingsChange(this.settings, patch);
    saveSettings(this.options.paths, changed);
    this.settings = changed;
    const restartNeeded = changedKeys(patch, "").some(
      (key) => !liveSettingKeys.some((live) => key === live || key.startsWith(`${live}.`)),
    );
    return { saved: true, restartNeeded };
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
    return this.oneCloneChoiceAtATime(project, () => this.cloneInto(project, repositoryUrl));
  }

  private async cloneInto(project: Project, repositoryUrl?: string): Promise<Clone> {
    const url = repositoryUrl ?? project.frontMatter.repos[0];
    if (url === undefined)
      throw new EvaError("project_not_found", `Project ${project.id} lists no repository to clone.`);
    return createClone({
      projectPath: project.path,
      repositoryUrl: url,
      runner: this.options.runner,
      environment: this.gitEnvironment,
    });
  }

  /** Call it only inside `oneCloneChoiceAtATime`, or two callers can get the same clone. */
  private async freeOrNewClone(project: Project): Promise<Clone> {
    for (const clone of listClones(project.path)) {
      const busy =
        this.reservedClones.has(clone.path) ||
        this.sessions.list().some((session) => session.startFolder === clone.path && this.sessions.isBusy(session.id));
      if (!busy && (await this.isClean(clone.path))) return clone;
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
  private async pullIfDue(): Promise<void> {
    const minutes = this.settings.sync.pullIntervalMinutes;
    if (this.vaultSync === null || minutes === null || !this.settings.sync.enabled) return;
    const now = this.options.now();
    if (this.lastPullAt !== null && now.getTime() - this.lastPullAt.getTime() < minutes * 60_000) return;
    // A pull never changes the files under a running Assistant turn (lessons 22, 30).
    if (this.assistantBusy()) return;
    this.lastPullAt = now;
    this.logSyncState(await this.vaultSync.pull());
  }

  /**
   * Removes old logs and Scratch files once a day (plan §9), with or without vault sync. It waits
   * for the end of an Assistant turn, so a file never goes away under a running agent (lessons 22, 30).
   */
  private cleanUpIfDue(): void {
    const now = this.options.now();
    if (this.lastHousekeepingAt !== null && now.getTime() - this.lastHousekeepingAt.getTime() < housekeepingIntervalMs)
      return;
    if (this.assistantBusy()) return;
    this.lastHousekeepingAt = now;
    this.options.removeOldLogs?.();
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath !== null) cleanScratch(vaultPath, now);
  }

  private noticeRoleChange(): void {
    const role = this.role();
    if (role === this.lastRole) return;
    this.lastRole = role;
    this.options.logger?.log(
      "info",
      role === "hub" ? "This machine became the hub." : "Another machine is now the hub.",
    );
    for (const listener of this.roleListeners) listener(role);
  }

  private assistantBusy(): boolean {
    return this.sessions.list().some((session) => session.mode === "assistant" && this.sessions.isBusy(session.id));
  }

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

  /** The engine's environment: the allowlist, the Claude token, and own config folders for an extra instance (plan §4.4). */
  private engineEnvironment(): Record<string, string> {
    const defaultHome = this.options.defaultHome;
    const isExtraInstance = defaultHome !== undefined && resolve(defaultHome) !== resolve(this.options.paths.root);
    const extra: Record<string, string> = { EVA_HOME: this.options.paths.root };
    const scripts = this.writeEvaScripts();
    if (scripts !== null) {
      // The agent finds `eva` first, so `eva work` reaches this instance.
      const path = this.options.processEnvironment["PATH"] ?? this.options.processEnvironment["Path"] ?? "";
      extra["PATH"] = `${scripts}${delimiter}${path}`;
    }
    const token = this.options.secrets.claudeOauthToken;
    if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    if (isExtraInstance || this.options.config.engines.claudeCode.ownConfigFolder) {
      extra["CLAUDE_CONFIG_DIR"] = join(this.options.paths.enginesFolder, "claude");
    }
    // pi's folder is left out on purpose: pi has no documented variable for it yet.
    if (isExtraInstance) extra["GH_CONFIG_DIR"] = join(this.options.paths.enginesFolder, "gh");
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

/** Keeps the end of a long project answer: the end usually holds the result, and a phone chat stays short. */
function capReportText(text: string): string {
  if (text.length <= reportTextLimit) return text;
  return `(The answer is longer. The full answer is in the project chat.)\n\n…${text.slice(-reportTextLimit)}`;
}

/** The dotted keys that a settings change touches, such as `updates.frequency`. */
function changedKeys(change: unknown, prefix: string): string[] {
  if (change === null || typeof change !== "object" || Array.isArray(change)) return [prefix];
  return Object.entries(change).flatMap(([key, value]) => changedKeys(value, prefix === "" ? key : `${prefix}.${key}`));
}

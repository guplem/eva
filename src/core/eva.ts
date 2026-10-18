/**
 * One Eva instance: the core that every front end talks to. It joins the
 * vault sync, the projects, the sessions and the two modes, and runs the idle sweep.
 */
import { chmodSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { delimiter, join } from "node:path";
import { readTextTolerant, writeFileAtomic } from "../shared/files.ts";
import type { EngineName, EnginePort, McpServerSpec, ModelAlias } from "../shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../shared/environment.ts";
import { EvaError, isEvaError } from "../shared/errors.ts";
import { readRecentLogEntries, type LogEntry, type Logger, type RecentLogQuery } from "../shared/logger.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import type { TurnUsage } from "../shared/events.ts";
import { Redactor } from "../shared/redaction.ts";
import { evaRepository, evaVersion } from "../shared/version.ts";
import { AlertCenter, type Alert, type AlertProblem } from "./alerts/alert-center.ts";
import {
  scheduleCardProblem,
  engineUpdateProblem,
  scheduleFiringProblem,
  uncleanExitMessage,
  updateProblem,
  vaultSyncProblem,
} from "./alerts/problem-rules.ts";
import { runCheck, type CheckName, type CheckResult } from "./checks.ts";
import { DeviceLogins } from "./remote-access/device-logins.ts";
import {
  engineFolders,
  engineFolderVariables,
  isExtraInstance,
  loadSecrets,
  saveSecrets,
  type EvaConfig,
  type EvaSecrets,
  type HomePaths,
} from "./settings/home.ts";
import { applySettingsChange, isPageSettingKey, loadSettings, saveSettings } from "./settings/settings.ts";
import { claimHub, machineRole, readHubClaim, type MachineRole } from "./instance/hub.ts";
import type { RemoteAccess } from "./remote-access/tailscale.ts";
import { AssistantPreparer } from "./modes/assistant-mode.ts";
import { ProjectPreparer } from "./modes/project-mode.ts";
import {
  CloneOriginStore,
  createClone,
  describeClone,
  githubSlug,
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
import { ghApiRequest, readRepositoryFacts, type GithubRequest } from "./projects/repository-facts.ts";
import {
  evaluateSetup,
  unreadableReport,
  type RepositoryFacts,
  type SetupReport,
} from "./projects/repository-setup.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { SessionStore, type SessionRecord } from "./sessions/session-store.ts";
import { VaultSync, type VaultSyncState } from "./vault/vault-sync.ts";
import { EngineUpdater, type EngineUpdateStatus } from "./updates/engine-update.ts";
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
  /** The claude program, for the engine update. Null: no engine update. */
  readonly claudeExecutable?: string | null;
  /** Where background failures and sync problems go (lessons 16, 50). */
  readonly logger?: Logger;
  /** Deletes the log files past their retention; the background tick calls it once a day. */
  readonly removeOldLogs?: () => void;
  /**
   * The command that starts this Eva, such as `[bun, main.ts]` or `[eva.exe]`. Eva writes it as an
   * `eva` script that an agent can run, for `eva work`. Null: no script.
   */
  readonly evaCommand?: readonly string[] | null;
  /** Where Eva's own updates come from. Null: no updates. */
  readonly updateChannel?: UpdateChannel | null;
  /** Stops Eva so that she starts again: after an update, and for a restart on request. */
  readonly restartForUpdate?: () => void;
  /** The web UI's address for the phone through Tailscale, now. Null: Tailscale does not run here. */
  readonly remoteAccess?: () => RemoteAccess | null;
  /**
   * The platform's default home folder. An instance with another home is an extra instance on
   * the same OS user, so its engines get their own config folders (lesson 111).
   */
  readonly defaultHome?: string;
  /** One GET of the GitHub API, for the setup report. Default: `gh api`. */
  readonly githubRequest?: GithubRequest;
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
  /** One line for each open problem; empty when all is good. */
  readonly problems: readonly string[];
}

export interface PublicSettings {
  readonly config: EvaConfig;
  /** Whether each secret is set. The values never leave the core. */
  readonly secretsSet: Readonly<
    Record<"telegramBotToken" | "claudeOauthToken" | "githubToken" | "localApiToken", boolean>
  >;
}

/** The secrets that the settings page may save. The local token and the Google keys stay with `eva setup`. */
export const pageSecretNames = ["githubToken", "telegramBotToken", "claudeOauthToken"] as const;
export type PageSecretName = (typeof pageSecretNames)[number];

/** What the Setup section shows beside the settings. */
export interface SetupState {
  /** The vault's `origin`, without any credentials in it. */
  readonly vaultRemote: string | null;
  readonly telegram: { readonly paired: boolean; readonly pairingCode: string | null };
  /** The engines whose program Eva found at start. */
  readonly engines: readonly EngineName[];
}

export interface NewChatInput {
  readonly source: SessionRecord["source"];
  readonly model: ModelAlias;
  /** The engine of this chat; without one, the configured default. */
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
/** The front end that asked for a restart answers first, then Eva stops. */
const restartDelayMs = 500;
const maxLogEntries = 100;
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
  /** The web UI's device logins, which the Telegram bot confirms. */
  readonly deviceLogins: DeviceLogins;
  private readonly options: EvaOptions;
  private readonly redactor: Redactor;
  private readonly vaultSync: VaultSync | null;
  private readonly gitEnvironment: Record<string, string>;
  private readonly cloneOrigins: CloneOriginStore;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private lastPullAt: Date | null = null;
  private settings: EvaConfig;
  /** The saved secrets. A new value reaches the checks at once, and the rest at a restart. */
  private secrets: EvaSecrets;
  private readonly updater: Updater | null;
  /** Null when no claude program was found. */
  private readonly engineUpdater: EngineUpdater | null;
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
  private readonly alerts: AlertCenter;
  /** When the vault sync went offline, for the 30-minute alert; null while it is not offline. */
  private vaultOfflineSince: Date | null;

  constructor(options: EvaOptions) {
    this.options = options;
    this.sweeping = false;
    this.backgroundTicking = false;
    this.lastHousekeepingAt = null;
    this.vaultOfflineSince = null;
    this.settings = options.config;
    this.cloneOrigins = new CloneOriginStore(options.paths.cloneOrigins);
    this.machine = options.config.machineName ?? hostname();
    const vaultPath = options.config.vaultPath;
    this.secrets = options.secrets;
    this.gitEnvironment = gitEnvironmentOf(options, options.secrets);
    this.vaultSync =
      vaultPath === null
        ? null
        : new VaultSync({
            vaultPath,
            runner: options.runner,
            environment: this.gitEnvironment,
            now: options.now,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });

    const redactor = new Redactor();
    for (const secret of Object.values(options.secrets)) redactor.addSecret(secret);
    this.alerts = new AlertCenter({
      now: options.now,
      redactor,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.redactor = redactor;
    this.deviceLogins = new DeviceLogins({ path: options.paths.devices, now: options.now });
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
          cloneOrigins: this.cloneOrigins,
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
            reportFiring: (schedule, failure) => {
              this.alerts.report(
                `schedule:${schedule.id}`,
                failure === null ? null : scheduleFiringProblem(schedule.name, failure),
              );
            },
            reportCard: (scheduleId, name, waiting) => {
              // Its own key: a good firing clears `schedule:<id>`, but must not clear this one.
              this.alerts.report(`schedule_card:${scheduleId}`, waiting ? scheduleCardProblem(name) : null);
            },
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });

    // A broken claim at start may hide another hub; a satellite never starts a second Telegram bot.
    this.lastRole = machineRole(options.config.vaultPath, this.machine, "satellite");
    const channel = options.updateChannel ?? null;
    this.updater =
      channel === null
        ? null
        : new Updater({
            channel,
            frequency: () => this.settings.updates.frequency,
            // A waiting engine update runs first: the restart would lose it, as it lives in memory.
            isIdle: () => !this.workRuns() && this.engineUpdater?.status().phase !== "waiting_for_idle",
            restart: options.restartForUpdate ?? ((): void => undefined),
            now: options.now,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });
    const claudeExecutable = options.claudeExecutable ?? null;
    this.engineUpdater =
      claudeExecutable === null
        ? null
        : new EngineUpdater({
            executable: claudeExecutable,
            runner: options.runner,
            environment: this.engineToolEnvironment(),
            // A restart would cut `claude update` off, so it waits for Eva's own download. Once the
            // new version is in place, her restart waits for this update instead.
            isIdle: () => !this.workRuns() && !this.downloadsOwnUpdate(),
            now: options.now,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });
  }

  /** Starts the idle sweep and the schedule checks. */
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
      // The engine update starts first, so Eva's own update sees it and waits. It runs apart:
      // its download can take minutes, and the next ticks must still fetch the vault.
      const engineUpdater = this.engineUpdater;
      if (engineUpdater !== null) this.runEngineUpdate(() => engineUpdater.tick());
      await this.updater?.tick();
      this.noticeUpdateProblem();
    } finally {
      this.backgroundTicking = false;
    }
  }

  /** "hub" when this machine runs Telegram and the schedules. */
  role(): MachineRole {
    return machineRole(this.options.config.vaultPath, this.machine, this.lastRole);
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
    const status = (await this.updater?.check()) ?? null;
    this.noticeUpdateProblem();
    return status;
  }

  /** Installs a newer version as soon as no chat runs a turn, then restarts. */
  async updateNow(): Promise<UpdateStatus | null> {
    const status = (await this.updater?.updateNow()) ?? null;
    this.noticeUpdateProblem();
    return status;
  }

  engineUpdateStatus(): EngineUpdateStatus | null {
    if (this.engineUpdater === null) return null;
    const status = this.engineUpdater.status();
    if (status.last === null) return status;
    // The detail is the output of `claude update`, which a page shows.
    const detail = status.last.detail === null ? null : this.redact(status.last.detail);
    return { ...status, last: { ...status.last, detail } };
  }

  /**
   * Starts `claude update` as soon as no chat runs a turn, and answers at once: the update can
   * outlast an HTTP request. Null when no claude program was found.
   */
  updateEngine(): EngineUpdateStatus | null {
    const updater = this.engineUpdater;
    if (updater === null) return null;
    this.runEngineUpdate(() => updater.updateNow());
    return this.engineUpdateStatus();
  }

  /**
   * Restarts Eva at once, through the same path as an update (exit code 4 under systemd, a new
   * copy elsewhere). A running turn stops; the front end asks the person to confirm first.
   */
  restart(): void {
    this.options.logger?.log("info", "Eva restarts on request.");
    setTimeout(() => {
      this.options.restartForUpdate?.();
    }, restartDelayMs);
  }

  /** Calls the listener with each alert. Returns an unsubscribe. */
  onAlert(listener: (alert: Alert) => Promise<void> | void): () => void {
    return this.alerts.onAlert(listener);
  }

  /** A front end reports a problem that only it can see, such as a Telegram poll that fails. */
  reportProblem(key: string, problem: AlertProblem | null): void {
    this.alerts.report(key, problem);
  }

  /** The start found the marker of a run that never stopped cleanly. */
  reportUncleanExit(): void {
    this.alerts.notify("unclean_exit", "warn", uncleanExitMessage);
  }

  /** The last warnings and errors of Eva's own log, at most 100. */
  recentLogs(query: RecentLogQuery): LogEntry[] {
    const limit = Math.min(Math.max(Math.floor(query.limit), 0), maxLogEntries);
    if (limit === 0) return [];
    return readRecentLogEntries(this.options.paths.logsFolder, { minimumLevel: query.minimumLevel, limit });
  }

  /** Resolves when no work runs (see `workRuns`), or after the timeout. */
  async idle(timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    while (this.workRuns()) {
      if (Date.now() - started > timeoutMs) return;
      await Bun.sleep(20);
    }
  }

  /**
   * True while a chat runs a turn or holds a gathered message, a schedule fires, or `claude
   * update` runs. A firing schedule has a moment between its new chat and its first message
   * (lesson 92). Eva's own update must not restart her during `claude update`.
   */
  private workRuns(): boolean {
    return (
      this.engineUpdater?.status().phase === "updating" ||
      this.schedules?.isFiring() === true ||
      this.sessions.list().some((session) => this.sessions.isActive(session.id))
    );
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

  /** Removes secrets from a text that leaves the core, such as an error message (lesson 95). */
  redact(text: string): string {
    return this.redactor.redact(text);
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
      problems: this.alerts.openProblems(),
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

  /** A Project chat in the named clone, or in a free clone, or in a new clone. */
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
   * Gives work to a project: a Project chat in a free clone runs the request, and its
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

  /**
   * The setup report of each repository of a project, judged against Eva's own repository.
   * A repository that Eva cannot read gets a report with only the reason.
   */
  async repositorySetup(projectId: string): Promise<SetupReport[]> {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${projectId} in the vault.`);
    if (project.frontMatter.repos.length === 0) return [];
    const request = this.options.githubRequest ?? ghApiRequest(this.options.runner, this.gitEnvironment);
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

  /** The clones of a project, with their branch and pull request. */
  async clones(projectId: string): Promise<CloneDetails[]> {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) throw new EvaError("project_not_found", `No project ${projectId} in the vault.`);
    return Promise.all(
      listClones(project.path).map((clone) => describeClone(clone, this.options.runner, this.gitEnvironment)),
    );
  }

  publicSettings(): PublicSettings {
    const secrets = this.secrets;
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
   * With `pageOnly`, for a device login, a machine or trust setting fails with `setting_forbidden`.
   */
  updateSettings(
    patch: Readonly<Record<string, unknown>>,
    options: { readonly pageOnly: boolean } = { pageOnly: false },
  ): { saved: true; restartNeeded: boolean } {
    const keys = changedKeys(patch, "");
    const forbidden = options.pageOnly ? keys.find((key) => !isPageSettingKey(key)) : undefined;
    if (forbidden !== undefined)
      throw new EvaError(
        "setting_forbidden",
        `A device login cannot change ${forbidden}. Change it on the machine with \`eva settings set\`.`,
      );
    const changed = applySettingsChange(this.savedSettings(), patch);
    saveSettings(this.options.paths, changed);
    this.settings = changed;
    const restartNeeded = keys.some(
      (key) => !liveSettingKeys.some((live) => key === live || key.startsWith(`${live}.`)),
    );
    return { saved: true, restartNeeded };
  }

  async setupState(): Promise<SetupState> {
    const vaultPath = this.options.config.vaultPath;
    const remote = vaultPath === null ? null : await readOriginUrl(vaultPath, this.options.runner, this.gitEnvironment);
    const pairedChat = this.savedSettings().telegram.allowedChatId;
    // Only a running bot reads the code, and it runs only with a token; an old file stays after a removal.
    const code =
      this.secrets.telegramBotToken === undefined
        ? ""
        : (readTextTolerant(this.options.paths.telegramPairingCode)?.trim() ?? "");
    return {
      vaultRemote: remote === null ? null : this.redactor.redact(remote.replace(/\/\/[^/@]*@/, "//")),
      telegram: { paired: pairedChat !== null, pairingCode: pairedChat === null && code !== "" ? code : null },
      engines: this.options.engines.map((engine) => engine.name),
    };
  }

  /**
   * Saves one secret that the settings page may change, or removes it with null. The value never
   * comes back. The git, engine and Telegram processes read the secrets at start, so a restart follows.
   */
  saveSecret(
    name: PageSecretName,
    value: string | null,
    options: { readonly pageOnly: boolean } = { pageOnly: false },
  ): { saved: true; restartNeeded: true } {
    // A token decides whose account Eva uses, so a lost phone with a device login must not swap it.
    if (options.pageOnly)
      throw new EvaError("setting_forbidden", "A device login cannot change a token. Log in with the token instead.");
    const trimmed = value?.trim() ?? null;
    if (trimmed === "") throw new EvaError("config_invalid", "A secret cannot be empty. Remove it instead.");
    // Before anything else, so the value never reaches a log or an error unredacted.
    if (trimmed !== null) this.redactor.addSecret(trimmed);
    // From the file, so a secret that `eva setup` saved meanwhile stays.
    const secrets: EvaSecrets = { ...loadSecrets(this.options.paths) };
    if (trimmed === null) Reflect.deleteProperty(secrets, name);
    else secrets[name] = trimmed;
    saveSecrets(this.options.paths, secrets);
    this.secrets = secrets;
    return { saved: true, restartNeeded: true };
  }

  /**
   * The settings as saved now. The Telegram bot saves a new pairing to `config.json` while Eva
   * runs, so a change built on memory would undo it. A missing or bad file falls back to memory:
   * with a broken vault file, the loaded copy holds defaults, and a save would sync them everywhere.
   */
  private savedSettings(): EvaConfig {
    if (!existsSync(this.options.paths.config)) return this.settings;
    try {
      const loaded = loadSettings(this.options.paths);
      return loaded.problem === null ? loaded.config : this.settings;
    } catch {
      return this.settings;
    }
  }

  runCheck(name: CheckName): Promise<CheckResult> {
    return runCheck(name, {
      vaultPath: this.options.config.vaultPath,
      runner: this.options.runner,
      environment: gitEnvironmentOf(this.options, this.secrets),
      engines: this.options.engines,
      // A real turn needs the engine's login, as a chat has it; never the GitHub token (lesson 96).
      engineEnvironment: this.engineEnvironment(),
      redact: (text) => this.redactor.redact(text),
      telegramToken: this.secrets.telegramBotToken ?? null,
      githubToken: this.secrets.githubToken ?? null,
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
      origins: this.cloneOrigins,
    });
  }

  /** Call it only inside `oneCloneChoiceAtATime`, or two callers can get the same clone. */
  private async freeOrNewClone(project: Project): Promise<Clone> {
    // A clone with a record goes first: one with none asks a trust question, and work may run with nobody to answer it.
    const clones = listClones(project.path);
    const recorded = clones.filter((clone) => {
      const kind = this.cloneOrigins.origin(clone.path)?.kind;
      return kind === "cloned" || kind === "answered";
    });
    for (const clone of [...recorded, ...clones.filter((clone) => !recorded.includes(clone))]) {
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
   * Removes old logs and Scratch files once a day, with or without vault sync. It waits
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

  private downloadsOwnUpdate(): boolean {
    return this.updater?.status().phase === "updating";
  }

  /**
   * Runs one step of the engine update apart, then reports its result, so a failure reaches the
   * phone also when the page has stopped asking.
   */
  private runEngineUpdate(step: () => Promise<unknown>): void {
    const previous = this.engineUpdater?.status().last ?? null;
    this.inBackground("The engine update", async () => {
      await step();
      // A step that ran nothing keeps the old result; reporting it again would repeat its alert.
      const last = this.engineUpdater?.status().last ?? null;
      if (last !== null && last !== previous) this.alerts.report("engine_update", engineUpdateProblem(last));
    });
  }

  private noticeUpdateProblem(): void {
    const status = this.updater?.status();
    if (status !== undefined) this.alerts.report("update", updateProblem(status));
  }

  private noticeSyncProblem(state: VaultSyncState): void {
    const now = this.options.now();
    if (state.status !== "offline") this.vaultOfflineSince = null;
    else this.vaultOfflineSince ??= now;
    const offlineForMs = this.vaultOfflineSince === null ? 0 : now.getTime() - this.vaultOfflineSince.getTime();
    const problem = vaultSyncProblem(state, offlineForMs);
    if (problem !== "keep") this.alerts.report("vault_sync", problem);
  }

  /** Logs a sync problem and the files that the sync held back (lessons 16, 26), and raises its alert. */
  private logSyncState(state: VaultSyncState): VaultSyncState {
    this.noticeSyncProblem(state);
    if (state.status === "conflict" || state.status === "error" || state.status === "offline") {
      this.options.logger?.log(state.status === "offline" ? "warn" : "error", "Vault sync failed.", {
        status: state.status,
        reason: state.lastError,
      });
    }
    if (state.withheldFiles.length > 0) {
      this.options.logger?.log("warn", "Vault sync held back files that look like secrets or are too large.", {
        files: state.withheldFiles,
      });
    }
    return state;
  }

  private assistantMcpServers(): Record<string, McpServerSpec> {
    const google = googleMcpServer({
      config: this.options.config.google,
      secrets: this.secrets,
      credentialsFolder: join(this.options.paths.enginesFolder, "google"),
      // The agent's engine starts this server, so it gets no GitHub token (lesson 96).
      environment: buildChildEnvironment(this.options.processEnvironment, baseEnvironmentAllowlist),
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

  /**
   * The environment of Eva's own `claude` runs, such as `claude update`: the turns' config
   * folder, so the run acts on the same install, and no token, which such a run never needs.
   */
  private engineToolEnvironment(): Record<string, string> {
    const claudeFolder = this.claudeConfigFolder();
    return buildChildEnvironment(
      this.options.processEnvironment,
      baseEnvironmentAllowlist,
      claudeFolder === null ? {} : { CLAUDE_CONFIG_DIR: claudeFolder },
    );
  }

  /** The instance's own Claude config folder, or null for the OS user's own one. */
  private claudeConfigFolder(): string | null {
    return this.isExtraInstance() || this.options.config.engines.claudeCode.ownConfigFolder
      ? engineFolders(this.options.paths).claude
      : null;
  }

  /** An instance whose home is not the platform default (lesson 111). */
  private isExtraInstance(): boolean {
    return isExtraInstance(this.options.paths, this.options.defaultHome);
  }

  /** The engine's environment: the allowlist, the Claude token, and own config folders for an extra instance. */
  private engineEnvironment(): Record<string, string> {
    const extra: Record<string, string> = {
      ...(this.isExtraInstance() ? engineFolderVariables(engineFolders(this.options.paths)) : {}),
      EVA_HOME: this.options.paths.root,
    };
    const scripts = this.writeEvaScripts();
    if (scripts !== null) {
      // The agent finds `eva` first, so `eva work` reaches this instance.
      const path = this.options.processEnvironment["PATH"] ?? this.options.processEnvironment["Path"] ?? "";
      extra["PATH"] = `${scripts}${delimiter}${path}`;
    }
    const token = this.secrets.claudeOauthToken;
    if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    const claudeFolder = this.claudeConfigFolder();
    if (claudeFolder !== null) extra["CLAUDE_CONFIG_DIR"] = claudeFolder;
    return buildChildEnvironment(this.options.processEnvironment, baseEnvironmentAllowlist, extra);
  }
}

/** Only Eva's own git commands get the GitHub token; an agent's environment never does (lesson 96). */
function gitEnvironmentOf(options: EvaOptions, secrets: EvaSecrets): Record<string, string> {
  const token = secrets.githubToken;
  return buildChildEnvironment(options.processEnvironment, baseEnvironmentAllowlist, {
    // Eva's own `gh` calls (the GitHub check, pull requests) use this instance's login too.
    ...(isExtraInstance(options.paths, options.defaultHome) ? { GH_CONFIG_DIR: engineFolders(options.paths).gh } : {}),
    ...(token === undefined ? {} : { [githubTokenVariable]: token }),
  });
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

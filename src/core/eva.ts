/**
 * One Eva instance: the core that every front end talks to. It joins the vault sync, the
 * projects, the sessions, the settings and the two modes, and runs the background work.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import type { EnginePort, McpServerSpec } from "../shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../shared/environment.ts";
import { EvaError } from "../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../shared/files.ts";
import { readRecentLogEntries, type LogEntry, type Logger, type RecentLogQuery } from "../shared/logger.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import type { TurnUsage } from "../shared/events.ts";
import { Redactor } from "../shared/redaction.ts";
import { evaVersion } from "../shared/version.ts";
import { AlertCenter, type Alert, type AlertProblem } from "./alerts/alert-center.ts";
import {
  scheduleCardProblem,
  engineUpdateProblem,
  heldBackNews,
  machineAheadMessage,
  migrationFailedMessage,
  scheduleFiringProblem,
  uncleanExitMessage,
  updateProblem,
  relayedProblem,
  vaultAheadProblem,
} from "./alerts/problem-rules.ts";
import { machineReportFile, readMachineReports, writeMachineReport } from "./alerts/machine-reports.ts";
import { runMigrations, type MigrationRun, type MigrationStore } from "./migrations/migration-runner.ts";
import { migrations, vaultAhead, type StartMigrations } from "./migrations/migrations.ts";
import { runCheck, type CheckName, type CheckResult } from "./checks.ts";
import { DeviceLogins } from "./remote-access/device-logins.ts";
import { engineFolders, type EvaConfig, type EvaSecrets, type HomePaths } from "./settings/home.ts";
import {
  LiveSettings,
  pageSecretNames,
  type PageSecretName,
  type PublicSettings,
  type SetupState,
} from "./settings/live-settings.ts";
import {
  engineEnvironment,
  engineToolEnvironment,
  gitEnvironment,
  type InstanceFacts,
} from "./instance/child-environments.ts";
import { claudeLoggedIn, piLoginState } from "./setup/logins.ts";
import { missingSteps, setupProgress, type CheckRecord, type ProgressStep } from "./setup/progress.ts";
import { claimHub, machineRole, readHubClaim, type MachineRole } from "./instance/hub.ts";
import type { RemoteAccess, RemoteAccessControl } from "./remote-access/remote-access.ts";
import { AssistantPreparer } from "./modes/assistant-mode.ts";
import { ProjectPreparer } from "./modes/project-mode.ts";
import { CloneOriginStore, readOriginUrl, TrustStore, type Clone, type CloneDetails } from "./projects/clones.ts";
import {
  ProjectWork,
  type NewChatInput,
  type NewProjectChatInput,
  type ProjectWorkInput,
} from "./projects/project-work.ts";
import { Scheduler } from "./schedules/scheduler.ts";
import { cleanScratch } from "./files/vault-files.ts";
import { googleMcpServer } from "./google/google-mcp.ts";
import { GoogleLogin, googleCredentialsFolder } from "./google/google-login.ts";
import { googleScopes } from "./google/google-scopes.ts";
import { googleStep } from "./google/google-steps.ts";
import { createTranscriber, type Transcribe } from "./voice/transcriber.ts";
import { discoverProjects, searchProjects, type Project, type ProjectQuery } from "./projects/project-catalog.ts";
import type { GithubRequest } from "./projects/repository-facts.ts";
import type { SetupReport } from "./projects/repository-setup.ts";
import type { ProjectDetails, ProjectFile } from "./projects/project-file.ts";
import { ChatNamer } from "./sessions/chat-namer.ts";
import { SessionManager, type FirstTurn } from "./sessions/session-manager.ts";
import { ModelCalls } from "./model-calls/model-calls.ts";
import { SessionStore, type SessionRecord } from "./sessions/session-store.ts";
import {
  type ConflictChoice,
  type ConflictResolution,
  VaultSync,
  type VaultConflictReport,
  type VaultSyncState,
} from "./vault/vault-sync.ts";
import { VaultUpkeep } from "./vault/vault-upkeep.ts";
import { EngineUpdater, type EngineUpdateStatus } from "./updates/engine-update.ts";
import { isNewerVersion } from "./updates/release-verification.ts";
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
  /** Phone access through Tailscale, such as the RemoteAccessWatcher. Null: `tailscaleServe` is off. */
  readonly remoteAccess?: RemoteAccessControl | null;
  /** One GET of the GitHub API, for the setup report. Default: `gh api`. */
  readonly githubRequest?: GithubRequest;
  /** Google's address for the Google login and check; a test points it at a fake server. */
  readonly googleBaseUrl?: string;
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
  /** How many setup steps still need the person; the Settings page lists them. */
  readonly setupMissing: number;
}

/** The Setup section: the settings' state, and the progress list. */
export interface EvaSetupState extends SetupState {
  readonly progress: readonly ProgressStep[];
  /** True when the files hold a token that Eva does not use yet, such as one that `eva setup` saved. */
  readonly restartNeeded: boolean;
}

const approvalTimeoutMs = 10 * 60_000;
/** A turn may run long (a big refactor), but never for ever. */
const turnTimeoutMs = 2 * 60 * 60_000;
const scheduleTickMs = 30_000;
/** A cold start of an engine and one short answer. */
const modelCallTimeoutMs = 90_000;
const backgroundTickMs = 60_000;
const housekeepingIntervalMs = 24 * 60 * 60_000;
/** The front end that asked for a restart answers first, then Eva stops. */
const restartDelayMs = 500;
const maxLogEntries = 100;

export class Eva {
  readonly sessions: SessionManager;
  /** Null when no vault is configured. */
  readonly schedules: Scheduler | null;
  /** The person's rules for chat names. Null when no vault is configured. */
  readonly chatNames: ChatNamer | null;
  /** One question to a model with one answer, for any feature that needs a short text. */
  readonly modelCalls: ModelCalls;
  /** Null until a whisper model is configured. */
  readonly transcribe: Transcribe | null;
  /** The web UI's device logins, which the Telegram bot confirms. */
  readonly deviceLogins: DeviceLogins;
  private readonly googleLogin: GoogleLogin;
  private readonly options: EvaOptions;
  private readonly redactor: Redactor;
  /** The last result of each Test since the start. A restart clears them: the tokens may have changed. */
  private readonly checkResults: Map<CheckName, CheckRecord>;
  private readonly facts: InstanceFacts;
  private readonly vault: VaultUpkeep;
  private readonly settings: LiveSettings;
  private readonly projectWork: ProjectWork;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private readonly updater: Updater | null;
  /** Null when no claude program was found. */
  private readonly engineUpdater: EngineUpdater | null;
  private readonly machine: string;
  private lastRole: MachineRole;
  private readonly roleListeners = new Set<(role: MachineRole) => void>();
  private lastTurn: LastTurnStatus | null = null;
  /** A slow git step can outlast a timer period; this flag keeps the tick from running twice at once. */
  private backgroundTicking: boolean;
  private lastHousekeepingAt: Date | null;
  private readonly alerts: AlertCenter;
  /** The keys of the problems that this hub relays now, by report file. */
  private relayed = new Map<string, ReadonlySet<string>>();
  private reportNameTaken = false;

  constructor(options: EvaOptions) {
    this.options = options;
    this.backgroundTicking = false;
    this.lastHousekeepingAt = null;
    this.machine = options.config.machineName ?? hostname();
    const vaultPath = options.config.vaultPath;
    this.facts = {
      paths: options.paths,
      processEnvironment: options.processEnvironment,
      ...(options.evaCommand === undefined ? {} : { evaCommand: options.evaCommand }),
    };
    const ownGitEnvironment = gitEnvironment(this.facts, options.secrets);

    const redactor = new Redactor();
    for (const secret of Object.values(options.secrets)) redactor.addSecret(secret);
    this.alerts = new AlertCenter({
      now: options.now,
      redactor,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.redactor = redactor;
    this.vault = new VaultUpkeep({
      vaultSync:
        vaultPath === null
          ? null
          : new VaultSync({
              vaultPath,
              runner: options.runner,
              environment: ownGitEnvironment,
              now: options.now,
              ...(options.logger === undefined ? {} : { logger: options.logger }),
            }),
      now: options.now,
      // The start value, as the sweep timer reads it: a change of the setting waits for a restart.
      syncEnabled: () => options.config.sync.enabled,
      assistantBusy: () => this.assistantBusy(),
      reportProblem: (problem) => {
        this.alerts.report("vault_sync", problem);
      },
      afterSync: () => {
        this.noticeVaultAhead();
        // A full disk or a reserved file name must not stop the sync step.
        try {
          this.exchangeMachineReports();
        } catch (error) {
          options.logger?.log("warn", "The machine report failed.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.settings = new LiveSettings({
      paths: options.paths,
      config: options.config,
      secrets: options.secrets,
      redactor,
      readVaultRemote: () =>
        vaultPath === null ? Promise.resolve(null) : readOriginUrl(vaultPath, options.runner, ownGitEnvironment),
      engines: options.engines.map((engine) => engine.name),
    });
    this.deviceLogins = new DeviceLogins({ path: options.paths.devices, now: options.now });
    this.checkResults = new Map();
    this.googleLogin = new GoogleLogin({
      credentialsFolder: googleCredentialsFolder(options.paths),
      now: options.now,
      ...(options.googleBaseUrl === undefined ? {} : { baseUrl: options.googleBaseUrl }),
    });
    const agentEnvironment = engineEnvironment(this.facts, options.secrets);
    const cloneOrigins = new CloneOriginStore(options.paths.cloneOrigins);
    this.modelCalls = new ModelCalls({
      engines: options.engines,
      environment: agentEnvironment,
      redact: (text) => redactor.redact(text),
      timeoutMs: modelCallTimeoutMs,
    });
    const chatNamer =
      vaultPath === null
        ? null
        : new ChatNamer({
            vaultPath,
            modelCalls: this.modelCalls,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          });
    this.chatNames = chatNamer;

    this.sessions = new SessionManager({
      ...(chatNamer === null ? {} : { nameChat: (turn: FirstTurn) => chatNamer.name(turn) }),
      engines: options.engines,
      store: new SessionStore(options.paths.sessions, {
        now: options.now,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      }),
      preparers: {
        assistant: new AssistantPreparer({
          vaultPath: vaultPath ?? "",
          vaultSync: { pull: () => this.vault.pull(), save: () => this.vault.save() },
          basePrompt: options.basePrompt,
          runner: options.runner,
          environment: agentEnvironment,
          now: options.now,
          timeZone: options.config.timeZone ?? "UTC",
          mcpServers: this.assistantMcpServers(),
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        }),
        project: new ProjectPreparer({
          trustStore: new TrustStore(options.paths.trust),
          cloneOrigins,
          trustedOwners: options.config.trust.trustedRepositoryOwners,
          environment: agentEnvironment,
          readRemote: (folder) => readOriginUrl(folder, options.runner, ownGitEnvironment),
        }),
      },
      now: options.now,
      newId: () => crypto.randomUUID(),
      redactor,
      gatherMs: options.gatherMs ?? 1_000,
      approvalTimeoutMs,
      turnTimeoutMs,
    });
    this.projectWork = new ProjectWork({
      sessions: this.sessions,
      projects: () => this.projects(),
      defaultEngine: options.config.engines.default,
      runner: options.runner,
      gitEnvironment: ownGitEnvironment,
      cloneOrigins,
      inBackground: (what, task) => {
        this.inBackground(what, task);
      },
      ...(options.githubRequest === undefined ? {} : { githubRequest: options.githubRequest }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });

    const voice = options.config.voice;
    this.transcribe =
      voice.modelPath === null
        ? null
        : createTranscriber({
            tools: { ...voice, modelPath: voice.modelPath },
            runner: options.runner,
            environment: ownGitEnvironment,
            temporaryRoot: options.paths.stateFolder,
          });

    this.sessions.subscribe((event) => {
      if (event.kind === "turn_failed")
        options.logger?.log("warn", "A turn failed.", { sessionId: event.sessionId, reason: event.reason });
      if (event.kind !== "turn_finished") return;
      this.lastTurn = { ...event.usage, at: event.at, costUsd: event.costUsd };
      // The cache counts go in the log too, so a broken prompt cache shows (lesson 120).
      options.logger?.log("info", "A turn finished.", { sessionId: event.sessionId, ...event.usage });
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
              send: (sessionId, prompt) => this.sessions.send(sessionId, prompt, "schedule"),
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
            frequency: () => this.settings.config.updates.frequency,
            policy: () => this.settings.config.updates.install,
            requiredVersion: () => this.vaultNeeds(),
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
            environment: engineToolEnvironment(this.facts),
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
      await this.vault.pullIfDue(this.settings.config.sync);
      this.noticeRoleChange();
      this.cleanUpIfDue();
      // The engine update starts first, so Eva's own update sees it and waits. It runs apart:
      // its download can take minutes, and the next ticks must still fetch the vault.
      const engineUpdater = this.engineUpdater;
      if (engineUpdater !== null) this.runEngineUpdate(() => engineUpdater.tick());
      await this.updater?.tick();
      this.noticeUpdateState();
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
  syncVault(): Promise<VaultSyncState> {
    return this.vault.syncNow();
  }

  /** The vault notes that conflict now, so a phone can pick a version of each. */
  vaultConflicts(): Promise<VaultConflictReport> {
    return this.vault.conflicts();
  }

  /** A pick for one conflicted note; see `VaultUpkeep.resolve`. */
  resolveVaultConflict(path: string, choice: ConflictChoice): Promise<ConflictResolution> {
    return this.vault.resolve(path, choice);
  }

  updateStatus(): UpdateStatus | null {
    return this.updater?.status() ?? null;
  }

  async checkForUpdate(): Promise<UpdateStatus | null> {
    const status = (await this.updater?.check()) ?? null;
    this.noticeUpdateState();
    return status;
  }

  /**
   * Installs `version`, or the newest one that the policy allows, as soon as no chat runs a turn,
   * then restarts. Throws for a version that is not a newer release.
   */
  async updateNow(version?: string): Promise<UpdateStatus | null> {
    const status = (await this.updater?.updateNow(version)) ?? null;
    this.noticeUpdateState();
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
   * Starts the Tailscale install and answers at once: a download or an administrator
   * prompt can outlast an HTTP request. The status shows the outcome. Null: phone access is off.
   */
  installTailscale(): RemoteAccess | null {
    const remoteAccess = this.options.remoteAccess ?? null;
    if (remoteAccess === null) return null;
    // A promise that nobody awaits must never end Eva silently (lesson 50).
    void remoteAccess
      .install()
      .then((access) => {
        // Only the install and start steps carry an install failure; another step's problem is not one.
        if (access.problem !== null && (access.step === "install" || access.step === "start"))
          this.options.logger?.log("warn", "Tailscale install failed.", { problem: access.problem });
      })
      .catch((error: unknown) => {
        this.options.logger?.log("error", "Tailscale install failed.", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    return remoteAccess.current();
  }

  /** Asks Tailscale for a fresh sign-in link. Null: phone access is off. */
  async signInToTailscale(): Promise<RemoteAccess | null> {
    return (await this.options.remoteAccess?.signIn()) ?? null;
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

  /**
   * Reports the migrations that ran at start. Call it after the Telegram bot starts, so that a
   * failure reaches Telegram on the hub.
   */
  reportStartMigrations(result: StartMigrations): void {
    this.reportMigrationRun("machine", result.machine);
    if (result.vault !== null) this.reportMigrationRun("vault", result.vault);
    this.noticeVaultAhead();
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
  sweep(): Promise<VaultSyncState["status"]> {
    return this.vault.sweep();
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
      vaultSync: this.vault.currentState,
      sessionCount: sessions.length,
      busySessionIds: sessions.filter((session) => this.sessions.isBusy(session.id)).map((session) => session.id),
      lastTurn: this.lastTurn,
      update: this.updateStatus(),
      remoteAccess: this.options.remoteAccess?.current() ?? null,
      localUrl: `http://127.0.0.1:${String(this.options.config.port)}`,
      problems: this.alerts.openProblems(),
      setupMissing: missingSteps(this.setupProgress()),
    };
  }

  projects(query: ProjectQuery = {}): Project[] {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return [];
    return searchProjects(discoverProjects({ vaultPath, extraRoots: this.options.config.projectRoots }), query);
  }

  createAssistantSession(input: NewChatInput): SessionRecord {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) throw new EvaError("vault_not_found", "No vault is configured. Run `eva setup`.");
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
  createProjectSession(input: NewProjectChatInput): Promise<SessionRecord> {
    return this.projectWork.createSession(input);
  }

  /**
   * Gives work to a project: a Project chat in a free clone runs the request, and its
   * result goes back to the Assistant chat that asked, as a new message.
   */
  startProjectWork(input: ProjectWorkInput): Promise<SessionRecord> {
    return this.projectWork.start(input);
  }

  /** The setup report of each repository of a project, judged against Eva's own repository. */
  repositorySetup(projectId: string): Promise<SetupReport[]> {
    return this.projectWork.repositorySetup(projectId);
  }

  /** The clones of a project, with their branch and pull request. */
  clones(projectId: string): Promise<CloneDetails[]> {
    return this.projectWork.clones(projectId);
  }

  /** Clones a project's repository into its next free folder (the "New clone" button). */
  newClone(projectId: string, repositoryUrl?: string): Promise<Clone> {
    return this.projectWork.newClone(projectId, repositoryUrl);
  }

  /** A project's `AGENTS.md` with its version, for the details editor. */
  projectFile(projectId: string): ProjectFile {
    return this.projectWork.projectFile(projectId);
  }

  /** Sets the status, tags, repositories and title. The idle sweep commits the change. */
  saveProjectDetails(projectId: string, version: string, details: ProjectDetails): ProjectFile {
    return this.projectWork.saveProjectDetails(projectId, version, details);
  }

  /** Replaces the whole `AGENTS.md`, with the line endings of the file on disk. */
  saveProjectFile(projectId: string, version: string, edited: string): ProjectFile {
    return this.projectWork.saveProjectFile(projectId, version, edited);
  }

  publicSettings(): PublicSettings {
    return this.settings.publicSettings();
  }

  /** Checks and saves a settings change; see `LiveSettings.update`. */
  updateSettings(patch: Readonly<Record<string, unknown>>): { saved: true; restartNeeded: boolean } {
    return this.settings.update(patch);
  }

  async setupState(): Promise<EvaSetupState> {
    const saved = this.settings.saved().secrets;
    // The engines, git and Telegram read the tokens at start, so a token saved since then waits for a restart.
    const restartNeeded = pageSecretNames.some((name) => saved[name] !== this.options.secrets[name]);
    return { ...(await this.settings.setupState()), progress: this.setupProgress(), restartNeeded };
  }

  /** Each setup step, from the files as they are now: `eva setup` may have saved a step meanwhile. */
  setupProgress(): ProgressStep[] {
    const { config, secrets } = this.settings.saved();
    const secretsSet = {
      claudeOauthToken: secrets.claudeOauthToken !== undefined,
      githubToken: secrets.githubToken !== undefined,
      telegramBotToken: secrets.telegramBotToken !== undefined,
    };
    const folders = engineFolders(this.options.paths);
    const found = new Set(this.options.engines.map((engine) => engine.name));
    const loggedIn = {
      "claude-code": secretsSet.claudeOauthToken || claudeLoggedIn(folders.claude),
      pi: piLoginState(folders.piAgent) === "ok",
    };
    return setupProgress({
      engines: (["claude-code", "pi"] as const).map((name) => ({
        name,
        found: found.has(name),
        loggedIn: loggedIn[name],
      })),
      defaultEngine: config.engines.default,
      vaultPath: config.vaultPath,
      githubToken: secretsSet.githubToken,
      remoteAccess: this.options.remoteAccess?.current() ?? null,
      devices: this.deviceLogins.count(),
      telegram: { token: secretsSet.telegramBotToken, paired: config.telegram.allowedChatId !== null },
      google: config.google.email !== null,
      checks: Object.fromEntries(this.checkResults),
    });
  }

  /** Saves or removes one secret of the settings page; see `LiveSettings.saveSecret`. */
  saveSecret(name: PageSecretName, value: string | null): { saved: true; restartNeeded: true } {
    return this.settings.saveSecret(name, value);
  }

  async runCheck(name: CheckName): Promise<CheckResult> {
    const secrets = this.settings.secrets;
    const result = await runCheck(name, {
      vaultPath: this.options.config.vaultPath,
      runner: this.options.runner,
      environment: gitEnvironment(this.facts, secrets),
      engines: this.options.engines,
      // A real turn needs the engine's login, as a chat has it; never the GitHub token (lesson 96).
      engineEnvironment: engineEnvironment(this.facts, secrets),
      redact: (text) => this.redactor.redact(text),
      telegramToken: secrets.telegramBotToken ?? null,
      githubToken: secrets.githubToken ?? null,
      google: {
        config: this.settings.config.google,
        client: this.googleClient(),
        credentialsFolder: googleCredentialsFolder(this.options.paths),
        readServices: true,
        ...(this.options.googleBaseUrl === undefined ? {} : { baseUrl: this.options.googleBaseUrl }),
      },
    });
    // The Test reads the saved settings, but chats keep the Google settings of the start.
    const shown =
      name === "google" && result.ok && this.googleRestartNeeded()
        ? { ok: true, detail: `${result.detail} Press Restart Eva so that chats use these Google settings.` }
        : result;
    this.checkResults.set(name, { ...shown, at: this.options.now().toISOString() });
    return shown;
  }

  /** The address of Google's consent page, for the scopes of the saved Google settings. */
  startGoogleLogin(): { url: string } {
    const client = this.googleClient();
    if (client === null)
      throw new EvaError(
        "google_failed",
        `Save the OAuth client id and secret first (step ${String(googleStep.client)}).`,
      );
    return this.googleLogin.start(client.clientId, googleScopes(this.settings.config.google));
  }

  /**
   * Finishes the Google login with the address that the person pasted. The login decides the
   * account, so `google.email` follows it: `workspace-mcp` reads only the login of that email.
   */
  async finishGoogleLogin(pasted: string): Promise<{ email: string; restartNeeded: boolean }> {
    const client = this.googleClient();
    if (client === null)
      throw new EvaError(
        "google_failed",
        `Save the OAuth client id and secret first (step ${String(googleStep.client)}).`,
      );
    const { email } = await this.googleLogin.finish(pasted, client);
    if (this.settings.config.google.email !== email) this.settings.update({ google: { email } });
    return { email, restartNeeded: this.googleRestartNeeded() };
  }

  private googleClient(): { clientId: string; clientSecret: string } | null {
    const { googleOauthClientId, googleOauthClientSecret } = this.settings.secrets;
    return googleOauthClientId === undefined || googleOauthClientSecret === undefined
      ? null
      : { clientId: googleOauthClientId, clientSecret: googleOauthClientSecret };
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
    // The start ran only the machine migrations on a satellite, and the new hub runs those of the vault.
    if (role === "hub") this.runVaultMigrations();
    for (const listener of this.roleListeners) listener(role);
  }

  private runVaultMigrations(): void {
    const vaultPath = this.options.config.vaultPath;
    // A vault folder that is not cloned yet has no hub file, so this machine reads as the hub.
    if (vaultPath === null || !existsSync(vaultPath)) return;
    const run = runMigrations({
      store: "vault",
      migrations,
      paths: this.options.paths,
      vaultPath,
      version: evaVersion,
      now: this.options.now,
    });
    this.reportMigrationRun("vault", run);
  }

  private reportMigrationRun(store: MigrationStore, run: MigrationRun): void {
    if (run.kind === "done") {
      if (run.applied.length > 0) this.options.logger?.log("info", "Migrations ran.", { store, applied: run.applied });
      if (run.later.length > 0)
        this.options.logger?.log("info", "Migrations wait for a later start.", { store, later: run.later });
      return;
    }
    if (run.kind === "failed") {
      this.alerts.notify(`migration_failed:${store}`, "error", migrationFailedMessage(store, run.id, run.reason));
      return;
    }
    // noticeVaultAhead raises the alert of a vault that is ahead, and keeps it open until this Eva updates.
    if (store === "machine") this.alerts.notify("machine_ahead", "warn", machineAheadMessage(evaVersion));
  }

  /** The version that a vault from a newer Eva needs, "newest" when its record does not say, or undefined. */
  private vaultNeeds(): string | undefined {
    const vaultPath = this.options.config.vaultPath;
    const ahead = vaultPath === null ? null : vaultAhead(vaultPath);
    if (ahead === null) return undefined;
    return ahead.version ?? "newest";
  }

  private noticeVaultAhead(): void {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return;
    this.alerts.report("vault_ahead", vaultAheadProblem(vaultAhead(vaultPath), this.machine, evaVersion));
  }

  /**
   * Writes this machine's open problems to the vault, and the next save pushes them. Only the hub
   * runs Telegram, so the hub raises the problems of the other machines (#126).
   */
  private exchangeMachineReports(): void {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return;
    // The role reads hub.json now, because this hook runs before the tick notices a role change.
    const isHub = this.role() === "hub";
    if (!isHub) {
      // The new hub sends these problems, so a "resolved" line from here would be false.
      for (const keys of this.relayed.values()) for (const key of keys) this.alerts.dismiss(key);
      this.relayed = new Map();
      // A satellite fires no schedule, so nothing would clear the firing problems of its time as hub.
      for (const alert of this.alerts.openAlerts())
        if (alert.key.startsWith("schedule:")) this.alerts.dismiss(alert.key);
    }
    const problems = this.alerts
      .openAlerts()
      // A sync problem would travel through the sync that it breaks, so it arrives only after it clears.
      .filter((alert) => alert.key !== "vault_sync" && !alert.key.startsWith("machine:"));
    const written = writeMachineReport(vaultPath, { machine: this.machine, version: evaVersion, problems });
    if (written === "no_vault") return;
    this.noticeReportName(written === "name_taken");

    if (!isHub) return;
    const relayed = new Map<string, ReadonlySet<string>>();
    for (const { file, report } of readMachineReports(vaultPath)) {
      if (report === null) {
        // A broken file, such as one in a sync conflict, keeps its problems until it reads again.
        const kept = this.relayed.get(file);
        if (kept !== undefined) relayed.set(file, kept);
        continue;
      }
      if (report.machine === this.machine) continue;
      const keys = new Set<string>();
      for (const problem of report.problems) {
        const key = `machine:${report.machine}:${problem.key}`;
        keys.add(key);
        this.alerts.report(key, relayedProblem(report.machine, machineReportFile(report.machine), problem));
      }
      relayed.set(file, keys);
    }
    for (const [file, keys] of this.relayed)
      for (const key of keys) if (relayed.get(file)?.has(key) !== true) this.alerts.report(key, null);
    this.relayed = relayed;
  }

  /** Logs once when another machine's report holds the file of this machine's name. */
  private noticeReportName(taken: boolean): void {
    if (taken && !this.reportNameTaken)
      this.options.logger?.log("warn", "Another machine's report uses the file of this machine's name.", {
        file: machineReportFile(this.machine),
      });
    this.reportNameTaken = taken;
  }

  private assistantBusy(): boolean {
    return this.sessions.list().some((session) => session.mode === "assistant" && this.sessions.isBusy(session.id));
  }

  /** Runs a task that nobody awaits, and logs its failure instead of losing it (lesson 50). */
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

  private noticeUpdateState(): void {
    const status = this.updater?.status();
    if (status === undefined) return;
    this.alerts.report("update", updateProblem(status));
    this.announceHeldBack(status);
  }

  /**
   * Sends one message for each new held-back release, never one at each check. The file keeps
   * the newest announced version, so a restart does not send it again.
   */
  private announceHeldBack(status: UpdateStatus): void {
    const news = heldBackNews(status);
    if (news === null || status.heldBack === null) return;
    const file = this.options.paths.updatesState;
    const read = readJsonTolerant(file);
    const announced =
      read.ok && typeof read.value === "object" && read.value !== null && "announced" in read.value
        ? read.value.announced
        : null;
    if (typeof announced === "string" && !isNewerVersion(status.heldBack, announced)) return;
    writeFileAtomic(file, `${JSON.stringify({ announced: status.heldBack }, null, 2)}\n`);
    this.alerts.notify("update_held_back", "news", news);
  }

  /**
   * True when the saved Google settings differ from the ones that chats got at start.
   * `workspace-mcp` reads the login file at each call, but its flags and account come from the start.
   */
  private googleRestartNeeded(): boolean {
    const started = this.googleServer(this.options.config.google, this.options.secrets);
    const saved = this.googleServer(this.settings.config.google, this.settings.secrets);
    return JSON.stringify(started) !== JSON.stringify(saved);
  }

  private assistantMcpServers(): Record<string, McpServerSpec> {
    const google = this.googleServer(this.options.config.google, this.options.secrets);
    return google === null ? {} : { google };
  }

  private googleServer(config: EvaConfig["google"], secrets: EvaSecrets): McpServerSpec | null {
    return googleMcpServer({
      config,
      secrets,
      credentialsFolder: googleCredentialsFolder(this.options.paths),
      // The agent's engine starts this server, so it gets no GitHub token (lesson 96).
      environment: buildChildEnvironment(this.options.processEnvironment, baseEnvironmentAllowlist),
    });
  }
}

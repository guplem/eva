/**
 * One Eva instance: the core that every front end talks to. It joins the vault sync, the
 * projects, the sessions, the settings and the two modes, and runs the background work.
 */
import { googleClientIdProblem } from "./google/google-client.ts";
import { existsSync, readdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { EngineName, EnginePort, McpServerSpec } from "../shared/engine-port.ts";
import type { EnginePermissions } from "../shared/permissions.ts";
import {
  baseEnvironmentAllowlist,
  buildChildEnvironment,
  proxyEnvironmentAllowlist,
  type EnvironmentMap,
} from "../shared/environment.ts";
import { EvaError, isEvaError } from "../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../shared/files.ts";
import { readRecentLogEntries, type LogEntry, type Logger, type RecentLogQuery } from "../shared/logger.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import { systemTerminalProcessStarter, type TerminalProcessStarter } from "../shared/terminal-process.ts";
import type { SessionEvent, TurnUsage } from "../shared/events.ts";
import { Redactor } from "../shared/redaction.ts";
import { evaVersion } from "../shared/version.ts";
import { AlertCenter, type Alert, type AlertProblem, type ProblemDetail } from "./alerts/alert-center.ts";
import { ChatNotifications, holdingChat, type NotificationKind } from "./alerts/chat-notifications.ts";
import { readHiddenProblems, writeHiddenProblems } from "./alerts/hidden-problems.ts";
import { readNotificationHistory, writeNotificationHistory, type HistoryEntry } from "./alerts/notification-history.ts";
import { WebPush, type PushDevice, type PushSender, type PushSubscriptionInput } from "./alerts/web-push.ts";
import {
  scheduleCardProblem,
  engineLoginProblem,
  engineMissingProblem,
  engineRestartProblem,
  engineUpdateProblem,
  heldBackNews,
  machineAheadMessage,
  migrationFailedMessage,
  scheduleFiringProblem,
  uncleanExitMessage,
  updateProblem,
  relayedProblem,
  vaultAheadProblem,
  lastLocationProblem,
} from "./alerts/problem-rules.ts";
import { machineReportFile, readMachineReports, writeMachineReport } from "./alerts/machine-reports.ts";
import { runMigrations, type MigrationRun, type MigrationStore } from "./migrations/migration-runner.ts";
import { migrations, vaultAhead, type StartMigrations } from "./migrations/migrations.ts";
import { runCheck, uvRuns, type CheckName, type CheckResult } from "./checks.ts";
import { DeviceLogins } from "./remote-access/device-logins.ts";
import { engineFolders, loadConfig, type EvaConfig, type EvaSecrets, type HomePaths } from "./settings/home.ts";
import { defaultVoiceModelPath, withMachineDefaults } from "./settings/machine-defaults.ts";
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
import {
  commitIdentity,
  refreshGitHubAccount,
  saveGitHubAccount,
  loadGitHubAccount,
} from "./instance/commit-identity.ts";
import { claudeLoggedIn, githubCliAccount, piLoginState } from "./setup/logins.ts";
import {
  chatBlocker,
  missingSteps,
  setupProgress,
  type ChatBlocker,
  type CheckRecord,
  type ProgressStep,
} from "./setup/progress.ts";
import { claimHub, claimHubIfUnclaimed, machineRole, readHubClaim, type MachineRole } from "./instance/hub.ts";
import type { RemoteAccess, RemoteAccessControl } from "./remote-access/remote-access.ts";
import { AssistantPreparer } from "./modes/assistant-mode.ts";
import { ProjectPreparer } from "./modes/project-mode.ts";
import {
  CloneOriginStore,
  readOriginUrl,
  TrustStore,
  type Clone,
  type CloneDetails,
  type TrustAnswer,
} from "./projects/clones.ts";
import {
  ProjectWork,
  type BranchResult,
  type CloneFetch,
  type ForkFiles,
  type NewChatInput,
  type NewProjectChatInput,
  type ProjectWorkInput,
  type RepositoryFixResult,
  type RetryChoice,
} from "./projects/project-work.ts";
import { Scheduler } from "./schedules/scheduler.ts";
import { moveFavorites, readFavorites, setFavorite, type Favorite } from "./files/vault-favorites.ts";
import {
  browseVault,
  normalizedPath,
  renameVaultEntry,
  saveVaultFile,
  type BrowsedPath,
} from "./files/file-browser.ts";
import { downloadVaultPath, type VaultDownload } from "./files/file-download.ts";
import { searchVault, type SearchResult } from "./files/vault-search.ts";
import { cleanScratch, receivedFileNote, saveReceivedFile } from "./files/vault-files.ts";
import { googleMcpServer } from "./google/google-mcp.ts";
import { GoogleLogin, googleCredentialsFolder } from "./google/google-login.ts";
import { ClaudeLogin } from "./setup/claude-login.ts";
import { googleScopes } from "./google/google-scopes.ts";
import { googleStep } from "./google/google-steps.ts";
import { createTranscriber, type Transcribe } from "./voice/transcriber.ts";
import { discoverProjects, searchProjects, type Project, type ProjectQuery } from "./projects/project-catalog.ts";
import { createProject, type NewProjectInput, type NewProjectResult } from "./projects/new-project.ts";
import { wallClockOf } from "./schedules/schedule-timing.ts";
import { createDriveFolder } from "./google/google-drive.ts";
import type { GithubRequest } from "./projects/repository-facts.ts";
import type { GithubWrite } from "./projects/repository-fixes.ts";
import type { SetupReport } from "./projects/repository-setup.ts";
import type { RepositoryTypeName } from "./projects/repository-types.ts";
import type { ProjectDetails, ProjectFile } from "./projects/project-file.ts";
import { ChatNamer } from "./sessions/chat-namer.ts";
import { ChatSummarizer } from "./sessions/chat-summary.ts";
import { AssistantRules } from "./modes/assistant-rules.ts";
import { SessionManager, type FirstTurn } from "./sessions/session-manager.ts";
import { answersToUndo, refsStillNamed } from "./sessions/retry-undo.ts";
import { ModelCalls } from "./model-calls/model-calls.ts";
import { ComposerMenu } from "./composer-menu/composer-menu.ts";
import { SessionStore, type SessionRecord } from "./sessions/session-store.ts";
import { StepDetailsStore } from "./sessions/step-details-store.ts";
import { UnsentTextStore } from "./sessions/unsent-texts.ts";
import {
  type ConflictChoice,
  type ConflictResolution,
  VaultSync,
  type VaultConflictReport,
  type VaultSyncState,
} from "./vault/vault-sync.ts";
import { VaultUpkeep, type SyncNowState } from "./vault/vault-upkeep.ts";
import type { UndoPreview } from "./vault/vault-snapshots.ts";
import { alignmentProblem, TemplateAlignment, templateHistory, type TemplatePart } from "./vault/template-alignment.ts";
import { templateParts } from "./vault/vault-template.ts";
import { firstCommitDay, installedOn, readAboutMe, readHomePlace, type AboutMe } from "./vault/about-me.ts";
import { LocationKeeper, type LocationInput, type LocationSource } from "./location/last-location.ts";
import { GitHubBrowserLogin, type DeviceLogin } from "./vault/github-browser-login.ts";
import { logInGitHubCli, logOutGitHubCli } from "./vault/github-cli-login.ts";
import { githubClientId, githubDeviceLogin } from "./vault/github-login.ts";
import { createGitHubRepository, type GitHubRepository } from "./vault/github-repositories.ts";
import { VaultSetup, type NewVaultAnswers, type VaultSetupResult } from "./vault/vault-setup.ts";
import { readToolVersions, type ToolPlaces, type ToolVersion } from "./tool-versions.ts";
import {
  claudeUpdateChannel,
  defaultLatestVersionSources,
  readLatestVersion,
  type LatestVersionSources,
} from "./tool-latest.ts";
import { findGh, ghTooOld, installEngine, installGh, installUv } from "./engine-install/engine-install.ts";
import {
  installFfmpeg,
  installVoiceModel,
  installWhisper,
  type VoiceInstallInputs,
  type VoicePart,
} from "./engine-install/voice-install.ts";
import { EngineUpdater, type EngineUpdateStatus } from "./updates/engine-update.ts";
import { changelogEntries, type ChangelogEntry } from "./updates/release-policy.ts";
import { publishedReleaseNotes } from "./updates/self-update.ts";
import { isNewerVersion } from "./updates/version-order.ts";
import { Updater, type UpdateChannel, type UpdateStatus } from "./updates/updater.ts";

/** The person's facts as the web page reads them. */
export interface PersonalFactsView extends Omit<AboutMe, "problems"> {
  /** The day that Eva started on the vault, as `YYYY-MM-DD`. */
  readonly installedOn: string | null;
  /** The facts that Eva still needs, the most useful first. */
  readonly missing: readonly ("birthDate" | "region")[];
}

/** Where the person is, for scripts such as a weather forecast. */
export interface CurrentPlace {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius of the error, in meters; null when the phone does not say, and for the home place. */
  readonly accuracy: number | null;
  /** A phone's recent location, or the home place of `Life/About me.md`. */
  readonly source: LocationSource | "home";
  /** When the phone sent it; null for the home place. */
  readonly at: string | null;
}

/** A location older than this says little about where the person is now, so the home place wins. */
const locationFreshMs = 24 * 60 * 60_000;

/** What Eva sends to the devices: an alert, or a chat's notice with its own title and page. */
interface PushedAlertInput extends Alert {
  readonly title?: string;
  /** The page that a tap opens. Without it, the device picks the page from the key. */
  readonly url?: string;
}

/** An alert as a device reads it after a push. The number lets the device show each alert once. */
export interface PushedAlert extends PushedAlertInput {
  readonly seq: number;
}

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
  /** Finds an engine's program on the disk now, so an install after the start ends its alert. Default: none. */
  readonly locateEngine?: (engine: EngineName) => string | null;
  /** Sends a web push. Tests pass their own; the default posts to the push service. */
  readonly pushSender?: PushSender;
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
  /** One call of the GitHub API that changes a repository, for its direct fixes. Default: `gh api`. */
  readonly githubWrite?: GithubWrite;
  /** Google's address for the Google login and check; a test points it at a fake server. */
  readonly googleBaseUrl?: string;
  /** The GitHub API, which the vault step uses to list and create repositories; a test points it at a fake server. */
  readonly githubApiBaseUrl?: string;
  /** The GitHub browser login of the page. Default: the device flow with Eva's OAuth App. Null: none. */
  readonly githubBrowserLogin?: DeviceLogin | null;
  /** Starts a program in a pseudo-terminal, for the Claude login. Default: Bun's terminal. */
  readonly startTerminal?: TerminalProcessStarter;
  /** Where the tools live, for their versions. Default: this machine, not the single executable. */
  readonly toolPlaces?: Pick<ToolPlaces, "platform" | "userHome" | "standalone">;
  /** The processor and the release downloads of the tool installs; a test points them at a fake. */
  readonly toolInstall?: Partial<
    Pick<
      VoiceInstallInputs,
      | "arch"
      | "piReleasesBaseUrl"
      | "ghReleaseUrl"
      | "ffmpegReleaseUrl"
      | "whisperReleaseUrl"
      | "voiceModelUrl"
      | "voiceModelSha256"
    >
  >;
  /** Where Eva reads the latest version of each tool; a test points it at a fake server. */
  readonly toolLatestSources?: LatestVersionSources;
}

/** The tools that Eva installs and updates from the Updates page, by their program name. */
export type InstallableTool = "claude" | "pi" | "uv" | "gh";

export const installableTools: readonly InstallableTool[] = ["claude", "pi", "uv", "gh"];

/** What an install from the Updates page did, in words for the person. */
export interface ToolInstallResult {
  readonly ok: boolean;
  readonly message: string;
}

/** The newest published version of a tool that Eva installs. Null: the source did not answer. */
export interface LatestToolVersion {
  readonly program: InstallableTool;
  readonly latest: string | null;
}

/** Eva's version and each tool's, for the status and the Updates page. */
export interface EvaVersions {
  readonly eva: string;
  readonly tools: readonly ToolVersion[];
  readonly voiceNotes: VoiceNotesState;
}

/** What voice notes still need on this machine, and whether they run now. */
export interface VoiceNotesState {
  readonly missing: readonly VoicePart[];
  /** False until a restart after the install, as Eva finds the programs when she starts. */
  readonly on: boolean;
}

/** The last finished turn's token counts, so a broken prompt cache shows (lesson 120). */
export interface LastTurnStatus extends TurnUsage {
  readonly at: string;
  readonly costUsd: number | null;
}

/** The notification center reads the history through this. */
export interface NotificationsView {
  readonly entries: readonly HistoryEntry[];
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
  /** False when `sync.enabled` is off: the vault status then shows the last sync, not the notes that wait here. */
  readonly vaultAutoSync: boolean;
  readonly sessionCount: number;
  readonly busySessionIds: readonly string[];
  readonly lastTurn: LastTurnStatus | null;
  readonly update: UpdateStatus | null;
  readonly remoteAccess: RemoteAccess | null;
  /** The web UI on this machine only, which needs the token. */
  readonly localUrl: string;
  /** One line for each open problem; empty when all is good. */
  readonly problems: readonly string[];
  /** The same problems with their keys. */
  readonly problemDetails: readonly ProblemDetail[];
  /** How many setup steps still need the person; the Settings page lists them. */
  readonly setupMissing: number;
  /** The missing step that stops every chat, or null when a chat can answer. */
  readonly chatBlocker: ChatBlocker | null;
  /** True when this machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
}

/** The Setup section: the settings' state, and the progress list. */
export interface EvaSetupState extends SetupState {
  readonly progress: readonly ProgressStep[];
  /** True when the files hold a token or a vault folder that Eva does not use yet, such as one that `eva setup` saved. */
  readonly restartNeeded: boolean;
  /** True for a new vault with a commit and no remote: the vault step offers its push. */
  readonly vaultNeedsPush: boolean;
  /** The engines whose program the page installed since the start. They run after a restart. */
  readonly installedEngines: readonly EngineName[];
  /** True when a Google account is set but no chat can run uv, which starts the Google tools. */
  readonly uvMissing: boolean;
}

/** Each engine's permissions, with its name. */
export type PermissionsOverview = readonly (EnginePermissions & { readonly engine: EngineName })[];

/** Whose repositories Eva trusts, for the Trusted repositories section. */
export interface TrustOverview {
  /** The login of this Eva's GitHub account, or null when Eva has no record of it. */
  readonly githubAccount: string | null;
  /** True when a GitHub token is saved. A token from before Eva kept the account has no record until a Test. */
  readonly githubLoggedIn: boolean;
  readonly owners: readonly string[];
  readonly answers: readonly TrustAnswer[];
}

const approvalTimeoutMs = 10 * 60_000;
/** A turn may run long (a big refactor), but never for ever. */
const turnTimeoutMs = 2 * 60 * 60_000;
const scheduleTickMs = 30_000;
/**
 * How many alerts a device can read after a push: the newest is the one it shows. The chats push
 * too, and each device reads only its own, so the list keeps more than one device needs.
 */
const recentAlertCount = 30;
/** A cold start of an engine and one short answer. */
const modelCallTimeoutMs = 90_000;
const backgroundTickMs = 60_000;
const housekeepingIntervalMs = 24 * 60 * 60_000;
/** The front end that asked for a restart answers first, then Eva stops. */
const restartDelayMs = 500;
const latestToolKeepMs = 60 * 60_000;
/** A failure, such as GitHub's rate limit, waits too, so each page open does not use up the limit. */
const latestToolFailureKeepMs = 10 * 60_000;
/** How long the answer to "can a chat run uv" stays. */
const uvAnswerKeepMs = 60_000;
const maxLogEntries = 100;
/** About a month of releases. A phone scrolls a longer list for nothing. */
const changelogLength = 30;

export class Eva {
  readonly sessions: SessionManager;
  /** Null when no vault is configured. */
  readonly schedules: Scheduler | null;
  /** The person's rules for chat names. Null when no vault is configured. */
  readonly chatNames: ChatNamer | null;
  /** The text actions and saved prompts of the message box, or null without a vault. */
  readonly composerMenu: ComposerMenu | null;
  /** The unsent text of each chat, which every page of the web app shows. */
  readonly unsentTexts: UnsentTextStore;
  /** The person's rules for Eva, in `.eva/assistant.md`. Null when no vault is configured. */
  readonly assistantRules: AssistantRules | null;
  /** The vault's template parts, such as the skills. Null when no vault is configured. */
  readonly templateAlignment: TemplateAlignment | null;
  /** One question to a model with one answer, for any feature that needs a short text. */
  readonly modelCalls: ModelCalls;
  /** Null until a whisper model is configured. */
  readonly transcribe: Transcribe | null;
  /** The web UI's device logins, which the Telegram bot confirms. */
  readonly deviceLogins: DeviceLogins;
  private readonly googleLogin: GoogleLogin;
  private readonly claudeLogin: ClaudeLogin;
  private readonly githubLogin: GitHubBrowserLogin;
  /** The gh logins and logouts, one after the other. */
  private githubCliChanges: Promise<void>;
  private toolInstallRuns: boolean;
  /**
   * Each program that the page installed since the start, with its path. The engines start with
   * Eva, so a new engine program waits for a restart, but its login need not.
   */
  private readonly installedPrograms: Map<InstallableTool, string>;
  /** The last answer to "can a chat run uv", and when Eva asked. */
  private uvAnswer: { readonly at: number; readonly runs: Promise<boolean> } | null;
  /** The lookup of each latest tool version, and when it started. A running lookup is shared. */
  private readonly latestToolCache: Map<string, { readonly lookup: Promise<string | null>; readonly at: number }>;
  /** The changelog, kept as the latest tool versions are, so each dialog open does not use up GitHub's limit. */
  private changelogCache: { readonly lookup: Promise<ChangelogEntry[] | EvaError>; readonly at: number } | null;
  private readonly options: EvaOptions;
  private readonly redactor: Redactor;
  /** The last result of each Test since the start. A restart clears them: the tokens may have changed. */
  private readonly checkResults: Map<CheckName, CheckRecord>;
  private readonly facts: InstanceFacts;
  private readonly vault: VaultUpkeep;
  private readonly locations: LocationKeeper;
  /** The day of the vault's first commit, read once. */
  private vaultFirstCommit: Promise<string | null> | null;
  /** The git environment of this instance, for reads of the vault's history. */
  private readonly gitEnvironmentForReads: Readonly<Record<string, string>>;
  private readonly settings: LiveSettings;
  private readonly projectWork: ProjectWork;
  private readonly chatSummaries: ChatSummarizer;
  private readonly vaultSetup: VaultSetup;
  private readonly trustStore: TrustStore;
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
  /** Eva's alerts as notifications on the person's devices. */
  private readonly webPush: WebPush;
  /**
   * The newest alerts, newest first, which a device's service worker reads after a push. Each one
   * keeps the devices that got it, so a device reads only its own.
   */
  private readonly recentAlerts: { readonly alert: PushedAlert; readonly endpoints: ReadonlySet<string> }[];
  /** The number of the last alert that went to the devices. */
  private pushedCount: number;
  /** The keys of the problems that this hub relays now, by report file. */
  private relayed = new Map<string, ReadonlySet<string>>();
  /** True after the first read of the machine reports has dropped the stale relayed hidden marks. */
  private hiddenMarksChecked: boolean;
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
      commitIdentity: commitIdentity(options.paths, options.config),
    };
    const ownGitEnvironment = gitEnvironment(this.facts, options.secrets);
    this.gitEnvironmentForReads = ownGitEnvironment;
    this.vaultFirstCommit = null;

    const redactor = new Redactor();
    for (const secret of Object.values(options.secrets)) redactor.addSecret(secret);
    this.alerts = new AlertCenter({
      now: options.now,
      redactor,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      hidden: readHiddenProblems(options.paths.hiddenProblems),
      onHiddenChange: (hidden) => {
        // A report runs in sync and scheduler code, so a full disk must never reach it.
        try {
          writeHiddenProblems(options.paths.hiddenProblems, hidden);
        } catch (error) {
          options.logger?.log("warn", "Eva could not save the hidden problems.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },
      history: readNotificationHistory(options.paths.notificationHistory),
      onHistoryChange: (history) => {
        try {
          writeNotificationHistory(options.paths.notificationHistory, history);
        } catch (error) {
          options.logger?.log("warn", "Eva could not save the notification history.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
    this.redactor = redactor;
    this.unsentTexts = new UnsentTextStore(options.paths.unsentTexts, redactor);
    this.locations = new LocationKeeper({ vaultPath, oldFilePath: options.paths.location, now: options.now });
    this.webPush = new WebPush({
      paths: options.paths,
      now: options.now,
      ...(options.pushSender === undefined ? {} : { send: options.pushSender }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.recentAlerts = [];
    this.hiddenMarksChecked = false;
    this.pushedCount = 0;
    // Only the hub pushes, as only the hub runs Telegram: it relays the problems of the other
    // machines, so a device that also subscribed on a satellite would get each one twice.
    this.alerts.onAlert((alert) => (this.role() === "hub" ? this.pushAlert(alert, "alerts") : undefined));
    this.vault = new VaultUpkeep({
      vaultSync:
        vaultPath === null
          ? null
          : new VaultSync({
              vaultPath,
              runner: options.runner,
              environment: ownGitEnvironment,
              now: options.now,
              redact: (text) => redactor.redact(text),
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
        this.noticeTemplateParts();
        // A full disk or a reserved file name must not stop the sync step.
        try {
          this.exchangeMachineReports();
        } catch (error) {
          options.logger?.log("warn", "The machine report failed.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },
      afterFetch: () => {
        this.claimHubAfterFetch();
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
    // A removed device must not see the start of a reply on its lock screen.
    this.deviceLogins.onForget(() => {
      this.webPush.keepDevices(new Set(this.deviceLogins.list(null).map((device) => device.id)));
    });
    this.checkResults = new Map();
    this.googleLogin = new GoogleLogin({
      credentialsFolder: googleCredentialsFolder(options.paths),
      now: options.now,
      ...(options.googleBaseUrl === undefined ? {} : { baseUrl: options.googleBaseUrl }),
    });
    this.claudeLogin = new ClaudeLogin({
      start: options.startTerminal ?? systemTerminalProcessStarter,
      program: () => options.claudeExecutable ?? this.installedPrograms.get("claude") ?? null,
      cwd: options.paths.root,
      environment: () => engineToolEnvironment(this.facts),
    });
    this.githubCliChanges = Promise.resolve();
    this.toolInstallRuns = false;
    this.installedPrograms = new Map();
    this.uvAnswer = null;
    this.latestToolCache = new Map();
    this.changelogCache = null;
    this.githubLogin = new GitHubBrowserLogin({
      login: options.githubBrowserLogin === undefined ? defaultGitHubLogin(options.now) : options.githubBrowserLogin,
      sleep: (ms) => Bun.sleep(ms),
      save: async (token) => {
        await this.saveSecret("githubToken", token);
      },
    });
    const agentEnvironment = engineEnvironment(this.facts, options.secrets);
    const cloneOrigins = new CloneOriginStore(options.paths.cloneOrigins);
    this.trustStore = new TrustStore(options.paths.trust);
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
    this.composerMenu = vaultPath === null ? null : new ComposerMenu({ vaultPath, modelCalls: this.modelCalls });
    this.chatSummaries = new ChatSummarizer({
      modelCalls: this.modelCalls,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    this.assistantRules =
      vaultPath === null
        ? null
        : new AssistantRules({
            vaultPath,
            basePrompt: options.basePrompt,
            now: options.now,
            timeZone: options.config.timeZone ?? "UTC",
          });
    this.templateAlignment =
      vaultPath === null
        ? null
        : new TemplateAlignment({
            vaultPath,
            parts: templateParts,
            history: templateHistory,
            evaVersion,
            now: options.now,
          });

    this.sessions = new SessionManager({
      ...(chatNamer === null ? {} : { nameChat: (turn: FirstTurn) => chatNamer.name(turn) }),
      engines: options.engines,
      chatDefaults: () => ({
        model: this.settings.config.engines.defaultModel,
        effort: this.settings.config.engines.defaultEffort,
      }),
      store: new SessionStore(options.paths.sessions, {
        now: options.now,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      }),
      stepDetails: new StepDetailsStore(options.paths.stepDetails),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      preparers: {
        assistant: new AssistantPreparer({
          vaultPath: vaultPath ?? "",
          vaultSync: {
            pull: () => this.vault.pull(),
            save: () => this.vault.save(),
            snapshot: (ref) => this.vault.snapshot(ref),
          },
          beforeEndSnapshot: (sessionId) => this.writeLocationIfDue(sessionId),
          basePrompt: options.basePrompt,
          runner: options.runner,
          environment: agentEnvironment,
          now: options.now,
          timeZone: options.config.timeZone ?? "UTC",
          mcpServers: this.assistantMcpServers(),
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        }),
        project: new ProjectPreparer({
          trustStore: this.trustStore,
          cloneOrigins,
          trustedOwners: () => this.trustedOwners(),
          environment: agentEnvironment,
          readRemote: (folder) => readOriginUrl(folder, options.runner, ownGitEnvironment),
          snapshots: { runner: options.runner, environment: ownGitEnvironment },
          // Read at each restore: the project work exists only after the session manager.
          isSyncing: (folder) => this.projectWork.isSyncingFolder(folder),
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
      engineEnvironment: agentEnvironment,
      summarizer: this.chatSummaries,
      projects: () => this.projects(),
      defaultEngine: options.config.engines.default,
      runner: options.runner,
      gitEnvironment: ownGitEnvironment,
      cloneOrigins,
      inBackground: (what, task) => {
        this.inBackground(what, task);
      },
      modelCalls: this.modelCalls,
      ...(options.githubRequest === undefined ? {} : { githubRequest: options.githubRequest }),
      ...(options.githubWrite === undefined ? {} : { githubWrite: options.githubWrite }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });

    this.vaultSetup = new VaultSetup({
      paths: options.paths,
      runner: options.runner,
      savedVaultPath: () => this.savedVaultPath(),
      // From the files, so a token that the page or `eva setup` saved since the start works at once,
      // and a new vault's first commit carries that token's account.
      gitEnvironment: () => {
        const saved = this.settings.saved();
        const identity = commitIdentity(options.paths, saved.config);
        return gitEnvironment({ ...this.facts, commitIdentity: identity }, saved.secrets);
      },
      githubToken: () => this.settings.saved().secrets.githubToken,
      ...(options.githubApiBaseUrl === undefined ? {} : { githubApiBaseUrl: options.githubApiBaseUrl }),
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
      if (event.kind === "turn_failed" || event.kind === "turn_finished") this.reportEngineLogin(event);
      if (event.kind === "session_deleted") {
        this.unsentTexts.remove(event.sessionId);
        // After the delete of one branch, its forks still name the snapshots of the turns that they took.
        // The deleted turns can also be the last that named the snapshots of a branch that went before.
        for (const id of [event.sessionId, ...(event.snapshotsOf ?? [])]) {
          const keep = refsStillNamed(this.sessions.list(), id);
          this.inBackground("The delete of the snapshots of a chat", () => this.vault.deleteSnapshots(id, keep));
        }
      }
      if (event.kind !== "turn_finished") return;
      this.lastTurn = { ...event.usage, at: event.at, costUsd: event.costUsd };
      // The cache counts go in the log too, so a broken prompt cache shows (lesson 120).
      options.logger?.log("info", "A turn finished.", { sessionId: event.sessionId, ...event.usage });
    });

    // Every machine sends the notifications of its own chats: a satellite's chats run only there.
    const chatNotifications = new ChatNotifications({
      chatOf: (sessionId) => this.sessions.list().find((session) => session.id === sessionId) ?? null,
      onNotification: (notification) => {
        void this.pushAlert(
          {
            key: notification.key,
            level: "news",
            message: notification.body,
            at: options.now().toISOString(),
            title: notification.title,
            url: `/#/chat/${encodeURIComponent(notification.sessionId)}`,
          },
          notification.kind,
          holdingChat(notification),
        );
      },
    });
    this.sessions.subscribe((event) => {
      chatNotifications.handle(event);
    });
    this.sessions.onIdle((sessionId, state) => {
      chatNotifications.idle(sessionId, state);
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
              createChat: (name, model) =>
                this.createAssistantSession({
                  source: "schedule",
                  ...(model === undefined ? {} : { model }),
                  title: name,
                }).id,
              send: (sessionId, prompt) => this.sessions.sendWithResult(sessionId, prompt, "schedule"),
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
            // A restart during a tool install leaves the tool half installed (#565).
            isIdle: () =>
              !this.workRuns() && !this.toolInstallRuns && this.engineUpdater?.status().phase !== "waiting_for_idle",
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
      // The interval applies at once; sync.enabled waits for a restart, as the sweep and the turn sync do.
      await this.vault.pullIfDue({ ...this.settings.config.sync, enabled: this.options.config.sync.enabled });
      this.noticeRoleChange();
      this.cleanUpIfDue();
      await this.writeLocationIfDue();
      this.noticeDefaultEngine();
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
  syncVault(): Promise<SyncNowState> {
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
   * A check for the Versions page, as fresh as the latest tool versions. The automatic check
   * can be a week old or off, but the page must show a new Eva as it shows a new tool.
   */
  async checkForUpdateIfStale(): Promise<UpdateStatus | null> {
    const status = this.updateStatus();
    if (status === null) return null;
    const keepMs = status.failedStep === "check" ? latestToolFailureKeepMs : latestToolKeepMs;
    const checkedAt = status.lastCheckAt === null ? null : Date.parse(status.lastCheckAt);
    if (checkedAt !== null && this.options.now().getTime() - checkedAt < keepMs) return status;
    return this.checkForUpdate();
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

  /** The newest releases with what each one changed, also for a source checkout. */
  async changelog(): Promise<ChangelogEntry[]> {
    const now = this.options.now().getTime();
    const kept = this.changelogCache;
    if (kept !== null) {
      const found = await kept.lookup;
      if (now - kept.at < (found instanceof EvaError ? latestToolFailureKeepMs : latestToolKeepMs)) {
        if (found instanceof EvaError) throw found;
        return found;
      }
    }
    const lookup = publishedReleaseNotes(
      this.options.githubApiBaseUrl === undefined ? {} : { apiBaseUrl: this.options.githubApiBaseUrl },
    ).then(
      (releases) => changelogEntries(releases.slice(0, changelogLength), evaVersion),
      (error: unknown) =>
        error instanceof EvaError ? error : new EvaError("update_failed", "GitHub gave no list of releases."),
    );
    this.changelogCache = { lookup, at: now };
    const found = await lookup;
    if (found instanceof EvaError) throw found;
    return found;
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

  /**
   * Keeps a location from the phone, with the time when the phone took it. True when Eva kept it:
   * she drops an older point, and keeps a live stream at most once a minute. Only the hub keeps it,
   * because only the hub runs the schedules and Telegram. The write to the vault follows when it
   * is due.
   */
  saveLocation(input: LocationInput, source: LocationSource, takenAt: Date, shared: boolean): boolean {
    if (this.role() !== "hub") {
      throw new EvaError("setting_forbidden", "Only the hub computer keeps your location. Open its page to send it.");
    }
    const kept = this.locations.keep(input, source, takenAt, shared);
    if (kept) this.inBackground("The location write", () => this.writeLocationIfDue());
    return kept;
  }

  /**
   * Where the person is: the phone's location from the last 24 hours, or else the home place of
   * `Life/About me.md`. Null when Eva knows neither. The hub can know a newer point than the note.
   */
  currentPlace(): CurrentPlace | null {
    const last = this.locations.newest();
    if (last !== null && this.options.now().getTime() - Date.parse(last.at) < locationFreshMs) {
      const { latitude, longitude, accuracy, source, at } = last;
      return { latitude, longitude, accuracy, source, at };
    }
    const vaultPath = this.options.config.vaultPath;
    const home = vaultPath === null ? null : readHomePlace(vaultPath);
    return home === null ? null : { latitude: home.lat, longitude: home.lon, accuracy: null, source: "home", at: null };
  }

  /**
   * Writes the hub's newest point into `Life/About me.md` when it is due, between two sync steps
   * and never during an Assistant turn. The next sync carries the change. `endingTurn` is the chat
   * whose turn ends now: Eva writes before its snapshot, so an undo of that turn stays whole.
   */
  private async writeLocationIfDue(endingTurn?: string): Promise<void> {
    if (this.role() !== "hub") return;
    try {
      await this.vault.exclusive(() => {
        if (this.assistantBusy(endingTurn)) return;
        const problem = lastLocationProblem(this.locations.writeIfDue());
        if (problem !== "keep") this.alerts.report("last_location", problem);
      });
    } catch (error) {
      // A full disk must not stop the background tick or the end of a turn. The point stays in memory.
      this.options.logger?.log("warn", "Eva could not save the location in the vault.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The public key that a device needs to subscribe, and whether this machine sends the alerts. */
  pushKey(): { readonly publicKey: string; readonly isHub: boolean } {
    return { publicKey: this.webPush.publicKey(), isHub: this.role() === "hub" };
  }

  pushDevices(): PushDevice[] {
    return this.webPush.devices();
  }

  /** `deviceToken` is the caller's device login, or null for a login with the token. */
  subscribePush(subscription: PushSubscriptionInput, label: string, deviceToken: string | null): void {
    const device = deviceToken === null ? undefined : this.deviceLogins.list(deviceToken).find((each) => each.current);
    this.webPush.subscribe(subscription, label, device?.id ?? null);
  }

  unsubscribePush(endpoint: string): boolean {
    return this.webPush.unsubscribe(endpoint);
  }

  /** False when the device has no subscription. */
  setPushKinds(endpoint: string, kinds: readonly NotificationKind[]): boolean {
    return this.webPush.setKinds(endpoint, kinds);
  }

  /**
   * A page of a device is in view, with the chats that it shows, or went out of view. Eva sends
   * that device no alert while one of its pages is in view, and no chat's answer while one of its
   * pages shows that chat. `chats` null: a page from before #614, which holds back every chat's push.
   * False when the device has no subscription.
   */
  markPushInView(endpoint: string, pageId: string, inView: boolean, chats: readonly string[] | null = []): boolean {
    return this.webPush.markInView(endpoint, pageId, inView, chats);
  }

  /** Sends a test notification to the devices only, not to Telegram. */
  async testPush(): Promise<void> {
    await this.pushAlert(
      {
        key: "push_test",
        level: "news",
        message: "This is a test notification from Eva.",
        at: this.options.now().toISOString(),
      },
      null,
    );
  }

  /**
   * The newest alerts, newest first: a device shows the first one after a push. With an endpoint,
   * only the alerts that went to that device.
   */
  recentNotifications(endpoint: string | null = null): readonly PushedAlert[] {
    return this.recentAlerts
      .filter((entry) => endpoint === null || entry.endpoints.has(endpoint))
      .map((entry) => entry.alert);
  }

  /**
   * `kind` null is a test: it goes to every device. `sessionId`: the chat whose page in view holds
   * the alert back, or null for any page in view.
   */
  private async pushAlert(
    alert: PushedAlertInput,
    kind: NotificationKind | null,
    sessionId: string | null = null,
  ): Promise<void> {
    const endpoints = this.webPush.recipients(kind, sessionId);
    // An entry for nobody would push the entries of the other devices out of the short list.
    if (kind !== null && endpoints.length === 0) return;
    this.pushedCount += 1;
    // The entry goes in the list first: a device reads the list as soon as the push wakes it.
    this.recentAlerts.unshift({ alert: { ...alert, seq: this.pushedCount }, endpoints: new Set(endpoints) });
    this.recentAlerts.splice(recentAlertCount);
    await this.webPush.notify(endpoints);
  }

  /** A turn end of an engine tells whether its login works. Another failure says nothing about it. */
  private reportEngineLogin(event: Extract<SessionEvent, { kind: "turn_failed" | "turn_finished" }>): void {
    if (event.kind === "turn_failed" && event.loginExpired !== true) return;
    // A chat that was deleted meanwhile no longer names its engine.
    const engine = this.sessions.list().find((session) => session.id === event.sessionId)?.engine;
    if (engine === undefined) return;
    this.alerts.report(`engine_login:${engine}`, event.kind === "turn_failed" ? engineLoginProblem(engine) : null);
  }

  /** A front end reports a problem that only it can see, such as a Telegram poll that fails. */
  reportProblem(key: string, problem: AlertProblem | null): void {
    this.alerts.report(key, problem);
  }

  /**
   * The person marked an open problem as read. It stays listed, but the visor stops counting it,
   * until it rises to an error or clears. False when no such problem is open.
   */
  hideProblem(key: string): boolean {
    return this.alerts.hide(key);
  }

  /** The notification history, oldest first. */
  notifications(): NotificationsView {
    return { entries: this.alerts.historyEntries() };
  }

  /** "all" also hides every open problem: the center calls a hidden problem read. */
  markNotificationsRead(choice: { readonly seqs: readonly number[] } | { readonly all: true }): NotificationsView {
    if ("all" in choice) this.alerts.markAllRead();
    else this.alerts.markRead(choice.seqs);
    return this.notifications();
  }

  /**
   * Reports the migrations that ran at start. Call it after the Telegram bot starts, so that a
   * failure reaches Telegram on the hub.
   */
  reportStartMigrations(result: StartMigrations): void {
    this.reportMigrationRun("machine", result.machine);
    if (result.vault !== null) this.reportMigrationRun("vault", result.vault);
    if (result.vault?.kind === "done") this.alignTemplate();
    this.noticeVaultAhead();
  }

  /**
   * The person's facts that the web page uses, from `Life/About me.md`, and the facts that Eva
   * still needs. Null when no vault is configured.
   */
  async personalFacts(): Promise<PersonalFactsView | null> {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return null;
    // The first commit never changes, so one git call serves every read.
    this.vaultFirstCommit ??= firstCommitDay(vaultPath, this.options.runner, this.gitEnvironmentForReads);
    const firstCommit = await this.vaultFirstCommit;
    const about = readAboutMe(vaultPath);
    // The most useful fact first: the new chat page asks for one at a time.
    const missing = (["birthDate", "region"] as const).filter((key) => about[key] === null);
    return {
      name: about.name,
      birthDate: about.birthDate,
      region: about.region,
      hemisphere: about.hemisphere,
      installedOn: installedOn(vaultPath, firstCommit),
      missing,
    };
  }

  /**
   * The state of each template part of the vault, with no change, and whether this machine takes
   * the person's choice. Null when no vault is configured.
   */
  templateParts(): { readonly parts: TemplatePart[]; readonly canChoose: boolean } | null {
    const parts = this.templateAlignment?.list();
    return parts === undefined ? null : { parts, canChoose: this.role() === "hub" };
  }

  /** The person's choice for a part that differs: this Eva's version, or their own. */
  chooseTemplateVersion(path: string, choice: "new" | "mine"): TemplatePart[] {
    const alignment = this.templateAlignment;
    if (alignment === null) throw new EvaError("vault_not_found", "No vault is configured.");
    // Only the hub writes the template parts, so two machines never race on one file.
    if (this.role() !== "hub") {
      throw new EvaError(
        "setting_forbidden",
        "Only the hub computer changes the template parts. Open its page to choose.",
      );
    }
    const parts = choice === "new" ? alignment.useNew(path) : alignment.keepMine(path);
    this.alerts.report("template_alignment", alignmentProblem(parts));
    return parts;
  }

  /**
   * Brings the vault's template parts up to date on the hub, after the vault migrations. Only the
   * hub writes them, so two machines never race on one file. A part that the person changed raises an alert.
   */
  private alignTemplate(): void {
    const alignment = this.templateAlignment;
    const vaultPath = this.options.config.vaultPath;
    if (alignment === null || vaultPath === null || !existsSync(vaultPath) || this.role() !== "hub") return;
    try {
      this.alerts.report("template_alignment", alignmentProblem(alignment.align()));
    } catch (caught) {
      // A vault from a newer Eva refuses the write, and its own alert already says so.
      this.options.logger?.log("warn", "The template alignment did not run.", { error: String(caught) });
    }
  }

  /**
   * Checks the template parts again after a sync: a pull can bring a choice or a fix that the
   * person made by hand. Only the hub raises the alert, so it never shows twice.
   */
  private noticeTemplateParts(): void {
    const alignment = this.templateAlignment;
    const vaultPath = this.options.config.vaultPath;
    if (alignment === null || vaultPath === null || !existsSync(vaultPath)) return;
    this.alerts.report("template_alignment", this.role() === "hub" ? alignmentProblem(alignment.list()) : null);
  }

  /**
   * Raises an alert while the default engine has no program, so a failed chat has a reason on the
   * phone. Call it after the Telegram bot starts. Chats read the engines at start, so the start value counts.
   */
  noticeDefaultEngine(): void {
    const engine = this.options.config.engines.default;
    const state = this.options.engines.some((loaded) => loaded.name === engine)
      ? "loaded"
      : (this.options.locateEngine?.(engine) ?? null) === null
        ? "missing"
        : "installed";
    this.alerts.report(
      "default_engine",
      engineMissingProblem(engine, state, this.options.toolPlaces?.platform ?? process.platform),
    );
    this.alerts.report("default_engine_restart", engineRestartProblem(engine, state));
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
    this.claudeLogin.stop();
    this.githubLogin.stop();
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

  /** Asks each tool for its version, so a phone sees them as `eva doctor` does. */
  async versions(): Promise<EvaVersions> {
    const claude = this.options.claudeExecutable ?? null;
    const pi = this.options.config.engines.pi.executable;
    const tools = await readToolVersions({
      platform: process.platform,
      userHome: homedir(),
      standalone: false,
      ...this.options.toolPlaces,
      runner: this.options.runner,
      environment: engineToolEnvironment(this.facts),
      executables: { ...(claude === null ? {} : { "claude-code": claude }), ...(pi === null ? {} : { pi }) },
    });
    const found = (program: string): boolean => tools.some((tool) => tool.program === program && tool.version !== null);
    return {
      eva: evaVersion,
      tools: tools.map((tool) => ({ ...tool, version: tool.version === null ? null : this.redact(tool.version) })),
      voiceNotes: {
        missing: [
          ...(found("ffmpeg") ? [] : (["ffmpeg"] as const)),
          ...(found("whisper-cli") ? [] : (["whisper-cli"] as const)),
          ...(existsSync(this.voiceModelPath()) ? [] : (["speech model"] as const)),
        ],
        on: this.transcribe !== null,
      },
    };
  }

  /** The configured model, or where the machine default looks for it. */
  private voiceModelPath(): string {
    return this.options.config.voice.modelPath ?? defaultVoiceModelPath(this.options.paths.root);
  }

  /**
   * Installs each part of voice notes that the machine lacks, so voice notes need no terminal.
   * Never while work runs, as for the other tools. A failure gives the steps by hand.
   */
  async installVoiceNotes(): Promise<ToolInstallResult> {
    if (this.toolInstallRuns)
      return { ok: false, message: "Eva is installing another tool. Try again when it is done." };
    if (this.workRuns())
      return {
        ok: false,
        message: "Eva installs voice notes when no chat runs a turn. Try again when your chats are done.",
      };
    this.toolInstallRuns = true;
    try {
      const { missing } = (await this.versions()).voiceNotes;
      const inputs = this.toolInstallInputs();
      if (missing.includes("ffmpeg")) await installFfmpeg(inputs);
      if (missing.includes("whisper-cli")) await installWhisper(inputs);
      if (missing.includes("speech model")) await installVoiceModel(this.voiceModelPath(), inputs);
      return { ok: true, message: "Installed voice notes. Press Restart Eva to turn them on." };
    } catch (error) {
      if (!isEvaError(error, "engine_install_failed")) throw error;
      return { ok: false, message: this.redact(error.message) };
    } finally {
      this.toolInstallRuns = false;
    }
  }

  /**
   * The newest published version of each tool that Eva installs. GitHub allows 60 requests an
   * hour without a login, so a found version stays for an hour, and a failure for 10 minutes.
   */
  async latestToolVersions(): Promise<LatestToolVersion[]> {
    const sources = this.options.toolLatestSources ?? defaultLatestVersionSources;
    const now = this.options.now().getTime();
    const channel = claudeUpdateChannel(engineFolders(this.options.paths).claude);
    return Promise.all(
      installableTools.map(async (program) => {
        // A change of the channel gives another version, so each channel keeps its own.
        const key = program === "claude" ? `claude:${channel}` : program;
        const kept = this.latestToolCache.get(key);
        if (kept !== undefined) {
          const latest = await kept.lookup;
          if (now - kept.at < (latest === null ? latestToolFailureKeepMs : latestToolKeepMs))
            return { program, latest };
        }
        const lookup = readLatestVersion(program, sources, channel);
        this.latestToolCache.set(key, { lookup, at: now });
        return { program, latest: await lookup };
      }),
    );
  }

  /**
   * Installs the tool, or its latest version over the one there. Never while work runs: an
   * agent may run the tool, and the install replaces it. A failure gives the steps by hand.
   */
  async installTool(program: InstallableTool): Promise<ToolInstallResult> {
    if (this.toolInstallRuns)
      return { ok: false, message: "Eva is installing another tool. Try again when it is done." };
    if (this.workRuns())
      return {
        ok: false,
        message: `Eva installs ${program} when no chat runs a turn. Try again when your chats are done.`,
      };
    this.toolInstallRuns = true;
    try {
      const inputs = this.toolInstallInputs();
      const path = await (program === "claude"
        ? installEngine("claude-code", { ...inputs, configured: this.options.claudeExecutable ?? null })
        : program === "pi"
          ? installEngine("pi", { ...inputs, configured: this.options.config.engines.pi.executable })
          : program === "uv"
            ? installUv(inputs)
            : installGh(inputs));
      this.installedPrograms.set(program, path);
      if (program === "uv") this.uvAnswer = null;
      const restart = program === "claude" || program === "pi" ? " Press Restart Eva so that chats use it." : "";
      return { ok: true, message: `Installed ${program}.${restart}` };
    } catch (error) {
      if (!isEvaError(error, "engine_install_failed")) throw error;
      return { ok: false, message: this.redact(error.message) };
    } finally {
      this.toolInstallRuns = false;
    }
  }

  /** The installers download through the person's proxy, as setup's do. */
  private toolInstallInputs(): VoiceInstallInputs {
    return {
      runner: this.options.runner,
      environment: buildChildEnvironment(this.options.processEnvironment, [
        ...baseEnvironmentAllowlist,
        ...proxyEnvironmentAllowlist,
      ]),
      platform: this.options.toolPlaces?.platform ?? process.platform,
      arch: process.arch,
      homeFolder: this.options.toolPlaces?.userHome ?? homedir(),
      ...this.options.toolInstall,
    };
  }

  /** Removes secrets from a text that leaves the core, such as an error message (lesson 95). */
  redact(text: string): string {
    return this.redactor.redact(text);
  }

  status(): EvaStatus {
    const sessions = this.sessions.list();
    const progress = this.setupProgress();
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
      vaultAutoSync: this.options.config.sync.enabled,
      sessionCount: sessions.length,
      busySessionIds: sessions.filter((session) => this.sessions.isBusy(session.id)).map((session) => session.id),
      lastTurn: this.lastTurn,
      update: this.updateStatus(),
      remoteAccess: this.options.remoteAccess?.current() ?? null,
      localUrl: `http://127.0.0.1:${String(this.options.config.port)}`,
      problems: this.alerts.openProblems(),
      problemDetails: this.alerts.problemDetails(),
      setupMissing: missingSteps(progress),
      chatBlocker: this.chatBlocker(progress),
      voiceNotes: this.transcribe !== null,
    };
  }

  /** Turns a voice note into text on this machine. Throws `voice_unavailable` with no whisper model. */
  async transcribeVoiceNote(audio: Uint8Array): Promise<string> {
    if (this.transcribe === null)
      throw new EvaError(
        "voice_unavailable",
        "Voice notes are not set up on this machine. Open Settings, then Updates, and press Install voice notes.",
      );
    return (await this.transcribe(audio)).trim();
  }

  projects(query: ProjectQuery = {}): Project[] {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return [];
    return searchProjects(discoverProjects({ vaultPath, extraRoots: this.options.config.projectRoots }), query);
  }

  createAssistantSession(input: NewChatInput): SessionRecord {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null)
      throw new EvaError("vault_not_found", "Eva needs your vault. Finish the setup in Settings, on Eva's page.");
    return this.sessions.createSession({
      mode: "assistant",
      engine: input.engine ?? this.options.config.engines.default,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      startFolder: vaultPath,
      source: input.source,
      ...(input.telegramTopicId === undefined ? {} : { telegramTopicId: input.telegramTopicId }),
      ...(input.title === undefined ? {} : { title: input.title }),
    });
  }

  /** What the undo before a retry of this turn would do now (#525). A Project chat has nothing to undo. */
  retryUndoPreview(sessionId: string, turnIndex: number): Promise<UndoPreview> {
    this.sessions.get(sessionId);
    return this.vault.undoPreview(answersToUndo(this.sessions.list(), sessionId, turnIndex));
  }

  /**
   * Runs a turn again on a new branch. With `undo`, Eva first restores the files that the answers
   * from this turn on changed. A failed undo refuses the retry, so the person sees why.
   */
  async retryTurn(sessionId: string, turnIndex: number, undo: boolean): Promise<SessionRecord> {
    const answers = undo ? answersToUndo(this.sessions.list(), sessionId, turnIndex) : [];
    if (answers.length > 0) await this.vault.undo(answers);
    return this.sessions.retry(sessionId, turnIndex);
  }

  /** A Project chat in the named clone, or in a free clone, or in a new clone. */
  createProjectSession(input: NewProjectChatInput): Promise<SessionRecord> {
    return this.projectWork.createSession(input);
  }

  /**
   * Opens a new chat that goes on from a summary of another chat (issue 522). An Assistant chat
   * goes on in the vault, and a Project chat in a clone that the usual choice picks. A failed
   * summary still opens the chat, with no draft, and gives the reason.
   */
  async continueFromSummary(
    sessionId: string,
    source: SessionRecord["source"],
  ): Promise<{ readonly session: SessionRecord; readonly summaryFailure: string | null }> {
    const old = this.sessions.get(sessionId);
    const gitState = old.mode === "project" ? await this.projectWork.gitState(old.startFolder) : null;
    const summary = await this.chatSummaries.summarize({
      engine: old.engine,
      model: old.modelAlias,
      turns: this.sessions.branchTurns(old.id),
      gitState,
    });
    // The summary takes long, and the person may delete the old chat meanwhile: then no new chat opens.
    this.sessions.get(old.id);
    const input = { source, model: old.modelAlias, effort: old.effort, engine: old.engine };
    let created: SessionRecord;
    if (old.mode === "assistant") created = this.createAssistantSession(input);
    else if (old.projectId === null) throw new EvaError("project_not_found", "This Project chat names no project.");
    else created = await this.createProjectSession({ ...input, projectId: old.projectId });
    return {
      session: this.sessions.continueFrom(created.id, old.id, summary.ok ? summary.text : null),
      summaryFailure: summary.ok ? null : summary.reason,
    };
  }

  /**
   * A fork of a chat at one answer. A fork of a Project chat can run in a new clone, with the files of
   * that answer or a clean clone (issue 523). The notice says why a fork lost its history, or is null.
   */
  forkChat(sessionId: string, atMessageId: string, files?: ForkFiles): Promise<BranchResult> {
    return this.projectWork.fork(sessionId, atMessageId, files);
  }

  /** A retry of a turn. A retry of a Project chat can undo the turn's files, or run in a new clone (issue 523). */
  retryChat(sessionId: string, turnIndex: number, files?: RetryChoice): Promise<BranchResult> {
    return this.projectWork.retry(sessionId, turnIndex, files);
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

  /** Runs the direct fixes of a repository's report, and gives the request that a chat must do. */
  fixRepository(projectId: string, repository: string, items: readonly string[] | null): Promise<RepositoryFixResult> {
    return this.projectWork.fixRepository(projectId, repository, items);
  }

  /** Sets the type of one repository of a project, so its setup report shows. */
  setRepositoryType(projectId: string, repository: string, type: RepositoryTypeName): ProjectFile {
    return this.projectWork.setRepositoryType(projectId, repository, type);
  }

  /** The clones of a project, with their branch and pull request. */
  clones(projectId: string): Promise<CloneDetails[]> {
    return this.projectWork.clones(projectId);
  }

  /** Fetches each clone of a project, for the counts of commits to pull. */
  fetchClones(projectId: string): Promise<CloneFetch> {
    return this.projectWork.fetchClones(projectId);
  }

  /** A fast-forward pull of one repository of a clone. */
  pullClone(projectId: string, cloneName: string, repositoryName: string): Promise<void> {
    return this.projectWork.pullClone(projectId, cloneName, repositoryName);
  }

  /** Pulls each clone of a project that is behind its remote. */
  pullClones(projectId: string): Promise<CloneFetch> {
    return this.projectWork.pullClones(projectId);
  }

  /** Commits every change of one repository of a clone and pushes it. An empty note lets a model write the message. */
  pushClone(
    projectId: string,
    cloneName: string,
    repositoryName: string,
    note: string,
  ): Promise<{ readonly message: string }> {
    return this.projectWork.pushClone(projectId, cloneName, repositoryName, note);
  }

  /** Clones every repository of a project into its next free clone folder (the "New clone" button). */
  newClone(projectId: string): Promise<Clone> {
    return this.projectWork.newClone(projectId);
  }

  /** Deletes a clone folder and its chats, unless Eva works there now. */
  deleteClone(projectId: string, cloneName: string): Promise<{ deletedChats: string[] }> {
    return this.projectWork.deleteClone(projectId, cloneName);
  }

  /** A vault folder's entries, or a text file, for the file explorer of the web page. */
  browseFiles(path: string): BrowsedPath {
    return browseVault(this.browsedVault(), path, (text) => this.redactor.redact(text));
  }

  /** The vault files and folders whose name holds `query`, and with `contents` the files whose text holds it. */
  searchFiles(query: string, contents: boolean): SearchResult {
    return searchVault(this.browsedVault(), query, { contents }, (text) => this.redactor.redact(text));
  }

  /** A vault file, or a folder as one zip, for the Download button of the file explorer. */
  downloadFile(path: string): VaultDownload {
    return downloadVaultPath(this.browsedVault(), path, (text) => this.redactor.redact(text));
  }

  /** Replaces the text of a vault file from the file explorer. The idle sweep commits the change. */
  saveFile(path: string, version: string, text: string): BrowsedPath {
    return saveVaultFile(this.browsedVault(), path, version, text, (shown) => this.redactor.redact(shown));
  }

  /** Keeps a file that the person attached in the web chat, as Telegram does, and answers the note for the agent. */
  receiveFile(name: string, bytes: Uint8Array): { path: string; note: string } {
    const path = saveReceivedFile(this.browsedVault(), name, bytes);
    return { path, note: receivedFileNote(path) };
  }

  /** The favorite files and folders, which the file explorer shows first. */
  favoriteFiles(): Favorite[] {
    return readFavorites(this.browsedVault());
  }

  /** Adds a vault path to the favorites, or removes it. The idle sweep commits the change. */
  setFavoriteFile(path: string, favorite: boolean): Favorite[] {
    return setFavorite(this.browsedVault(), path, favorite);
  }

  /** Renames a vault file or folder from the file explorer, and answers its new path. The idle sweep commits it. */
  renameFile(path: string, name: string): { path: string } {
    const vaultPath = this.browsedVault();
    const renamed = renameVaultEntry(vaultPath, path, name);
    try {
      moveFavorites(vaultPath, normalizedPath(path), renamed);
    } catch {
      // The rename is done. A favorite that could not follow it shows as missing, and the person can star it again.
    }
    return { path: renamed };
  }

  private browsedVault(): string {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null)
      throw new EvaError("vault_not_found", "Eva needs your vault. Finish the setup in Settings, on Eva's page.");
    return vaultPath;
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

  /**
   * Creates a project from the form, with a GitHub repository of a type and a Drive folder when
   * asked. The repository then gets the setup of its type. The idle sweep commits the new files.
   */
  createProject(input: NewProjectInput): Promise<NewProjectResult> {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null)
      throw new EvaError("vault_not_found", "Eva needs your vault. Finish the setup in Settings, on Eva's page.");
    // The machine's own zone when none is set, as vault setup does: a new project is named in local time.
    const timeZone = this.options.config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return createProject(
      input,
      { projectsFolder: join(vaultPath, "Projects"), wallClock: wallClockOf(this.options.now(), timeZone) },
      {
        createRepository: async (name, description, visibility) => {
          const token = this.settings.secrets.githubToken;
          if (token === undefined)
            throw new EvaError("github_failed", "Log in to GitHub in Settings > Connections > GitHub first.");
          const repository = await createGitHubRepository({
            token,
            name,
            ...(description === "" ? {} : { description }),
            initialize: true,
            visibility,
            ...(this.options.githubApiBaseUrl === undefined ? {} : { baseUrl: this.options.githubApiBaseUrl }),
          });
          return repository.cloneUrl.replace(/\.git$/, "");
        },
        createDriveFolder: (name) =>
          createDriveFolder(
            {
              config: this.settings.config.google,
              client: this.googleClient(),
              credentialsFolder: googleCredentialsFolder(this.options.paths),
              ...(this.options.googleBaseUrl === undefined ? {} : { baseUrl: this.options.googleBaseUrl }),
            },
            name,
          ),
        setUpRepository: (projectId, url) => this.projectWork.setUpRepository(projectId, url),
      },
    );
  }

  publicSettings(): PublicSettings {
    return this.settings.publicSettings();
  }

  /** Checks and saves a settings change; see `LiveSettings.update`. */
  updateSettings(patch: Readonly<Record<string, unknown>>): { saved: true; restartNeeded: boolean } {
    return this.settings.update(patch);
  }

  /** Whose repositories Eva trusts, and the person's saved answers, for Settings. */
  trust(): TrustOverview {
    return {
      githubAccount: loadGitHubAccount(this.options.paths)?.login ?? null,
      githubLoggedIn: this.settings.secrets.githubToken !== undefined,
      owners: this.settings.config.trust.trustedRepositoryOwners,
      answers: this.trustStore.answers(),
    };
  }

  /**
   * What each engine may do, and the person's own rules, for Settings. The engines read the
   * config folder of their own runs, which holds no token.
   */
  permissions(): PermissionsOverview {
    const context = { vaultFolder: this.options.config.vaultPath, environment: engineToolEnvironment(this.facts) };
    return this.options.engines.flatMap((engine) =>
      engine.describePermissions === undefined ? [] : [{ engine: engine.name, ...engine.describePermissions(context) }],
    );
  }

  /** Removes a saved answer, so the next project chat on that repository asks again. */
  forgetTrustAnswer(url: string): TrustOverview {
    this.trustStore.forget(url);
    return this.trust();
  }

  /** The owners in the settings, and the account of this Eva's GitHub login: she trusts her own work. */
  private trustedOwners(): readonly string[] {
    const login = loadGitHubAccount(this.options.paths)?.login;
    // From memory, not the file: only a save through Eva changes whom she trusts while she runs.
    const owners = this.settings.config.trust.trustedRepositoryOwners;
    return login === undefined ? owners : [...owners, login];
  }

  async setupState(): Promise<EvaSetupState> {
    const saved = this.settings.saved().secrets;
    // The engines, git and Telegram read the tokens at start, so a token saved since then waits for a restart.
    // The vault folder too: sync, the schedules and the Assistant read it at start.
    // An engine program that the page installed starts with the next Eva.
    const restartNeeded =
      pageSecretNames.some((name) => saved[name] !== this.options.secrets[name]) ||
      this.savedVaultPath() !== this.options.config.vaultPath ||
      this.newEngines().length > 0;
    const google = this.settings.saved().config.google.email !== null;
    return {
      ...(await this.settings.setupState()),
      installedEngines: this.newEngines(),
      progress: this.setupProgress(),
      restartNeeded,
      vaultNeedsPush: await this.vaultSetup.needsPush(),
      // Only a Google account needs uv, so Eva asks for it only then.
      uvMissing: google && !(await this.uvRuns()),
    };
  }

  /**
   * Whether a chat can run uv. The page reads the setup state often, so the answer stays for a
   * minute, and an install asks again. The question needs no token.
   */
  private uvRuns(): Promise<boolean> {
    const now = this.options.now().getTime();
    if (this.uvAnswer === null || now - this.uvAnswer.at > uvAnswerKeepMs)
      this.uvAnswer = { at: now, runs: uvRuns(this.options.runner, engineToolEnvironment(this.facts)) };
    return this.uvAnswer.runs;
  }

  /** The engines whose program the page installed since the start, which no engine runs yet. */
  private newEngines(): EngineName[] {
    const started = new Set(this.options.engines.map((engine) => engine.name));
    const installed: readonly [InstallableTool, EngineName][] = [
      ["claude", "claude-code"],
      ["pi", "pi"],
    ];
    return installed.flatMap(([program, engine]) =>
      this.installedPrograms.has(program) && !started.has(engine) ? [engine] : [],
    );
  }

  /** The person's GitHub repositories, for the vault step; see `VaultSetup`. */
  vaultRepositories(): Promise<GitHubRepository[]> {
    return this.vaultSetup.repositories();
  }

  /** Clones the vault that the person picked on the page; a restart starts to use it. */
  async cloneVault(repository: string): Promise<VaultSetupResult> {
    return this.redactSetup(await this.vaultSetup.clone(repository));
  }

  /** Starts a new vault from the template, and pushes it to a new private repository. */
  async createVault(answers: NewVaultAnswers): Promise<VaultSetupResult> {
    return this.redactSetup(await this.vaultSetup.create(answers));
  }

  /** Pushes a new local vault to a new private repository, or to an empty one. */
  async pushVault(repository: string): Promise<VaultSetupResult> {
    return this.redactSetup(await this.vaultSetup.push(repository));
  }

  /** A result is no error, so it skips the API's redaction; git's text may name a typed address with a token. */
  private redactSetup(result: VaultSetupResult): VaultSetupResult {
    const redact = (text: string | null): string | null => (text === null ? null : this.redactor.redact(text));
    return { folder: result.folder, repository: redact(result.repository), problem: redact(result.problem) };
  }

  /**
   * The vault folder in `config.json` now, with the machine default. It skips the vault's own
   * settings file: a broken one there must not hide a vault that the page just cloned.
   */
  private savedVaultPath(): string | null {
    const paths = this.options.paths;
    if (!existsSync(paths.config)) return this.settings.config.vaultPath;
    try {
      return withMachineDefaults(loadConfig(paths), { homeRoot: paths.root, exists: existsSync }).vaultPath;
    } catch {
      return this.settings.config.vaultPath;
    }
  }

  /** Each setup step, from the files as they are now: `eva setup` may have saved a step meanwhile. */
  setupProgress(): ProgressStep[] {
    return this.progressWith(this.settings.saved().secrets, this.newEngines());
  }

  /**
   * The step that stops every chat. The engines read the Claude token at start, so the running
   * login decides. A token that only the files hold, or a new engine program, needs a restart first.
   */
  private chatBlocker(progress: readonly ProgressStep[]): ChatBlocker | null {
    const running = chatBlocker(this.progressWith(this.options.secrets, []));
    if (running !== "engine") return running;
    return chatBlocker(progress) === "engine" ? "engine" : "restart";
  }

  private progressWith(secrets: EvaSecrets, newEngines: readonly EngineName[]): ProgressStep[] {
    const { config } = this.settings.saved();
    const secretsSet = {
      claudeOauthToken: secrets.claudeOauthToken !== undefined,
      githubToken: secrets.githubToken !== undefined,
      telegramBotToken: secrets.telegramBotToken !== undefined,
    };
    const vaultPath = this.savedVaultPath();
    // A saved but empty folder holds no vault yet, as after a failed clone: the step offers it again.
    const vaultReady = vaultPath !== null && holdsFiles(vaultPath);
    const folders = engineFolders(this.options.paths);
    const found = new Set([...this.options.engines.map((engine) => engine.name), ...newEngines]);
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
      vaultPath: vaultReady ? vaultPath : null,
      githubToken: secretsSet.githubToken,
      githubCli: githubCliAccount(folders.gh) !== null,
      remoteAccess: this.options.remoteAccess?.current() ?? null,
      devices: this.deviceLogins.count(),
      telegram: { token: secretsSet.telegramBotToken, paired: config.telegram.allowedChatId !== null },
      google: config.google.email !== null,
      checks: Object.fromEntries(this.checkResults),
    });
  }

  /**
   * Saves or removes one secret of the settings page; see `LiveSettings.saveSecret`. A GitHub token
   * also waits for its account, so a restart right after the save still has the commit identity.
   * It also logs the agents' gh in or out: one login serves Eva and her agents (#244).
   */
  async saveSecret(name: PageSecretName, value: string | null): Promise<{ saved: true; restartNeeded: true }> {
    const before = this.settings.secrets.githubToken;
    const result = this.settings.saveSecret(name, value);
    if (name !== "githubToken") return result;
    const token = this.settings.secrets.githubToken;
    if (token === undefined) saveGitHubAccount(this.options.paths, null);
    else if (!(await this.refreshGitHubAccount(token, token !== before)))
      this.options.logger?.log("warn", "Eva could not read the GitHub account, so commits keep git's own name.");
    await this.updateGitHubCli(token);
    return result;
  }

  /**
   * Logs the agents' gh in with the saved token, or out when none is saved. One change runs at a
   * time, and only the token that is still saved reaches gh: a quick second save wins. The vault
   * works with the token alone, so a gh problem never fails the save. The GitHub step shows it.
   */
  private updateGitHubCli(token: string | undefined): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.settings.secrets.githubToken !== token) return;
      const gh = {
        ghFolder: engineFolders(this.options.paths).gh,
        runner: this.options.runner,
        environment: this.options.processEnvironment,
      };
      const problem =
        token === undefined
          ? logOutGitHubCli(gh.ghFolder)
          : ((await this.ghReadyForLogin()) ?? (await logInGitHubCli({ ...gh, token })));
      if (problem !== null)
        this.options.logger?.log(
          "warn",
          `Eva could not log ${token === undefined ? "out" : "in"} the agents' gh. ${this.redactor.redact(problem)}`,
        );
    };
    // A change that failed must not stop the ones after it.
    const next = this.githubCliChanges.then(run, run);
    this.githubCliChanges = next.catch(() => undefined);
    return next;
  }

  /**
   * A machine with no gh, or one too old for the login, gets the latest one first. So the person
   * fixes a missing gh from the phone with one press of Log in. Returns why it failed, or null.
   */
  private async ghReadyForLogin(): Promise<string | null> {
    const inputs = this.toolInstallInputs();
    const found = await findGh(inputs);
    if (found !== null && !ghTooOld(found.version)) return null;
    try {
      await installGh(inputs);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The account gives the commit name and email from the next start on. */
  private refreshGitHubAccount(token: string, replacesToken = false): Promise<boolean> {
    return refreshGitHubAccount(this.options.paths, token, {
      ...(this.options.githubApiBaseUrl === undefined ? {} : { baseUrl: this.options.githubApiBaseUrl }),
      replacesToken,
      isCurrent: () => this.settings.secrets.githubToken === token,
    });
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
      model: this.settings.config.engines.defaultModel,
      redact: (text) => this.redactor.redact(text),
      telegramToken: secrets.telegramBotToken ?? null,
      githubToken: secrets.githubToken ?? null,
      ...(this.options.githubApiBaseUrl === undefined ? {} : { githubBaseUrl: this.options.githubApiBaseUrl }),
      google: {
        config: this.settings.config.google,
        client: this.googleClient(),
        credentialsFolder: googleCredentialsFolder(this.options.paths),
        readServices: true,
        ...(this.options.googleBaseUrl === undefined ? {} : { baseUrl: this.options.googleBaseUrl }),
      },
    });
    // A token from before Eva kept the account has no record, and Eva never reads it at start. The read
    // checks the token itself: the Test can fail on the agents' gh alone (#244).
    const token = secrets.githubToken;
    if (name === "github" && token !== undefined && loadGitHubAccount(this.options.paths) === null)
      await this.refreshGitHubAccount(token);
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
    // Google refuses a wrong client id on its own page, where Eva never sees why (#323).
    const idProblem = googleClientIdProblem(client.clientId);
    if (idProblem !== null) throw new EvaError("google_failed", idProblem);
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

  /**
   * Deletes the saved Google login and clears the account. The OAuth client stays, so a new
   * login needs no new setup. Chats got the account at start, so they keep it until a restart.
   */
  async logOutOfGoogle(): Promise<{ restartNeeded: boolean }> {
    const email = this.settings.config.google.email;
    if (email !== null) {
      await this.googleLogin.forget(email);
      this.settings.update({ google: { email: null } });
    }
    return { restartNeeded: this.googleRestartNeeded() };
  }

  /** The address of Claude's login page, from `claude setup-token`. */
  startClaudeLogin(): Promise<{ url: string }> {
    return this.claudeLogin.start();
  }

  /**
   * Types the code from Claude's page and saves the token, the same as a pasted token. The
   * engines read the token at start, so it needs a restart.
   */
  async finishClaudeLogin(code: string): Promise<{ restartNeeded: true }> {
    const { token } = await this.claudeLogin.finish(code);
    return { restartNeeded: this.settings.saveSecret("claudeOauthToken", token).restartNeeded };
  }

  /** Starts the GitHub browser login, or gives the code of the login that waits. */
  startGitHubLogin(): Promise<{ code: string; url: string }> {
    return this.githubLogin.start();
  }

  /** Waits until the person confirms the code and the token is saved. Git reads it at start. */
  async finishGitHubLogin(): Promise<{ restartNeeded: true }> {
    await this.githubLogin.finish();
    return { restartNeeded: true };
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

  /**
   * Claims the hub when a start could not, such as before the network was up (#529). The fetch
   * comes first, so the claim never hides one that another machine pushed. The role stays "hub":
   * a vault with no claim reads as the hub, so the start already ran the vault migrations.
   */
  private claimHubAfterFetch(): void {
    const vaultPath = this.options.config.vaultPath;
    if (vaultPath === null) return;
    // A full disk must not stop the sync step.
    try {
      if (claimHubIfUnclaimed(vaultPath, this.machine, this.options.now()))
        this.options.logger?.log("info", "No machine was the hub yet, so this machine claimed it.");
    } catch (error) {
      this.options.logger?.log("warn", "The hub claim failed.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
    if (role === "hub") {
      if (this.runVaultMigrations()?.kind === "done") this.alignTemplate();
    } else {
      this.alerts.report("template_alignment", null);
    }
    for (const listener of this.roleListeners) listener(role);
  }

  private runVaultMigrations(): MigrationRun | null {
    const vaultPath = this.options.config.vaultPath;
    // A vault folder that is not cloned yet has no hub file, so this machine reads as the hub.
    if (vaultPath === null || !existsSync(vaultPath)) return null;
    const run = runMigrations({
      store: "vault",
      migrations,
      paths: this.options.paths,
      vaultPath,
      version: evaVersion,
      now: this.options.now,
    });
    this.reportMigrationRun("vault", run);
    return run;
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
      .filter((alert) => alert.key !== "vault_sync" && !alert.key.startsWith("machine:"))
      // The hub sends the reminders, so it must know which notice the person hid here.
      .map((alert) => (this.alerts.isHidden(alert.key) ? { ...alert, hidden: true as const } : alert));
    const now = this.options.now();
    const written = writeMachineReport(vaultPath, { machine: this.machine, version: evaVersion, problems }, now);
    if (written === "no_vault") return;
    this.noticeReportName(written === "name_taken");

    if (!isHub) {
      this.forgetStaleRelayedMarks();
      return;
    }
    const relayed = new Map<string, ReadonlySet<string>>();
    for (const { file, report } of readMachineReports(vaultPath)) {
      if (report === null) {
        // A broken file, such as one in a sync conflict, keeps its problems until it reads again.
        const kept = this.relayed.get(file);
        if (kept !== undefined) relayed.set(file, kept);
        continue;
      }
      if (report.machine === this.machine) continue;
      const ageMs = report.reportedAt === undefined ? null : now.getTime() - Date.parse(report.reportedAt);
      const keys = new Set<string>();
      for (const problem of report.problems) {
        const key = `machine:${report.machine}:${problem.key}`;
        keys.add(key);
        // The person hid it on that machine, so the hub sends no alert for it either.
        if (problem.hidden === true) this.alerts.markHidden(key, problem.level);
        this.alerts.report(
          key,
          relayedProblem(report.machine, this.machine, machineReportFile(report.machine), problem, ageMs),
        );
      }
      relayed.set(file, keys);
    }
    for (const [file, keys] of this.relayed)
      for (const key of keys) if (relayed.get(file)?.has(key) !== true) this.alerts.report(key, null);
    this.relayed = relayed;
    this.forgetStaleRelayedMarks();
  }

  /**
   * Once, after the first read of the machine reports. A relayed problem that cleared while Eva
   * was off never reports "resolved" here, so its saved mark would silence its next failure.
   */
  private forgetStaleRelayedMarks(): void {
    if (this.hiddenMarksChecked) return;
    this.hiddenMarksChecked = true;
    this.alerts.forgetHiddenUnlessOpen((key) => key.startsWith("machine:"));
  }

  /** Logs once when another machine's report holds the file of this machine's name. */
  private noticeReportName(taken: boolean): void {
    if (taken && !this.reportNameTaken)
      this.options.logger?.log("warn", "Another machine's report uses the file of this machine's name.", {
        file: machineReportFile(this.machine),
      });
    this.reportNameTaken = taken;
  }

  /** `except` is a chat whose turn ends now, so it no longer counts. */
  private assistantBusy(except?: string): boolean {
    return this.sessions
      .list()
      .some((session) => session.mode === "assistant" && session.id !== except && this.sessions.isBusy(session.id));
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
    const problem = updateProblem(status);
    if (problem !== "keep") this.alerts.report("update", problem);
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

/** A file in place of the folder, or a folder that Eva cannot read, holds no vault. */
function holdsFiles(folder: string): boolean {
  try {
    return readdirSync(folder).length > 0;
  } catch {
    return false;
  }
}

/** The device flow of `eva setup`, with Eva's OAuth App, or null while she has none. */
function defaultGitHubLogin(now: () => Date): DeviceLogin | null {
  const clientId = githubClientId;
  if (clientId === null) return null;
  return (show, sleep) => githubDeviceLogin({ clientId, show, sleep, clock: { now } });
}

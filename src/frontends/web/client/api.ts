/** The web UI's client of the local API. The login cookie carries the token or a device token. */
import type { CheckResult } from "../../../core/checks.ts";
import type {
  EvaSetupState,
  EvaStatus,
  EvaVersions,
  InstallableTool,
  LatestToolVersion,
  PersonalFactsView,
  ToolInstallResult,
  TrustOverview,
} from "../../../core/eva.ts";
import type { ChatBlocker, ProgressStep } from "../../../core/setup/progress.ts";
import type { PageSecretName, PublicSettings } from "../../../core/settings/live-settings.ts";
import type {
  DeviceLoginEvent,
  DeviceLoginRequest,
  DeviceLoginState,
  DeviceSummary,
} from "../../../core/remote-access/device-logins.ts";
import type { RemoteAccess } from "../../../core/remote-access/remote-access.ts";
import type { BrowsedPath, FileEntry } from "../../../core/files/file-browser.ts";
import type { Favorite } from "../../../core/files/vault-favorites.ts";
import type { Clone, CloneDetails } from "../../../core/projects/clones.ts";
import type { GitHubRepository } from "../../../core/vault/github-repositories.ts";
import type { NewVaultAnswers, VaultSetupResult } from "../../../core/vault/vault-setup.ts";
import type { Project } from "../../../core/projects/project-catalog.ts";
import type { CloneFetch } from "../../../core/projects/project-work.ts";
import type { ProjectDetails, ProjectFile } from "../../../core/projects/project-file.ts";
import type { NewProjectInput, NewProjectResult } from "../../../core/projects/new-project.ts";
import type { AssistantRulesFile, AssistantRulesView, RestoredRules } from "../../../core/modes/assistant-rules.ts";
import type { TemplatePart } from "../../../core/vault/template-alignment.ts";
import type { SetupItem, SetupReport, SetupSection } from "../../../core/projects/repository-setup.ts";
import type { ScheduleCard, ScheduleList, ScheduleView } from "../../../core/schedules/scheduler.ts";
import type { PendingApproval, TaskSnapshot, TurnSnapshot } from "../../../core/sessions/session-manager.ts";
import type { SessionRecord } from "../../../core/sessions/session-store.ts";
import type { ListedSession } from "../../api/session-list.ts";
import type { EngineUpdateStatus } from "../../../core/updates/engine-update.ts";
import type { UpdateStatus } from "../../../core/updates/updater.ts";
import type {
  ConflictChoice,
  ConflictResolution,
  VaultConflict,
  VaultConflictReport,
  VaultSyncState,
} from "../../../core/vault/vault-sync.ts";
import type { EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import type { EvaErrorCode } from "../../../shared/errors.ts";
import type { SessionEvent } from "../../../shared/events.ts";

/** A template part of the vault, such as a skill, and how it compares with this Eva's version. */
export type TemplatePartView = TemplatePart;

export type { PersonalFactsView };

export type {
  BrowsedPath,
  ChatBlocker,
  CheckResult,
  CloneDetails,
  CloneFetch,
  ConflictChoice,
  ConflictResolution,
  DeviceLoginEvent,
  DeviceLoginRequest,
  DeviceSummary,
  EngineUpdateStatus,
  EvaStatus,
  Favorite,
  FileEntry,
  InstallableTool,
  EvaVersions,
  TrustOverview,
  PageSecretName,
  PendingApproval,
  NewProjectInput,
  NewProjectResult,
  Project,
  ProjectDetails,
  ProjectFile,
  PublicSettings,
  RemoteAccess,
  ScheduleCard,
  ScheduleList,
  ScheduleView,
  EvaSetupState,
  GitHubRepository,
  ProgressStep,
  SessionEvent,
  ListedSession,
  SessionRecord,
  SetupItem,
  SetupReport,
  SetupSection,
  UpdateStatus,
  VaultConflict,
  VaultConflictReport,
  VaultSetupResult,
  VaultSyncState,
};

export class ApiError extends Error {
  readonly status: number;
  /** The `EvaErrorCode` of the failure, or null when the answer has none. */
  readonly code: EvaErrorCode | null;

  constructor(status: number, message: string, code: EvaErrorCode | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<Body>(method: string, path: string, body?: unknown): Promise<Body> {
  // A Blob, such as a voice note, goes as it is.
  const sent =
    body === undefined
      ? {}
      : body instanceof Blob
        ? { headers: { "content-type": body.type }, body }
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, { method, credentials: "same-origin", headers: {}, ...sent });
  if (!response.ok) throw await failureOf(response);
  return response.status === 204 ? (undefined as Body) : ((await response.json()) as Body);
}

async function failureOf(response: Response): Promise<ApiError> {
  const text = await response.text();
  let message = text;
  let code: EvaErrorCode | null = null;
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: EvaErrorCode };
    message = parsed.error ?? text;
    code = parsed.code ?? null;
  } catch {
    // Not JSON: keep the text.
  }
  return new ApiError(response.status, message, code);
}

/**
 * A vault file, or a folder as a zip, with the name that the core gives it. The page reads it
 * before the save, so a failure shows on the page instead of as a broken file. `onShare` gets
 * the part that arrived, from 0 to 1.
 */
async function download(path: string, onShare: (share: number) => void): Promise<{ name: string; blob: Blob }> {
  const response = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, { credentials: "same-origin" });
  if (!response.ok) throw await failureOf(response);
  const total = Number(response.headers.get("content-length") ?? "0");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  for (let chunk = await reader?.read(); chunk !== undefined && !chunk.done; chunk = await reader?.read()) {
    chunks.push(chunk.value);
    received += chunk.value.byteLength;
    if (total > 0) onShare(received / total);
  }
  const named = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get("content-disposition") ?? "")?.[1];
  const name = named === undefined ? (path.split("/").pop() ?? "download") : decodeURIComponent(named);
  return { name, blob: new Blob(chunks, { type: response.headers.get("content-type") ?? "" }) };
}

export const api = {
  login: (token: string): Promise<void> => request("POST", "/api/login", { token }),
  logout: (): Promise<void> => request("POST", "/api/logout"),
  requestDeviceLogin: (): Promise<DeviceLoginRequest> => request("POST", "/api/login/device", {}),
  /** The device token never reaches the page: the server sets it as an HTTP-only cookie. */
  deviceLoginState: (requestId: string): Promise<{ state: DeviceLoginState["state"] }> =>
    request("GET", `/api/login/device/${encodeURIComponent(requestId)}`),
  logOutEveryDevice: (): Promise<{ removed: number }> => request("DELETE", "/api/devices"),
  devices: (): Promise<DeviceSummary[]> => request("GET", "/api/devices"),
  /** Logs out one device. A browser that removes its own device is logged out too. */
  removeDevice: (id: string): Promise<void> => request("DELETE", `/api/devices/${encodeURIComponent(id)}`),
  /** The device requests that this page may answer, as the event socket sends them. */
  deviceRequests: (): Promise<DeviceLoginRequest[]> => request("GET", "/api/devices/requests"),
  answerDeviceRequest: (id: string, answer: "allow" | "deny"): Promise<void> =>
    request("POST", `/api/devices/requests/${encodeURIComponent(id)}`, { answer }),
  status: (): Promise<EvaStatus> => request("GET", "/api/status"),
  sessions: (): Promise<ListedSession[]> => request("GET", "/api/sessions"),
  /** With no engine, Eva starts the chat on her default engine. */
  newAssistantChat: (model: ModelAlias, engine?: EngineName): Promise<SessionRecord> =>
    request("POST", "/api/sessions", { mode: "assistant", model, ...(engine === undefined ? {} : { engine }) }),
  newProjectChat: (projectId: string, clone: string, model: ModelAlias): Promise<SessionRecord> =>
    request("POST", "/api/sessions", { mode: "project", projectId, clone, model }),
  /** Only a chat with no turn takes a new engine or model (lesson 41). A fork keeps its chat's engine. */
  setEngine: (sessionId: string, engine: EngineName): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/engine`, { engine }),
  setModel: (sessionId: string, model: ModelAlias): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/model`, { model }),
  /** Turns a recording into text on Eva's machine. Eva keeps no audio. */
  transcribe: (audio: Blob): Promise<{ text: string }> => request("POST", "/api/transcribe", audio),
  send: (sessionId: string, text: string): Promise<void> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/messages`, { text }),
  fork: (sessionId: string, atMessageId: string): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/fork`, { atMessageId }),
  stop: (sessionId: string): Promise<{ stopped: boolean }> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/stop`, {}),
  retry: (sessionId: string, turnIndex: number): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/retry`, { turnIndex }),
  deleteChat: (sessionId: string): Promise<{ deleted: string[] }> =>
    request("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`),
  rename: (sessionId: string, title: string): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/rename`, { title }),
  pendingApprovals: (): Promise<PendingApproval[]> => request("GET", "/api/approvals"),
  backgroundTasks: (): Promise<TaskSnapshot> => request("GET", "/api/tasks"),
  runningTurns: (): Promise<TurnSnapshot> => request("GET", "/api/turns"),
  answerApproval: (requestId: string, answer: "allow" | "deny"): Promise<void> =>
    request("POST", `/api/approvals/${encodeURIComponent(requestId)}`, { answer }),
  projects: (text: string, status: string, tag = ""): Promise<Project[]> => {
    const query = new URLSearchParams();
    if (text.trim() !== "") query.set("text", text.trim());
    if (status !== "") query.set("status", status);
    if (tag !== "") query.set("tag", tag);
    return request("GET", `/api/projects?${query.toString()}`);
  },
  clones: (projectId: string): Promise<CloneDetails[]> =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/clones`),
  repositorySetup: (projectId: string): Promise<SetupReport[]> =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/setup`),
  projectFile: (projectId: string): Promise<ProjectFile> =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/file`),
  /** A file that changed since `version` answers 409. */
  saveProjectDetails: (projectId: string, version: string, details: ProjectDetails): Promise<ProjectFile> =>
    request("PUT", `/api/projects/${encodeURIComponent(projectId)}/details`, { version, ...details }),
  saveProjectFile: (projectId: string, version: string, text: string): Promise<ProjectFile> =>
    request("PUT", `/api/projects/${encodeURIComponent(projectId)}/file`, { version, text }),
  /** A failed optional step is in the answer, not an error: the project exists all the same. */
  createProject: (input: NewProjectInput): Promise<NewProjectResult> => request("POST", "/api/projects", input),
  newClone: (projectId: string): Promise<Clone> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones`, {}),
  deleteClone: (projectId: string, clone: string): Promise<{ deletedChats: string[] }> =>
    request("DELETE", `/api/projects/${encodeURIComponent(projectId)}/clones/${encodeURIComponent(clone)}`),
  /** Fetches each clone, so the cards count the commits to pull. A failed fetch is in `problems`. */
  fetchClones: (projectId: string): Promise<CloneFetch> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/fetch`, {}),
  /** Pulls each clone that is behind. A failed pull is in `problems`. */
  pullClones: (projectId: string): Promise<CloneFetch> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/pull`, {}),
  pullClone: (projectId: string, clone: string): Promise<unknown> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/${encodeURIComponent(clone)}/pull`, {}),
  /** Commits every change and pushes. An empty note lets a model write the message. */
  pushClone: (projectId: string, clone: string, note: string): Promise<{ readonly message: string }> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/${encodeURIComponent(clone)}/push`, {
      note,
    }),
  /** A vault folder or file, by its path from the vault root. The empty path is the root. */
  files: (path: string): Promise<BrowsedPath> => request("GET", `/api/files?path=${encodeURIComponent(path)}`),
  /** A file that changed since `version` answers 409 with `file_changed`. */
  saveFile: (path: string, version: string, text: string): Promise<BrowsedPath> =>
    request("PUT", "/api/files", { path, version, text }),
  /** Answers the new path. A name that is taken or not allowed answers 409 with `file_not_writable`. */
  renameFile: (path: string, name: string): Promise<{ path: string }> =>
    request("POST", "/api/files/rename", { path, name }),
  downloadFile: download,
  favorites: (): Promise<Favorite[]> => request("GET", "/api/files/favorites"),
  /** A missing path answers 404 with `file_not_found`. */
  setFavorite: (path: string, favorite: boolean): Promise<Favorite[]> =>
    request("PUT", "/api/files/favorites", { path, favorite }),
  settings: (): Promise<PublicSettings> => request("GET", "/api/settings"),
  saveSettings: (patch: Record<string, unknown>): Promise<{ restartNeeded: boolean }> =>
    request("PUT", "/api/settings", patch),
  setupState: (): Promise<EvaSetupState> => request("GET", "/api/settings/setup"),
  trust: (): Promise<TrustOverview> => request("GET", "/api/trust"),
  forgetTrustAnswer: (url: string): Promise<TrustOverview> => request("DELETE", "/api/trust/answers", { url }),
  pushKey: (): Promise<{ publicKey: string }> => request("GET", "/api/push"),
  addPushDevice: (subscription: PushSubscriptionJSON, label: string): Promise<unknown> =>
    request("POST", "/api/push/devices", { subscription, label }),
  removePushDevice: (endpoint: string): Promise<unknown> => request("DELETE", "/api/push/devices", { endpoint }),
  testPush: (): Promise<void> => request("POST", "/api/push/test"),
  /** Answers 409 when no vault is configured. */
  chatNameRules: (): Promise<{ rules: string }> => request("GET", "/api/chat-names"),
  saveChatNameRules: (rules: string): Promise<{ rules: string }> => request("PUT", "/api/chat-names", { rules }),
  /** Answers 409 when no vault is configured. */
  assistantRules: (): Promise<AssistantRulesView> => request("GET", "/api/assistant-rules"),
  /** Rules that changed since `version` answer 409 with the code `rules_changed`. */
  saveAssistantRules: (version: string, text: string): Promise<AssistantRulesFile> =>
    request("PUT", "/api/assistant-rules", { version, text }),
  restoreAssistantRules: (version: string, backup: boolean): Promise<RestoredRules> =>
    request("POST", "/api/assistant-rules/restore", { version, backup }),
  /** Answers 409 when no vault is configured. */
  aboutMe: (): Promise<PersonalFactsView> => request("GET", "/api/about-me"),
  /** Answers 409 when no vault is configured. */
  templateParts: (): Promise<{ parts: TemplatePartView[]; canChoose: boolean }> =>
    request("GET", "/api/template-parts"),
  chooseTemplateVersion: (
    path: string,
    choice: "new" | "mine",
  ): Promise<{ parts: TemplatePartView[]; canChoose: boolean }> =>
    request("POST", "/api/template-parts", { path, choice }),
  /** The value goes one way: the answer never holds it. */
  saveSecret: (name: PageSecretName, value: string): Promise<{ restartNeeded: boolean }> =>
    request("PUT", `/api/secrets/${name}`, { value }),
  removeSecret: (name: PageSecretName): Promise<{ restartNeeded: boolean }> =>
    request("DELETE", `/api/secrets/${name}`),
  updateStatus: (): Promise<UpdateStatus | null> => request("GET", "/api/update"),
  updateNow: (version?: string): Promise<UpdateStatus> =>
    request("POST", "/api/update", version === undefined ? {} : { version }),
  checkForUpdate: (): Promise<UpdateStatus> => request("POST", "/api/update/check", {}),
  engineUpdateStatus: (): Promise<EngineUpdateStatus | null> => request("GET", "/api/update/engine"),
  versions: (): Promise<EvaVersions> => request("GET", "/api/versions"),
  latestVersions: (): Promise<LatestToolVersion[]> => request("GET", "/api/versions/latest"),
  /** Waits for the whole install, which downloads the tool. */
  installTool: (program: InstallableTool): Promise<ToolInstallResult> =>
    request("POST", "/api/tools/install", { program }),
  /** Waits for the whole install, which downloads ffmpeg, whisper.cpp and the speech model. */
  installVoiceNotes: (): Promise<ToolInstallResult> => request("POST", "/api/voice-notes/install", {}),
  updateEngine: (): Promise<EngineUpdateStatus> => request("POST", "/api/update/engine", {}),
  installTailscale: (): Promise<RemoteAccess> => request("POST", "/api/remote-access/install", {}),
  signInToTailscale: (): Promise<RemoteAccess> => request("POST", "/api/remote-access/sign-in", {}),
  restart: (): Promise<void> => request("POST", "/api/restart", {}),
  syncVault: (): Promise<VaultSyncState> => request("POST", "/api/vault/sync", {}),
  vaultRepositories: (): Promise<GitHubRepository[]> => request("GET", "/api/vault/repositories"),
  cloneVault: (repository: string): Promise<VaultSetupResult> => request("POST", "/api/vault/clone", { repository }),
  createVault: (answers: NewVaultAnswers): Promise<VaultSetupResult> => request("POST", "/api/vault/create", answers),
  pushVault: (repository: string): Promise<VaultSetupResult> => request("POST", "/api/vault/push", { repository }),
  vaultConflicts: (): Promise<VaultConflictReport> => request("GET", "/api/vault/conflicts"),
  resolveVaultConflict: (path: string, choice: ConflictChoice): Promise<ConflictResolution> =>
    request("POST", "/api/vault/conflicts", { path, choice }),
  becomeHub: (): Promise<EvaStatus> => request("POST", "/api/hub", {}),
  startClaudeLogin: (): Promise<{ url: string }> => request("POST", "/api/engines/claude-code/login", {}),
  /** Takes the code that Claude's page shows after the login. */
  finishClaudeLogin: (code: string): Promise<{ restartNeeded: boolean }> =>
    request("POST", "/api/engines/claude-code/login/finish", { code }),
  startGoogleLogin: (): Promise<{ url: string }> => request("POST", "/api/google/login", {}),
  /** Takes the address that Google sent the browser to, or its code alone. */
  finishGoogleLogin: (address: string): Promise<{ email: string; restartNeeded: boolean }> =>
    request("POST", "/api/google/login/finish", { address }),
  /** Deletes the saved Google login. The OAuth client stays. */
  logOutOfGoogle: (): Promise<{ restartNeeded: boolean }> => request("DELETE", "/api/google/login"),
  /** Gives the code to type on GitHub's page; while a login waits, the same one. */
  startGitHubLogin: (): Promise<{ code: string; url: string }> => request("POST", "/api/github/login", {}),
  /** Waits until the person allows the access on GitHub, and Eva saves the token. */
  finishGitHubLogin: (): Promise<{ restartNeeded: boolean }> => request("POST", "/api/github/login/finish", {}),
  check: (name: string): Promise<CheckResult> => request("POST", `/api/checks/${name}`, {}),
  schedules: (): Promise<ScheduleList> => request("GET", "/api/schedules"),
  saveSchedule: (entry: Record<string, unknown>): Promise<void> => request("POST", "/api/schedules", entry),
  setScheduleEnabled: (scheduleId: string, enabled: boolean): Promise<void> =>
    request("PATCH", `/api/schedules/${encodeURIComponent(scheduleId)}`, { enabled }),
  removeSchedule: (scheduleId: string): Promise<void> =>
    request("DELETE", `/api/schedules/${encodeURIComponent(scheduleId)}`),
  scheduleCards: (): Promise<ScheduleCard[]> => request("GET", "/api/schedule-cards"),
  /** Says that the person saw the card with these fields. A card that changed meanwhile answers 409. */
  confirmScheduleCard: (card: ScheduleCard): Promise<void> =>
    request("POST", `/api/schedule-cards/${encodeURIComponent(card.scheduleId)}`, { fields: card.fields }),
};

export interface EventSubscription {
  readonly close: () => void;
  /** Tries to connect at once, instead of at the next timed try. */
  readonly retryNow: () => void;
}

/** Opens the event stream, and opens it again after a drop. */
export function subscribeToEvents(
  onEvent: (event: SessionEvent | ScheduleCard | DeviceLoginEvent) => void,
  onConnectionChange: (isConnected: boolean) => void,
): EventSubscription {
  let socket: WebSocket | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const connect = (): void => {
    retryTimer = undefined;
    // A retry that the timer started can run after the page closed the stream, such as at a logout.
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const opened = new WebSocket(`${protocol}//${window.location.host}/api/events?devices`);
    socket = opened;
    opened.addEventListener("open", () => {
      onConnectionChange(true);
    });
    opened.addEventListener("message", (message) => {
      onEvent(JSON.parse(String(message.data)) as SessionEvent | ScheduleCard | DeviceLoginEvent);
    });
    opened.addEventListener("close", () => {
      // A socket that Try now replaced closes late, and must not start a second retry.
      if (closed || socket !== opened) return;
      onConnectionChange(false);
      retryTimer = setTimeout(connect, 2_000);
    });
  };
  connect();
  return {
    close: () => {
      closed = true;
      clearTimeout(retryTimer);
      socket?.close();
    },
    retryNow: () => {
      if (socket?.readyState === WebSocket.OPEN) return;
      // An address that left the network can hang while it opens: start again instead of waiting.
      const stale = socket;
      clearTimeout(retryTimer);
      connect();
      stale?.close();
    },
  };
}

/** The web UI's client of the local API. The login cookie carries the token or a device token. */
import type { NotificationKind } from "../../../core/alerts/chat-notifications.ts";
import type { PushDevice } from "../../../core/alerts/web-push.ts";
import type { CheckResult } from "../../../core/checks.ts";
import type {
  EvaSetupState,
  EvaStatus,
  EvaVersions,
  InstallableTool,
  CurrentPlace,
  LatestToolVersion,
  NotificationsView,
  PersonalFactsView,
  PermissionsOverview,
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
import type { SearchResult } from "../../../core/files/vault-search.ts";
import type { Clone, CloneDetails, RepositoryDetails } from "../../../core/projects/clones.ts";
import type { GitHubRepository } from "../../../core/vault/github-repositories.ts";
import type { NewVaultAnswers, VaultSetupResult } from "../../../core/vault/vault-setup.ts";
import type { Project } from "../../../core/projects/project-catalog.ts";
import type {
  BranchResult,
  CloneFetch,
  ForkFiles,
  RepositoryFixResult,
  RetryChoice,
} from "../../../core/projects/project-work.ts";
import type { ProjectDetails, ProjectFile } from "../../../core/projects/project-file.ts";
import type { NewProjectInput, NewProjectResult } from "../../../core/projects/new-project.ts";
import type { AssistantRulesFile, AssistantRulesView, RestoredRules } from "../../../core/modes/assistant-rules.ts";
import type { TemplatePart } from "../../../core/vault/template-alignment.ts";
import type { ComposerMenuItems, SavedPrompt, TextAction } from "../../../core/composer-menu/composer-menu.ts";
import type { SetupItem, SetupReport, SetupSection } from "../../../core/projects/repository-setup.ts";
import type { ScheduleCard, ScheduleList, ScheduleView } from "../../../core/schedules/scheduler.ts";
import type { PendingApproval, TaskSnapshot, TurnSnapshot } from "../../../core/sessions/session-manager.ts";
import type { SessionRecord } from "../../../core/sessions/session-store.ts";
import type { UnsentTextAnswer, UnsentTextEvent, UnsentTexts } from "../../../core/sessions/unsent-texts.ts";
import type { ListedSession } from "../../api/session-list.ts";
import type { EngineUpdateStatus } from "../../../core/updates/engine-update.ts";
import type { ChangelogEntry } from "../../../core/updates/release-policy.ts";
import type { UpdateStatus } from "../../../core/updates/updater.ts";
import type {
  ConflictChoice,
  ConflictResolution,
  VaultConflict,
  VaultConflictReport,
  VaultSyncState,
} from "../../../core/vault/vault-sync.ts";
import type { UndoPreview } from "../../../core/vault/vault-snapshots.ts";
import type { VaultSecretsStatus } from "../../../core/vault/vault-encryption.ts";
import type { WidgetInputValue } from "../../../core/widgets/widget-list.ts";
import type { WidgetFrame, WidgetItem, WidgetReview } from "../../../core/widgets/widgets.ts";
import type { ContextPart } from "../../../shared/chat-context.ts";
import type { EffortLevel, EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import type { QuestionAnswers, SessionEvent } from "../../../shared/events.ts";
import { openEventStream, type EventSubscription, type StreamPlace } from "./event-stream.ts";
import { failureOf, quickRead, quickSend, request } from "./request.ts";
import { forgetUnlockSecret, keepUnlockSecret, unlockHeaders } from "./vault-unlock.ts";

export { ApiError } from "./request.ts";

/** The longest unsent text that goes out with keepalive. The browser allows 64 KiB for the bodies of a page. */
const keepaliveTextLength = 16_000;

export type { EventSubscription };

/** A template part of the vault, such as a skill, and how it compares with this Eva's version. */
export type TemplatePartView = TemplatePart;
export type { ComposerMenuItems, SavedPrompt, TextAction };

export type { PersonalFactsView };
export type { VaultSecretsStatus };
export type { WidgetFrame, WidgetInputValue, WidgetItem, WidgetReview };
/** Where the person is, for scripts: a recent point from a phone, or the home place. */
export type CurrentPlaceView = CurrentPlace;

export type {
  QuestionAnswers,
  UndoPreview,
  BrowsedPath,
  ChatBlocker,
  ChangelogEntry,
  CheckResult,
  CloneDetails,
  RepositoryDetails,
  CloneFetch,
  BranchResult,
  ForkFiles,
  RetryChoice,
  ConflictChoice,
  ConflictResolution,
  DeviceLoginEvent,
  DeviceLoginRequest,
  DeviceSummary,
  EngineUpdateStatus,
  EvaStatus,
  Favorite,
  SearchResult,
  FileEntry,
  InstallableTool,
  EvaVersions,
  PermissionsOverview,
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

/** An encrypted file that this tab unlocked: a text opens in the page, any other file downloads (#707). */
export type OpenedEncryptedFile =
  | { readonly kind: "text"; readonly text: string; readonly version: string }
  | { readonly kind: "binary"; readonly name: string; readonly blob: Blob };

async function openEncryptedFile(path: string): Promise<OpenedEncryptedFile> {
  const response = await fetch(`/api/files/encrypted?path=${encodeURIComponent(path)}`, {
    credentials: "same-origin",
    headers: unlockHeaders(),
  });
  if (!response.ok) throw await failureOf(response);
  if ((response.headers.get("content-type") ?? "").startsWith("application/json")) {
    const { text, version } = (await response.json()) as { text: string; version: string };
    return { kind: "text", text, version };
  }
  return { kind: "binary", name: path.split("/").pop() ?? "file", blob: await response.blob() };
}

/** The address of one repository of a clone: each one has its own pull and push. */
function repositoryAddress(projectId: string, clone: string, repository: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/clones/${encodeURIComponent(clone)}/repos/${encodeURIComponent(repository)}`;
}

export const api = {
  login: (token: string): Promise<void> => request("POST", "/api/login", { token }),
  logout: (): Promise<void> => request("POST", "/api/logout"),
  requestDeviceLogin: (): Promise<DeviceLoginRequest> => request("POST", "/api/login/device", {}),
  /** Trades the secret of an `eva open` link for a device cookie, once. */
  redeemLoginLink: (secret: string): Promise<void> => request("POST", "/api/login/link", { secret }),
  /** The device token never reaches the page: the server sets it as an HTTP-only cookie. */
  deviceLoginState: (requestId: string): Promise<{ state: DeviceLoginState["state"] }> =>
    request("GET", `/api/login/device/${encodeURIComponent(requestId)}`),
  logOutEveryDevice: (): Promise<{ removed: number }> => request("DELETE", "/api/devices"),
  devices: (): Promise<DeviceSummary[]> => request("GET", "/api/devices"),
  /** Logs out one device. A browser that removes its own device is logged out too. */
  removeDevice: (id: string): Promise<void> => request("DELETE", `/api/devices/${encodeURIComponent(id)}`),
  /** The device requests that this page may answer, as the event socket sends them. */
  deviceRequests: (): Promise<DeviceLoginRequest[]> =>
    request("GET", "/api/devices/requests", undefined, { limit: quickRead }),
  answerDeviceRequest: (id: string, answer: "allow" | "deny"): Promise<void> =>
    request("POST", `/api/devices/requests/${encodeURIComponent(id)}`, { answer }),
  status: (): Promise<EvaStatus> => request("GET", "/api/status", undefined, { limit: quickRead }),
  sessions: (): Promise<ListedSession[]> => request("GET", "/api/sessions", undefined, { limit: quickRead }),
  /** Each part of the chat's context that the agent reads before the conversation, such as its prompt. */
  chatContext: (sessionId: string): Promise<ContextPart[]> =>
    request("GET", `/api/sessions/${encodeURIComponent(sessionId)}/context`),
  /** The whole input and output of one step of a stored answer. Null when Eva kept none. */
  stepDetail: (sessionId: string, stepId: string): Promise<{ input: string | null; output: string | null }> =>
    request("GET", `/api/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}`),
  /** With no engine, model or effort, Eva starts the chat with the ones from her settings. */
  newAssistantChat: (model?: ModelAlias, engine?: EngineName, effort?: EffortLevel): Promise<SessionRecord> =>
    request("POST", "/api/sessions", {
      mode: "assistant",
      ...(model === undefined ? {} : { model }),
      ...(engine === undefined ? {} : { engine }),
      ...(effort === undefined ? {} : { effort }),
    }),
  /** Eva picks the clone: a free one, or a new one (issue 521). */
  newProjectChat: (projectId: string): Promise<SessionRecord> =>
    request("POST", "/api/sessions", { mode: "project", projectId }),
  /** Only a chat with no turn takes a new engine. A fork keeps its chat's engine. */
  setEngine: (sessionId: string, engine: EngineName): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/engine`, { engine }),
  /** A chat takes a new model between turns. The next turn reads the whole chat again (lesson 41). */
  setModel: (sessionId: string, model: ModelAlias): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/model`, { model }),
  /** The effort changes no history, so a chat takes a new one at any time. The next turn uses it. */
  setEffort: (sessionId: string, effort: EffortLevel): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/effort`, { effort }),
  /** Turns a recording into text on Eva's machine. Eva keeps no audio. */
  transcribe: (audio: Blob): Promise<{ text: string }> => request("POST", "/api/transcribe", audio),
  /**
   * Keeps a file for the agent, and answers the note that the message carries: in the vault's
   * Scratch folder, or in the clone of a chat in a clone, with a note that names no vault path (#706).
   */
  attachFile: (file: File, sessionId: string | null = null): Promise<{ path: string; note: string }> =>
    request(
      "POST",
      `/api/files/received?name=${encodeURIComponent(file.name)}${sessionId === null ? "" : `&session=${encodeURIComponent(sessionId)}`}`,
      file,
    ),
  send: (sessionId: string, text: string): Promise<void> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/messages`, { text }, { limit: quickSend }),
  /** A fork of a Project chat can run in a new clone (issue 523). The notice says why it lost its history. */
  fork: (sessionId: string, atMessageId: string, files?: ForkFiles): Promise<BranchResult> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/fork`, { atMessageId, files }),
  /** A new chat that goes on from a summary of this chat. A failed summary gives no draft and its reason. */
  summaryChat: (sessionId: string): Promise<{ session: SessionRecord; summaryFailure: string | null }> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/summary-chat`, {}),
  stop: (sessionId: string): Promise<{ stopped: boolean }> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/stop`, {}),
  /**
   * With `undo`, Eva first restores the vault files that the answers from this turn on changed (#525).
   * With `files`, a Project chat chooses its clone and its files (#523).
   */
  retry: (
    sessionId: string,
    turnIndex: number,
    choice: { readonly undo?: boolean; readonly files?: RetryChoice } = {},
  ): Promise<BranchResult> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/retry`, { turnIndex, ...choice }),
  /** What the undo before a retry of this turn would do now. */
  retryUndo: (sessionId: string, turnIndex: number): Promise<UndoPreview> =>
    request("GET", `/api/sessions/${encodeURIComponent(sessionId)}/retry-undo?turnIndex=${String(turnIndex)}`),
  deleteChat: (sessionId: string): Promise<{ deleted: string[] }> =>
    request("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`),
  /** Deletes one branch of a chat. Its forks stay, and `heirId` names the fork that took its place (issue 647). */
  deleteBranch: (sessionId: string): Promise<{ deleted: string[]; heirId: string | null }> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/delete-branch`),
  rename: (sessionId: string, title: string): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/rename`, { title }),
  nameFork: (sessionId: string, name: string): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/fork-name`, { name }),
  archive: (sessionId: string, archived: boolean): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/archive`, { archived }),
  unsentTexts: (): Promise<UnsentTexts> => request("GET", "/api/unsent-texts", undefined, { limit: quickRead }),
  /** A short text goes out also while the page hides. The browser refuses a long body with keepalive. */
  saveUnsentText: (
    key: string,
    text: string,
    keepEmpty: boolean,
    writer: string,
    base: number | null,
  ): Promise<UnsentTextAnswer> =>
    request(
      "PUT",
      `/api/unsent-texts/${encodeURIComponent(key)}`,
      { text, keepEmpty, writer, base },
      { keepalive: text.length <= keepaliveTextLength },
    ),
  markSeen: (sessionId: string, turnCount: number): Promise<SessionRecord> =>
    request("POST", `/api/sessions/${encodeURIComponent(sessionId)}/seen`, { turnCount }),
  pendingApprovals: (): Promise<PendingApproval[]> => request("GET", "/api/approvals", undefined, { limit: quickRead }),
  backgroundTasks: (): Promise<TaskSnapshot> => request("GET", "/api/tasks", undefined, { limit: quickRead }),
  runningTurns: (): Promise<TurnSnapshot> => request("GET", "/api/turns", undefined, { limit: quickRead }),
  answerApproval: (requestId: string, answer: "allow" | "deny", answers?: QuestionAnswers): Promise<void> =>
    request(
      "POST",
      `/api/approvals/${encodeURIComponent(requestId)}`,
      answers === undefined ? { answer } : { answer, answers },
    ),
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
  setRepositoryType: (projectId: string, repository: string, type: string): Promise<ProjectFile> =>
    request("PUT", `/api/projects/${encodeURIComponent(projectId)}/setup/type`, { repository, type }),
  /** Runs the direct fixes of the named items, or of all of them for null. */
  fixRepository: (
    projectId: string,
    repository: string,
    items: readonly string[] | null,
  ): Promise<RepositoryFixResult> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/setup/fix`, { repository, items }),
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
  /** Fetches each repository of each clone, so the cards count the commits to pull. A failed fetch is in `problems`. */
  fetchClones: (projectId: string): Promise<CloneFetch> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/fetch`, {}),
  /** Pulls each repository that is behind. A failed pull is in `problems`. */
  pullClones: (projectId: string): Promise<CloneFetch> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones/pull`, {}),
  pullClone: (projectId: string, clone: string, repository: string): Promise<unknown> =>
    request("POST", `${repositoryAddress(projectId, clone, repository)}/pull`, {}),
  /** Commits every change of one repository and pushes. An empty note lets a model write the message. */
  pushClone: (
    projectId: string,
    clone: string,
    repository: string,
    note: string,
  ): Promise<{ readonly message: string }> =>
    request("POST", `${repositoryAddress(projectId, clone, repository)}/push`, { note }),
  /** A vault folder or file, by its path from the vault root. The empty path is the root. */
  files: (path: string): Promise<BrowsedPath> => request("GET", `/api/files?path=${encodeURIComponent(path)}`),
  /** A file that changed since `version` answers 409 with `file_changed`. */
  saveFile: (path: string, version: string, text: string): Promise<BrowsedPath> =>
    request("PUT", "/api/files", { path, version, text }),
  /** Answers the new path. A name that is taken or not allowed answers 409 with `file_not_writable`. */
  renameFile: (path: string, name: string): Promise<{ path: string }> =>
    request("POST", "/api/files/rename", { path, name }),
  /**
   * The vault entries whose name holds `query`. With `contents`, the files whose text holds it too.
   * With `shareable`, only what a chat in a clone may be given (#706).
   */
  searchFiles: (query: string, contents: boolean, shareable = false): Promise<SearchResult> =>
    request(
      "GET",
      `/api/files/search?query=${encodeURIComponent(query)}${contents ? "&contents=true" : ""}${shareable ? "&shareable=true" : ""}`,
    ),
  downloadFile: download,
  /** The vault's encryption: its key, this tab's unlock and the list of secret files (#707). */
  vaultSecrets: (): Promise<VaultSecretsStatus> =>
    request("GET", "/api/vault/secrets", undefined, { limit: quickRead, headers: unlockHeaders() }),
  setVaultPassword: (password: string): Promise<VaultSecretsStatus> =>
    request("POST", "/api/vault/secrets/password", { password }, { headers: unlockHeaders() }),
  /** A wrong password answers 400 with `vault_password_wrong`. The secret stays in this tab only. */
  unlockVault: async (password: string): Promise<void> => {
    const { secret } = await request<{ secret: string }>("POST", "/api/vault/secrets/unlock", { password });
    keepUnlockSecret(secret);
  },
  lockVault: async (): Promise<VaultSecretsStatus> => {
    forgetUnlockSecret();
    return request("POST", "/api/vault/secrets/lock");
  },
  setSecretPatterns: (added: readonly string[], off: readonly string[]): Promise<VaultSecretsStatus> =>
    request("PUT", "/api/vault/secrets/patterns", { added, off }, { headers: unlockHeaders() }),
  /** Answers the paths that the removals decrypted. A locked tab answers 403 with `vault_locked`. */
  confirmSecretRemovals: (patterns: readonly string[], files: readonly string[]): Promise<{ decrypted: string[] }> =>
    request("POST", "/api/vault/secrets/confirm", { patterns, files }, { headers: unlockHeaders() }),
  /** The keys stay the same, so this tab stays unlocked. */
  changeVaultPassword: (password: string): Promise<VaultSecretsStatus> =>
    request("POST", "/api/vault/secrets/change-password", { password }, { headers: unlockHeaders() }),
  /** The old key opens nothing any more, so the core locks every device, this tab too. */
  newVaultKey: async (password: string): Promise<VaultSecretsStatus> => {
    const status = await request<VaultSecretsStatus>(
      "POST",
      "/api/vault/secrets/new-key",
      { password },
      { headers: unlockHeaders() },
    );
    forgetUnlockSecret();
    return status;
  },
  acceptVaultKey: (): Promise<VaultSecretsStatus> =>
    request("POST", "/api/vault/secrets/accept-key", undefined, { headers: unlockHeaders() }),
  openEncryptedFile,
  /** A file that changed since `version` answers 409 with `file_changed`. */
  saveEncryptedFile: (path: string, version: string, text: string): Promise<{ saved: true }> =>
    request("PUT", "/api/files/encrypted", { path, version, text }, { headers: unlockHeaders() }),
  favorites: (): Promise<Favorite[]> => request("GET", "/api/files/favorites"),
  /** A missing path answers 404 with `file_not_found`. */
  setFavorite: (path: string, favorite: boolean): Promise<Favorite[]> =>
    request("PUT", "/api/files/favorites", { path, favorite }),
  settings: (): Promise<PublicSettings> => request("GET", "/api/settings"),
  saveSettings: (patch: Record<string, unknown>): Promise<{ restartNeeded: boolean }> =>
    request("PUT", "/api/settings", patch),
  setupState: (): Promise<EvaSetupState> => request("GET", "/api/settings/setup"),
  trust: (): Promise<TrustOverview> => request("GET", "/api/trust"),
  permissions: (): Promise<PermissionsOverview> => request("GET", "/api/permissions"),
  forgetTrustAnswer: (url: string): Promise<TrustOverview> => request("DELETE", "/api/trust/answers", { url }),
  pushKey: (): Promise<{ publicKey: string; isHub: boolean; devices: readonly PushDevice[] }> =>
    request("GET", "/api/push"),
  addPushDevice: (subscription: PushSubscriptionJSON, label: string): Promise<{ devices: readonly PushDevice[] }> =>
    request("POST", "/api/push/devices", { subscription, label }),
  setPushKinds: (endpoint: string, kinds: readonly NotificationKind[]): Promise<{ devices: readonly PushDevice[] }> =>
    request("PATCH", "/api/push/devices", { endpoint, kinds }),
  removePushDevice: (endpoint: string): Promise<unknown> => request("DELETE", "/api/push/devices", { endpoint }),
  setPushInView: (endpoint: string, pageId: string, inView: boolean, chats: readonly string[]): Promise<void> =>
    request("POST", "/api/push/in-view", { endpoint, pageId, inView, chats }, { keepalive: true }),
  testPush: (): Promise<void> => request("POST", "/api/push/test"),
  /** The text actions and saved prompts of the message box. Answers 409 when no vault is configured. */
  composerMenu: (): Promise<ComposerMenuItems> => request("GET", "/api/composer-menu"),
  /** With `previousName`, the item gets the new name. */
  saveTextAction: (action: TextAction & { readonly previousName?: string }): Promise<ComposerMenuItems> =>
    request("PUT", "/api/composer-menu/text-actions", action),
  removeTextAction: (name: string): Promise<ComposerMenuItems> =>
    request("DELETE", "/api/composer-menu/text-actions", { name }),
  savePrompt: (prompt: SavedPrompt & { readonly previousName?: string }): Promise<ComposerMenuItems> =>
    request("PUT", "/api/composer-menu/saved-prompts", prompt),
  removePrompt: (name: string): Promise<ComposerMenuItems> =>
    request("DELETE", "/api/composer-menu/saved-prompts", { name }),
  /** The text of the box, rewritten by the action on the chat's engine. */
  runTextAction: (name: string, engine: EngineName, text: string): Promise<{ text: string }> =>
    request("POST", "/api/composer-menu/text-actions/run", { name, engine, text }),
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
  currentPlace: (): Promise<{ place: CurrentPlaceView | null; isHub: boolean }> => request("GET", "/api/location"),
  sendLocation: (
    latitude: number,
    longitude: number,
    accuracy: number | null,
    takenAt: number,
  ): Promise<{ saved: boolean }> => request("POST", "/api/location", { latitude, longitude, accuracy, takenAt }),
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
  /** `ifStale` reuses a check of the last hour, so each page open does not ask GitHub. */
  checkForUpdate: (ifStale = false): Promise<UpdateStatus> =>
    request("POST", "/api/update/check", ifStale ? { ifStale } : {}),
  changelog: (): Promise<ChangelogEntry[]> => request("GET", "/api/update/changelog"),
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
  /** Hides the notice of an open problem, and answers with the new status. */
  hideProblem: (key: string): Promise<EvaStatus> =>
    request("POST", "/api/problems/hide", { key }, { limit: quickRead }),
  /** The notification history, oldest first. An older Eva answers 404. */
  notifications: (): Promise<NotificationsView> =>
    request("GET", "/api/notifications", undefined, { limit: quickRead }),
  /** "all" also hides every open problem. */
  markNotificationsRead: (choice: { seqs: readonly number[] } | { all: true }): Promise<NotificationsView> =>
    request("POST", "/api/notifications/read", choice, { limit: quickRead }),
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
  saveSchedule: (entry: Record<string, unknown>): Promise<ScheduleView["schedule"]> =>
    request("POST", "/api/schedules", entry),
  editSchedule: (scheduleId: string, fields: Record<string, unknown>): Promise<ScheduleView["schedule"]> =>
    request("PATCH", `/api/schedules/${encodeURIComponent(scheduleId)}`, { fields }),
  setScheduleEnabled: (scheduleId: string, enabled: boolean): Promise<void> =>
    request("PATCH", `/api/schedules/${encodeURIComponent(scheduleId)}`, { enabled }),
  removeSchedule: (scheduleId: string): Promise<void> =>
    request("DELETE", `/api/schedules/${encodeURIComponent(scheduleId)}`),
  scheduleCards: (): Promise<ScheduleCard[]> => request("GET", "/api/schedule-cards", undefined, { limit: quickRead }),
  /** Says that the person saw the card with these fields. A card that changed meanwhile answers 409. */
  confirmScheduleCard: (card: ScheduleCard): Promise<void> =>
    request("POST", `/api/schedule-cards/${encodeURIComponent(card.scheduleId)}`, { fields: card.fields }),
  /** The widgets of the settings list (#691). Fast: it reads no network. */
  widgets: (): Promise<WidgetItem[]> => request("GET", "/api/widgets", undefined, { limit: quickRead }),
  /** Reads each manifest again, so the list shows each problem. Slow: it reads GitHub. */
  checkWidgets: (): Promise<WidgetItem[]> => request("POST", "/api/widgets/check"),
  addWidget: (repository: string): Promise<WidgetItem[]> => request("POST", "/api/widgets", { repository }),
  reviewWidget: (id: string): Promise<WidgetReview> => request("GET", `/api/widgets/${widgetPath(id)}/review`),
  approveWidget: (
    id: string,
    commit: string,
    values: Readonly<Record<string, WidgetInputValue>>,
    readOnly = false,
  ): Promise<WidgetItem[]> =>
    request("POST", `/api/widgets/${widgetPath(id)}/approve`, { commit, values, ...(readOnly ? { readOnly } : {}) }),
  setWidgetEnabled: (id: string, enabled: boolean): Promise<WidgetItem[]> =>
    request("PUT", `/api/widgets/${widgetPath(id)}/enabled`, { enabled }),
  moveWidget: (id: string, direction: "up" | "down"): Promise<WidgetItem[]> =>
    request("POST", `/api/widgets/${widgetPath(id)}/move`, { direction }),
  removeWidget: (id: string): Promise<WidgetItem[]> => request("DELETE", `/api/widgets/${widgetPath(id)}`),
  /** The cards of the home grid, each with a token. A token in `keep` that still works stays. */
  widgetFrames: (
    scheme: "light" | "dark",
    colors: Readonly<Record<string, string>>,
    keep: readonly string[],
  ): Promise<WidgetFrame[]> => request("POST", "/api/widgets/frames", { scheme, colors, keep }, { limit: quickRead }),
  /** Ends the tokens of a page that closes; keepalive, so it goes out as the page goes. */
  releaseWidgetFrames: (tokens: readonly string[]): Promise<void> =>
    request("POST", "/api/widgets/frames/release", { tokens }, { keepalive: true }),
};

/** The browser's socket to Eva's event route, and its timers. */
const browserStream: StreamPlace = {
  open: (handlers) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/events?devices`);
    socket.addEventListener("open", handlers.onOpen);
    socket.addEventListener("message", (message) => handlers.onMessage(String(message.data)));
    socket.addEventListener("close", handlers.onClose);
    return { isOpen: () => socket.readyState === WebSocket.OPEN, close: () => socket.close() };
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout> | undefined),
};

/** Opens the event stream, and opens it again after a drop. */
export function subscribeToEvents(
  onEvent: (event: SessionEvent | ScheduleCard | DeviceLoginEvent | UnsentTextEvent) => void,
  onConnectionChange: (isConnected: boolean) => void,
): EventSubscription {
  // Eva sends only these kinds on the event route.
  return openEventStream(
    browserStream,
    (event) => onEvent(event as SessionEvent | ScheduleCard | DeviceLoginEvent | UnsentTextEvent),
    onConnectionChange,
  );
}

/** The path of a widget id, `owner/name`, with each part escaped. */
function widgetPath(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/");
}

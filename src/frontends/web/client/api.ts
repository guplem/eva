/** The web UI's client of the local API. The login cookie carries the token or a device token. */
import type { CheckResult } from "../../../core/checks.ts";
import type { EvaSetupState, EvaStatus } from "../../../core/eva.ts";
import type { ProgressStep } from "../../../core/setup/progress.ts";
import type { PageSecretName, PublicSettings } from "../../../core/settings/live-settings.ts";
import type {
  DeviceLoginEvent,
  DeviceLoginRequest,
  DeviceLoginState,
  DeviceSummary,
} from "../../../core/remote-access/device-logins.ts";
import type { RemoteAccess } from "../../../core/remote-access/remote-access.ts";
import type { CloneDetails } from "../../../core/projects/clones.ts";
import type { Project } from "../../../core/projects/project-catalog.ts";
import type { ProjectDetails, ProjectFile } from "../../../core/projects/project-file.ts";
import type { SetupItem, SetupReport } from "../../../core/projects/repository-setup.ts";
import type { ScheduleCard, ScheduleList, ScheduleView } from "../../../core/schedules/scheduler.ts";
import type { PendingApproval, TaskSnapshot } from "../../../core/sessions/session-manager.ts";
import type { SessionRecord } from "../../../core/sessions/session-store.ts";
import type { EngineUpdateStatus } from "../../../core/updates/engine-update.ts";
import type { UpdateStatus } from "../../../core/updates/updater.ts";
import type {
  ConflictChoice,
  ConflictResolution,
  VaultConflict,
  VaultConflictReport,
  VaultSyncState,
} from "../../../core/vault/vault-sync.ts";
import type { ModelAlias } from "../../../shared/engine-port.ts";
import type { EvaErrorCode } from "../../../shared/errors.ts";
import type { SessionEvent } from "../../../shared/events.ts";

export type {
  CheckResult,
  CloneDetails,
  ConflictChoice,
  ConflictResolution,
  DeviceLoginEvent,
  DeviceLoginRequest,
  DeviceSummary,
  EngineUpdateStatus,
  EvaStatus,
  PageSecretName,
  PendingApproval,
  Project,
  ProjectDetails,
  ProjectFile,
  PublicSettings,
  RemoteAccess,
  ScheduleCard,
  ScheduleList,
  ScheduleView,
  EvaSetupState,
  ProgressStep,
  SessionEvent,
  SessionRecord,
  SetupItem,
  SetupReport,
  UpdateStatus,
  VaultConflict,
  VaultConflictReport,
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
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
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
    throw new ApiError(response.status, message, code);
  }
  return response.status === 204 ? (undefined as Body) : ((await response.json()) as Body);
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
  sessions: (): Promise<SessionRecord[]> => request("GET", "/api/sessions"),
  newAssistantChat: (model: ModelAlias): Promise<SessionRecord> =>
    request("POST", "/api/sessions", { mode: "assistant", model }),
  newProjectChat: (projectId: string, clone: string, model: ModelAlias): Promise<SessionRecord> =>
    request("POST", "/api/sessions", { mode: "project", projectId, clone, model }),
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
  newClone: (projectId: string): Promise<CloneDetails> =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/clones`, {}),
  settings: (): Promise<PublicSettings> => request("GET", "/api/settings"),
  saveSettings: (patch: Record<string, unknown>): Promise<{ restartNeeded: boolean }> =>
    request("PUT", "/api/settings", patch),
  setupState: (): Promise<EvaSetupState> => request("GET", "/api/settings/setup"),
  /** Answers 409 when no vault is configured. */
  chatNameRules: (): Promise<{ rules: string }> => request("GET", "/api/chat-names"),
  saveChatNameRules: (rules: string): Promise<{ rules: string }> => request("PUT", "/api/chat-names", { rules }),
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
  updateEngine: (): Promise<EngineUpdateStatus> => request("POST", "/api/update/engine", {}),
  installTailscale: (): Promise<RemoteAccess> => request("POST", "/api/remote-access/install", {}),
  signInToTailscale: (): Promise<RemoteAccess> => request("POST", "/api/remote-access/sign-in", {}),
  restart: (): Promise<void> => request("POST", "/api/restart", {}),
  syncVault: (): Promise<VaultSyncState> => request("POST", "/api/vault/sync", {}),
  vaultConflicts: (): Promise<VaultConflictReport> => request("GET", "/api/vault/conflicts"),
  resolveVaultConflict: (path: string, choice: ConflictChoice): Promise<ConflictResolution> =>
    request("POST", "/api/vault/conflicts", { path, choice }),
  becomeHub: (): Promise<EvaStatus> => request("POST", "/api/hub", {}),
  startGoogleLogin: (): Promise<{ url: string }> => request("POST", "/api/google/login", {}),
  /** Takes the address that Google sent the browser to, or its code alone. */
  finishGoogleLogin: (address: string): Promise<{ email: string; restartNeeded: boolean }> =>
    request("POST", "/api/google/login/finish", { address }),
  check: (name: string): Promise<CheckResult> => request("POST", `/api/checks/${name}`, {}),
  schedules: (): Promise<ScheduleList> => request("GET", "/api/schedules"),
  saveSchedule: (entry: Record<string, unknown>): Promise<void> => request("POST", "/api/schedules", entry),
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

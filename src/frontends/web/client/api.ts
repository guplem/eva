/** The web UI's client of the local API. The login cookie carries the token or a device token. */
import type { CheckResult } from "../../../core/checks.ts";
import type { EvaStatus } from "../../../core/eva.ts";
import type { PageSecretName, PublicSettings, SetupState } from "../../../core/settings/live-settings.ts";
import type { DeviceLoginRequest, DeviceLoginState } from "../../../core/remote-access/device-logins.ts";
import type { CloneDetails } from "../../../core/projects/clones.ts";
import type { Project } from "../../../core/projects/project-catalog.ts";
import type { ProjectDetails, ProjectFile } from "../../../core/projects/project-file.ts";
import type { SetupItem, SetupReport } from "../../../core/projects/repository-setup.ts";
import type { ScheduleCard, ScheduleView } from "../../../core/schedules/scheduler.ts";
import type { PendingApproval } from "../../../core/sessions/session-manager.ts";
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
  DeviceLoginRequest,
  EngineUpdateStatus,
  EvaStatus,
  PageSecretName,
  PendingApproval,
  Project,
  ProjectDetails,
  ProjectFile,
  PublicSettings,
  ScheduleCard,
  SetupState,
  SessionEvent,
  SessionRecord,
  SetupItem,
  SetupReport,
  UpdateStatus,
  VaultConflict,
  VaultConflictReport,
  VaultSyncState,
};

export interface ScheduleList {
  readonly schedules: readonly ScheduleView[];
  readonly problems: readonly string[];
}

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
  setupState: (): Promise<SetupState> => request("GET", "/api/settings/setup"),
  /** The value goes one way: the answer never holds it. */
  saveSecret: (name: PageSecretName, value: string): Promise<{ restartNeeded: boolean }> =>
    request("PUT", `/api/secrets/${name}`, { value }),
  removeSecret: (name: PageSecretName): Promise<{ restartNeeded: boolean }> =>
    request("DELETE", `/api/secrets/${name}`),
  updateStatus: (): Promise<UpdateStatus | null> => request("GET", "/api/update"),
  updateNow: (): Promise<UpdateStatus> => request("POST", "/api/update", {}),
  engineUpdateStatus: (): Promise<EngineUpdateStatus | null> => request("GET", "/api/update/engine"),
  updateEngine: (): Promise<EngineUpdateStatus> => request("POST", "/api/update/engine", {}),
  restart: (): Promise<void> => request("POST", "/api/restart", {}),
  syncVault: (): Promise<VaultSyncState> => request("POST", "/api/vault/sync", {}),
  vaultConflicts: (): Promise<VaultConflictReport> => request("GET", "/api/vault/conflicts"),
  resolveVaultConflict: (path: string, choice: ConflictChoice): Promise<ConflictResolution> =>
    request("POST", "/api/vault/conflicts", { path, choice }),
  becomeHub: (): Promise<EvaStatus> => request("POST", "/api/hub", {}),
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

/** Opens the event stream, and opens it again after a drop. Returns a function that closes it. */
export function subscribeToEvents(
  onEvent: (event: SessionEvent | ScheduleCard) => void,
  onConnectionChange: (isConnected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  const connect = (): void => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/api/events`);
    socket.addEventListener("open", () => {
      onConnectionChange(true);
    });
    socket.addEventListener("message", (message) => {
      onEvent(JSON.parse(String(message.data)) as SessionEvent | ScheduleCard);
    });
    socket.addEventListener("close", () => {
      if (closed) return;
      onConnectionChange(false);
      setTimeout(connect, 2_000);
    });
  };
  connect();
  return () => {
    closed = true;
    socket?.close();
  };
}

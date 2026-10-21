/**
 * The facts of the Status card on the Settings home page, in words. Pure, so a test covers
 * each state without a browser.
 */
import type { EvaStatus, VaultSyncState } from "./api.ts";

export const syncStatusLabels: Readonly<Record<VaultSyncState["status"], string>> = {
  ok: "Up to date",
  offline: "Offline",
  conflict: "Conflict",
  error: "Error",
  skipped: "Skipped",
};

export interface StatusFact {
  readonly label: string;
  readonly value: string;
}

export function statusFacts(status: EvaStatus): StatusFact[] {
  return [
    { label: "Version", value: versionWords(status) },
    { label: "This machine", value: machineWords(status) },
    { label: "Chats", value: chatWords(status) },
    { label: "Vault sync", value: syncWords(status) },
    { label: "Phone access", value: phoneWords(status) },
    { label: "Problems", value: status.problems.length === 0 ? "None" : `${String(status.problems.length)} open` },
  ];
}

function versionWords(status: EvaStatus): string {
  const target = status.update?.available === true ? status.update.target : null;
  return target === null ? status.version : `${status.version}, ${target} waits to install`;
}

function machineWords(status: EvaStatus): string {
  if (status.role === "hub") return `${status.machine}, the hub`;
  return status.hub === null ? `${status.machine}, a satellite` : `${status.machine}, a satellite of ${status.hub}`;
}

function chatWords(status: EvaStatus): string {
  if (status.sessionCount === 0) return "No chats yet";
  const chats = status.sessionCount === 1 ? "1 chat" : `${String(status.sessionCount)} chats`;
  const running = status.busySessionIds.length;
  if (running === 0) return chats;
  return `${chats}, ${running === 1 ? "1 runs" : `${String(running)} run`} now`;
}

/** The sync result and its error, as the Vault page and the Status card show it. */
export function syncStateWords(state: VaultSyncState): string {
  const label = syncStatusLabels[state.status];
  return state.lastError === null ? label : `${label}: ${state.lastError}`;
}

function syncWords(status: EvaStatus): string {
  if (status.vaultPath === null) return "No vault yet";
  const words = syncStateWords(status.vaultSync);
  // An older Eva sends no field, so only false says that the sync is off.
  return (status as Partial<EvaStatus>).vaultAutoSync === false ? `${words}, automatic sync is off` : words;
}

function phoneWords(status: EvaStatus): string {
  const remote = status.remoteAccess;
  return remote?.url ?? remote?.problem ?? "Not set up";
}

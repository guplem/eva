/**
 * Which machine is the hub (plan §4.4): the vault names it in `.eva/hub.json`, so every machine
 * with the vault agrees, and nobody sets a role by hand. The first machine that starts with the
 * vault claims the hub; any machine takes it over with `eva hub` or the web UI. Only the hub
 * runs Telegram and the schedules.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

export type MachineRole = "hub" | "satellite";

export interface HubClaim {
  readonly machine: string;
  readonly since: string;
}

export function hubFilePath(vaultPath: string): string {
  return join(vaultPath, ".eva", "hub.json");
}

/** The vault's hub, or null when no machine claimed it yet or the file is broken. */
export function readHubClaim(vaultPath: string): HubClaim | null {
  const read = readJsonTolerant(hubFilePath(vaultPath));
  if (!read.ok || read.value === null || typeof read.value !== "object") return null;
  const { machine, since } = read.value as Partial<Record<keyof HubClaim, unknown>>;
  return typeof machine === "string" && machine.length > 0
    ? { machine, since: typeof since === "string" ? since : "" }
    : null;
}

/** Without a vault, or before any claim, this machine is the hub. */
export function machineRole(vaultPath: string | null, machine: string): MachineRole {
  if (vaultPath === null) return "hub";
  const claim = readHubClaim(vaultPath);
  return claim === null || claim.machine === machine ? "hub" : "satellite";
}

/** Makes this machine the hub. Eva's sync commits and pushes the file. */
export function claimHub(vaultPath: string, machine: string, now: Date): HubClaim {
  const claim: HubClaim = { machine, since: now.toISOString() };
  writeFileAtomic(hubFilePath(vaultPath), JSON.stringify(claim, null, 2) + "\n");
  return claim;
}

/**
 * Claims the hub when no machine has it yet. Call it after a vault pull, so a machine never
 * claims a hub that another machine already pushed. Returns true when it claimed.
 */
export function claimHubIfUnclaimed(vaultPath: string, machine: string, now: Date): boolean {
  if (!existsSync(vaultPath) || readHubClaim(vaultPath) !== null) return false;
  claimHub(vaultPath, machine, now);
  return true;
}

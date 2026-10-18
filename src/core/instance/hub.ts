/**
 * Which machine is the hub: the vault names it in `.eva/hub.json`, so every machine
 * with the vault agrees, and nobody sets a role by hand. The first machine that starts with the
 * vault claims the hub; any machine takes it over with `eva hub` or the web UI. Only the hub
 * runs Telegram and the schedules.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { assertVaultWritable, vaultAhead } from "../migrations/migrations.ts";

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
  return read.ok ? parseHubClaim(read.value) : null;
}

/**
 * Without a vault, or before any claim, this machine is the hub. A broken claim file keeps
 * `roleIfBroken` (the last known role): with "hub" as the answer, every machine runs Telegram.
 */
export function machineRole(vaultPath: string | null, machine: string, roleIfBroken: MachineRole): MachineRole {
  if (vaultPath === null || !existsSync(hubFilePath(vaultPath))) return "hub";
  const claim = readHubClaim(vaultPath);
  if (claim === null) return roleIfBroken;
  return claim.machine === machine ? "hub" : "satellite";
}

/**
 * Makes this machine the hub. Eva's sync commits and pushes the file. An Eva that is behind the
 * vault cannot claim it, because the hub runs the vault migrations.
 */
export function claimHub(vaultPath: string, machine: string, now: Date): HubClaim {
  assertVaultWritable(vaultPath);
  const claim: HubClaim = { machine, since: now.toISOString() };
  writeFileAtomic(hubFilePath(vaultPath), JSON.stringify(claim, null, 2) + "\n");
  return claim;
}

/**
 * Claims the hub when no machine has it yet. Call it after a vault pull, so a machine never
 * claims a hub that another machine already pushed. Returns true when it claimed.
 */
export function claimHubIfUnclaimed(vaultPath: string, machine: string, now: Date): boolean {
  // A broken file may hide another machine's claim; a person repairs it with `eva hub`.
  if (!existsSync(vaultPath) || existsSync(hubFilePath(vaultPath))) return false;
  if (vaultAhead(vaultPath) !== null) return false;
  claimHub(vaultPath, machine, now);
  return true;
}

function parseHubClaim(value: unknown): HubClaim | null {
  if (value === null || typeof value !== "object") return null;
  const { machine, since } = value as Partial<Record<keyof HubClaim, unknown>>;
  return typeof machine === "string" && machine.length > 0
    ? { machine, since: typeof since === "string" ? since : "" }
    : null;
}

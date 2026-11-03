/**
 * The vault structure version (#773). The `vault-upgrade` skill carries a CHANGELOG with one entry
 * for each version, and `.eva/vault-structure.json` records the version that a vault follows. Eva
 * reads both to tell the person once that a newer structure exists. Only the skill changes a
 * vault's structure, with the person.
 */
import { join } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import changelogFile from "../../../templates/eva-core/skills/vault-upgrade/CHANGELOG.md" with { type: "text" };

export interface StructureChange {
  readonly version: number;
  /** One or two sentences, for the alert and the Settings card. */
  readonly summary: string;
  /** The ids of the vault migrations that must run before the upgrade starts. */
  readonly migrations: readonly string[];
}

/** The version of a vault with no record: every vault from before the record follows version 2. */
export const unrecordedStructureVersion = 2;

/** The entries of a CHANGELOG, oldest first. An entry with no whole version is left out. */
export function parseChangelog(text: string): StructureChange[] {
  const changes: StructureChange[] = [];
  for (const section of text.split(/^## /m).slice(1)) {
    const field = (name: string): string | null =>
      new RegExp(`^- \\*\\*${name}:\\*\\*[ \\t]*(.*)$`, "m").exec(section)?.[1]?.trim() ?? null;
    const version = Number(field("Version"));
    if (!Number.isInteger(version) || version <= 0) continue;
    const migrations = (field("Migrations first") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    changes.push({ version, summary: field("Summary") ?? "", migrations });
  }
  return changes.sort((a, b) => a.version - b.version);
}

export const structureChanges: readonly StructureChange[] = parseChangelog(changelogFile);

/** The newest structure that this Eva knows, which a new vault gets. */
export const newestStructureVersion: number = structureChanges.at(-1)?.version ?? unrecordedStructureVersion;

export function vaultStructurePath(vaultPath: string): string {
  return join(vaultPath, ".eva", "vault-structure.json");
}

/** The vault's structure version. A missing or damaged record, or one with no whole version, reads as version 2. */
export function readVaultStructure(vaultPath: string): number {
  const read = readJsonTolerant(vaultStructurePath(vaultPath));
  const version = read.ok && isRecord(read.value) ? read.value["version"] : undefined;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : unrecordedStructureVersion;
}

/** Records the version, and keeps each other field that a newer Eva may have added. */
export function writeVaultStructure(vaultPath: string, version: number): void {
  const read = readJsonTolerant(vaultStructurePath(vaultPath));
  const kept = read.ok && isRecord(read.value) ? read.value : {};
  writeFileAtomic(vaultStructurePath(vaultPath), `${JSON.stringify({ ...kept, version }, null, 2)}\n`);
}

/** The text of the record for a new vault. */
export function newVaultStructureFile(): string {
  return `${JSON.stringify({ version: newestStructureVersion }, null, 2)}\n`;
}

/** The changes that a vault at this version has not got yet, oldest first. */
export function pendingChanges(current: number): StructureChange[] {
  return structureChanges.filter((change) => change.version > current);
}

/** The summaries of the pending changes, in one text. */
export function pendingSummary(current: number): string {
  return pendingChanges(current)
    .map((change) => change.summary)
    .filter((summary) => summary !== "")
    .join(" ");
}

/** The line that the first new Assistant chat on the hub gets after the alert. */
export function structurePromptLine(available: number, current: number): string {
  return `[Vault structure: version ${String(available)} is available. This vault is at version ${String(current)}. Run the vault-upgrade skill when the person agrees.]`;
}

/** The news alert: the versions, what changes, and where to start. No slash command: Telegram would send it to the bot. */
export function structureNews(available: number, current: number): string {
  return [
    `A new vault structure is available: version ${String(available)}. Your vault is at version ${String(current)}.`,
    pendingSummary(current),
    "To update the vault, press Update the vault, or open Settings, Vault and sync, Vault structure. You can also ask the Assistant.",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** What the hub told the person, in its state folder: the version of the last alert, and of the last prompt line. */
export interface StructureNotices {
  readonly announced: number;
  readonly prompted: number;
}

export function readStructureNotices(path: string): StructureNotices {
  const read = readJsonTolerant(path);
  const value = read.ok && isRecord(read.value) ? read.value : {};
  const number = (raw: unknown): number => (typeof raw === "number" && Number.isInteger(raw) ? raw : 0);
  return { announced: number(value["announced"]), prompted: number(value["prompted"]) };
}

export function writeStructureNotices(path: string, notices: StructureNotices): void {
  writeFileAtomic(path, `${JSON.stringify(notices, null, 2)}\n`);
}

/** The name of the branch of an upgrade to this version. */
export function upgradeBranch(version: number): string {
  return `upgrade-v${String(version)}`;
}

/** The version of an upgrade branch, or null for any other branch. */
export function upgradeBranchVersion(branch: string): number | null {
  const match = /^upgrade-v(\d+)$/.exec(branch);
  return match === null ? null : Number(match[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

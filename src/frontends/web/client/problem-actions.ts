/** The button that fixes each open problem, picked from the problem's key, never from its text. */
import type { VaultSyncState } from "./api.ts";

export type ProblemAction = "pick_version" | "open_schedules" | "open_settings";

export const problemActionLabels: Readonly<Record<ProblemAction, string>> = {
  pick_version: "Pick a version",
  open_schedules: "Open schedules",
  open_settings: "Open Settings",
};

/** A relayed problem belongs to another machine: its own page fixes it. */
export function isOtherMachineProblem(key: string): boolean {
  return key.startsWith("machine:");
}

/**
 * Null: no button on this page can fix it. On the Settings page, the fix of a Settings problem is
 * already on the page, and so is the conflict list.
 */
export function problemAction(
  key: string,
  syncStatus: VaultSyncState["status"],
  { onSettings = false }: { readonly onSettings?: boolean } = {},
): ProblemAction | null {
  if (key.startsWith("schedule:") || key.startsWith("schedule_card:")) return "open_schedules";
  if (isOtherMachineProblem(key) || onSettings) return null;
  if (key === "vault_sync" && syncStatus === "conflict") return "pick_version";
  return "open_settings";
}

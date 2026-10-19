/** The button that fixes each open problem, picked from the problem's key, never from its text. */
import type { VaultSyncState } from "./api.ts";

export type ProblemAction = "pick_version" | "open_schedules" | "open_settings";

export const problemActionLabels: Readonly<Record<ProblemAction, string>> = {
  pick_version: "Pick a version",
  open_schedules: "Open schedules",
  open_settings: "Open Settings",
};

/** Null: no button on this page can fix it. */
export function problemAction(key: string, syncStatus: VaultSyncState["status"]): ProblemAction | null {
  if (key === "vault_sync") return syncStatus === "conflict" ? "pick_version" : "open_settings";
  if (key.startsWith("schedule:") || key.startsWith("schedule_card:")) return "open_schedules";
  // A relayed problem belongs to another machine: its own page fixes it.
  if (key.startsWith("machine:")) return null;
  return "open_settings";
}

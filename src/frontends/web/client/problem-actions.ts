/** The button that fixes each open problem, picked from the problem's key, never from its text. */
import type { VaultSyncState } from "./api.ts";

export type ProblemAction =
  "pick_version" | "open_schedules" | "open_settings" | "choose_template_version" | "open_claude_login";

export const problemActionLabels: Readonly<Record<ProblemAction, string>> = {
  pick_version: "Pick a version",
  open_schedules: "Open schedules",
  open_settings: "Open Settings",
  choose_template_version: "Choose a version",
  open_claude_login: "Open Settings",
};

/** A relayed problem belongs to another machine: its own page fixes it. */
export function isOtherMachineProblem(key: string): boolean {
  return key.startsWith("machine:");
}

/** A page that holds the fix of some problems, so a button to it is useless while it is open. */
export type FixPage = "settings" | "schedules";

/** Null: no button can fix it from here. Settings also holds the conflict list. */
export function problemAction(
  key: string,
  syncStatus: VaultSyncState["status"],
  openPage: FixPage | null = null,
): ProblemAction | null {
  if (key.startsWith("schedule:") || key.startsWith("schedule_card:")) {
    return openPage === "schedules" ? null : "open_schedules";
  }
  if (isOtherMachineProblem(key) || openPage === "settings") return null;
  if (key === "vault_sync" && syncStatus === "conflict") return "pick_version";
  if (key === "template_alignment") return "choose_template_version";
  if (key === "engine_login:claude-code") return "open_claude_login";
  return "open_settings";
}

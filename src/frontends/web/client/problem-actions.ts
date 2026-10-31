/** The button that fixes each open problem, picked from the problem's key, never from its text. */
import type { VaultSyncState } from "./api.ts";

export type ProblemAction =
  | "pick_version"
  | "open_schedules"
  | "open_settings"
  | "choose_template_version"
  | "open_claude_login"
  | "review_widget_update";

export const problemActionLabels: Readonly<Record<ProblemAction, string>> = {
  pick_version: "Pick a version",
  open_schedules: "Open schedules",
  open_settings: "Open Settings",
  choose_template_version: "Choose a version",
  open_claude_login: "Open Settings",
  review_widget_update: "Review the update",
};

const claudeLoginKey = "engine_login:claude-code";

/** A saved token can still have expired, so the Claude Code card must not say the login works. */
export function claudeLoginExpired(problems: readonly { readonly key: string }[]): boolean {
  return problems.some((problem) => problem.key === claudeLoginKey);
}

/** A relayed problem belongs to another machine: its own page fixes it. */
export function isOtherMachineProblem(key: string): boolean {
  return key.startsWith("machine:");
}

/** Null: no button can fix it from here. Settings also holds the conflict list. */
export function problemAction(key: string, syncStatus: VaultSyncState["status"]): ProblemAction | null {
  if (key.startsWith("schedule:") || key.startsWith("schedule_card:")) return "open_schedules";
  if (isOtherMachineProblem(key)) return null;
  if (key === "vault_sync" && syncStatus === "conflict") return "pick_version";
  if (key === "template_alignment") return "choose_template_version";
  if (key === claudeLoginKey) return "open_claude_login";
  if (key.startsWith("widget_update:")) return "review_widget_update";
  return "open_settings";
}

/** The problems that the person did not read: not one that the person hid. An older Eva sends no mark. */
export function shownProblems<Problem extends { readonly hidden?: boolean }>(problems: readonly Problem[]): Problem[] {
  return problems.filter((problem) => problem.hidden !== true);
}

/** Marks each problem whose hide the page sent and Eva has not answered yet, so its notice stays gone. */
export function withPendingHides<Problem extends { readonly key: string; readonly hidden?: boolean }>(
  problems: readonly Problem[],
  pending: ReadonlySet<string>,
): Problem[] {
  return problems.map((problem) => (pending.has(problem.key) ? { ...problem, hidden: true } : problem));
}

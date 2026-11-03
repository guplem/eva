/** The button that fixes each open problem, picked from the problem's key, never from its text. */
import type { VaultSyncState } from "./api.ts";
import { settingsHome, type SettingsRoute } from "./settings-routes.ts";

export type ProblemAction =
  "pick_version" | "open_schedules" | "open_settings" | "choose_template_version" | "review_widget_update";

export const problemActionLabels: Readonly<Record<ProblemAction, string>> = {
  pick_version: "Pick a version",
  open_schedules: "Open schedules",
  open_settings: "Open Settings",
  choose_template_version: "Choose a version",
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
  if (key.startsWith("widget_update:")) return "review_widget_update";
  return "open_settings";
}

/** The card that fixes each problem, by its key: the card that the problem's message names (#799). */
const problemCards: Readonly<Record<string, SettingsRoute>> = {
  vault_sync: { section: "vault", item: "vault-sync" },
  vault_password: { section: "vault", item: "encrypted-files" },
  vault_key_changed: { section: "vault", item: "encrypted-files" },
  vault_secret_files: { section: "vault", item: "encrypted-files" },
  template_alignment: { section: "vault", item: "template-alignment" },
  // The person updates the vault from its card (#801).
  vault_structure: { section: "vault", item: "vault-structure" },
  // Its help explains what the shell of a chat can reach.
  shell_wall: { section: "engines", item: "permissions" },
  default_engine: { section: "updates", item: "versions" },
  engine_update: { section: "updates", item: "versions" },
  default_engine_restart: { section: "updates", item: "restart" },
  update: { section: "updates", item: "eva-updates" },
  vault_ahead: { section: "updates", item: "eva-updates" },
  last_location: { section: "access", item: "location" },
  telegram_poll: { section: "connections", item: "telegram" },
};

/** The part of Settings that fixes a problem, as a search result opens it. An unknown key opens the home page. */
export function problemSettingsRoute(key: string): SettingsRoute {
  const card = problemCards[key];
  if (card !== undefined) return card;
  // The engine name is also the id of its card.
  if (key.startsWith("engine_login:")) return { section: "engines", item: key.slice("engine_login:".length) };
  if (key.startsWith("widget_check:") || key.startsWith("widget_update:"))
    return { section: "personalize", item: "widgets" };
  return settingsHome;
}

/**
 * The button of a news entry, which is never open: the vault structure news of #773 opens its
 * Settings card, while the upgrade is open to this computer. The card is the one way in (#801).
 */
export function newsAction(key: string, canUpgradeVault: boolean): ProblemAction | null {
  return key === "vault_structure" && canUpgradeVault ? "open_settings" : null;
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

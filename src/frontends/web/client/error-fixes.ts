/** The button that fixes a failed action, picked from the error code, never from its text. */
import type { EvaErrorCode } from "../../../shared/errors.ts";
import { setupBlock } from "./new-chat.ts";
import { settingsHash, type SettingsRoute } from "./settings-routes.ts";

export interface ErrorFix {
  readonly label: string;
  readonly address: string;
}

/**
 * The failures that a person fixes in Settings, and the card that fixes each one (#799).
 * An engine failure names no engine, so it opens the AI engines page.
 */
const fixedInSettings: Readonly<Partial<Record<EvaErrorCode, SettingsRoute>>> = {
  engine_failed: { section: "engines", item: null },
  engine_install_failed: { section: "updates", item: "versions" },
  github_failed: { section: "connections", item: "github" },
  google_failed: { section: "connections", item: "google" },
  tailscale_install_failed: { section: "access", item: "remote-access" },
  update_failed: { section: "updates", item: "eva-updates" },
};

/** Null: no page here fixes it. */
export function errorFix(code: EvaErrorCode | null): ErrorFix | null {
  if (code === null) return null;
  // The same button as a new chat without a vault, so one fix has one name.
  if (code === "vault_not_found") {
    const { action, address } = setupBlock("vault");
    return { label: action, address };
  }
  const route = fixedInSettings[code];
  return route === undefined ? null : { label: "Open Settings", address: settingsHash(route) };
}

/** A press on the button where it leads would do nothing, so the button shows only on another page. */
export function fixButtonShown(fix: ErrorFix | null, hash: string): fix is ErrorFix {
  return fix !== null && fix.address !== hash;
}

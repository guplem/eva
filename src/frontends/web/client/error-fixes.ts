/** The button that fixes a failed action, picked from the error code, never from its text. */
import type { EvaErrorCode } from "../../../shared/errors.ts";
import { addressOf } from "./navigation.ts";
import { setupBlock } from "./new-chat.ts";

export interface ErrorFix {
  readonly label: string;
  readonly address: string;
}

/** The failures that a person fixes somewhere in Settings, so the button opens its home page. */
const fixedInSettings: ReadonlySet<EvaErrorCode> = new Set([
  "engine_failed",
  "engine_install_failed",
  "github_failed",
  "google_failed",
  "tailscale_install_failed",
  "update_failed",
]);

/** Null: no page here fixes it. */
export function errorFix(code: EvaErrorCode | null): ErrorFix | null {
  if (code === null) return null;
  // The same button as a new chat without a vault, so one fix has one name.
  if (code === "vault_not_found") {
    const { action, address } = setupBlock("vault");
    return { label: action, address };
  }
  return fixedInSettings.has(code) ? { label: "Open Settings", address: addressOf("settings") } : null;
}

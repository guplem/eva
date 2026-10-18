/**
 * Which state is a problem worth an alert, and the words of each alert. Each message says what
 * happened and what the owner can do, from a phone.
 */
import type { EngineUpdateResult } from "../updates/engine-update.ts";
import type { UpdateStatus } from "../updates/updater.ts";
import type { VaultSyncState } from "../vault/vault-sync.ts";
import type { AlertProblem } from "./alert-center.ts";

/** A short network loss is normal for a laptop; only a long one needs the owner. */
export const vaultOfflineAlertMs = 30 * 60_000;

/**
 * The vault sync problem of a state. "keep" leaves the open problem as it is: a skipped sync
 * says nothing new, and a short offline spell is not a problem yet.
 */
export function vaultSyncProblem(state: VaultSyncState, offlineForMs: number): AlertProblem | null | "keep" {
  const resolvedMessage = "The vault sync works again.";
  switch (state.status) {
    case "ok":
      return null;
    case "skipped":
      return "keep";
    case "offline":
      if (offlineForMs <= vaultOfflineAlertMs) return "keep";
      return {
        level: "warn",
        message:
          "The vault cannot reach its remote for more than 30 minutes. Check the network of this machine; Eva keeps the notes and pushes them later.",
        resolvedMessage,
      };
    case "conflict":
      return {
        level: "error",
        message: `The vault sync stopped on a conflict: ${state.lastError ?? "unknown files."} Send /conflicts, or open Settings on this machine's web page, and pick a version of each note. Nothing is lost: git keeps both versions.`,
        resolvedMessage,
      };
    case "error":
      return {
        level: "error",
        message: `The vault sync failed: ${state.lastError ?? "unknown reason"}. Send /sync to try again, or /logs to see more.`,
        resolvedMessage,
      };
  }
}

/** The update problem of a status: a failed check or a failed install, or null. */
export function updateProblem(status: UpdateStatus): AlertProblem | null {
  if (status.lastError === null) return null;
  if (status.failedStep === "install") {
    return {
      level: "error",
      message: `The update install failed: ${status.lastError}. Eva runs on the old version; send /update to try again.`,
      resolvedMessage: "Updates work again.",
    };
  }
  return {
    level: "warn",
    message: `The update check failed: ${status.lastError}. Eva tries again at the next check; send /update to try now.`,
    resolvedMessage: "Updates work again.",
  };
}

/** The problem of an engine update's result: only a failure. */
export function engineUpdateProblem(result: EngineUpdateResult): AlertProblem | null {
  if (result.outcome !== "failed") return null;
  return {
    level: "warn",
    message: `The Claude Code update failed: ${result.detail ?? "unknown reason."} Chats keep the old version; press Update Claude Code in the settings to try again.`,
    resolvedMessage: "The Claude Code update works again.",
  };
}

export function scheduleFiringProblem(name: string, reason: string): AlertProblem {
  return {
    level: "error",
    message: `The schedule ${name} failed to fire: ${reason}. Check .eva/schedules.json, or send /logs to see more.`,
    resolvedMessage: `The schedule ${name} fires again.`,
  };
}

/** A new or changed schedule waits until a front end shows its setup card (lesson 66). */
export function scheduleCardProblem(name: string): AlertProblem {
  return {
    level: "warn",
    message: `The schedule ${name} waits: no front end showed its setup card, so it does not run. Open the web app and check the card, or pair Telegram.`,
    resolvedMessage: `The schedule ${name} no longer waits for its setup card.`,
  };
}

export const uncleanExitMessage =
  "Eva started after an unclean exit: a crash, a kill or a power loss. Send /logs to see the last errors.";

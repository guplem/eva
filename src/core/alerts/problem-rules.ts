/**
 * Which state is a problem worth an alert, and the words of each alert. Each message says what
 * happened and what the owner can do, from a phone.
 */
import type { EngineName } from "../../shared/engine-port.ts";
import { engineInstallSteps, engineProgramNames } from "../engine-install/engine-install.ts";
import type { EngineUpdateResult } from "../updates/engine-update.ts";
import type { UpdateStatus } from "../updates/updater.ts";
import type { VaultSyncState } from "../vault/vault-sync.ts";
import type { AlertProblem, OpenAlert } from "./alert-center.ts";
import type { VaultAhead } from "../migrations/migrations.ts";

/** A short network loss is normal for a laptop; only a long one needs the owner. */
export const vaultOfflineAlertMs = 30 * 60_000;

/**
 * The vault sync problem of a state. "keep" leaves the open problem as it is: a skip with no
 * reason says nothing new, and a short offline spell is not a problem yet.
 */
export function vaultSyncProblem(state: VaultSyncState, offlineForMs: number): AlertProblem | null | "keep" {
  const resolvedMessage = "The vault sync works again.";
  switch (state.status) {
    case "ok":
      return null;
    case "skipped":
      // A skip with a reason is a vault on another branch: the sync stops until a person acts (#505).
      if (state.lastError === null) return "keep";
      return {
        level: "warn",
        message: `The vault sync is paused. ${state.lastError} Then send /sync.`,
        resolvedMessage,
      };
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
    message: `The Claude Code update failed: ${result.detail ?? "unknown reason."} Chats keep the old version; press Update next to claude in Settings, Updates, to try again.`,
    resolvedMessage: "The Claude Code update works again.",
  };
}

/** The engine refused a turn because its login no longer works. A turn that works clears it. */
export function engineLoginProblem(engine: EngineName): AlertProblem {
  const name = engineProgramNames[engine];
  return {
    level: "error",
    message: `The ${name} login expired, so chats with ${name} fail. On Eva's web page, open Settings, AI engines, ${name}, and log in again.`,
    resolvedMessage: `The ${name} login works again.`,
  };
}

/**
 * The state of the default engine's program. "installed": Eva finds it now, but loaded no
 * engine for it at start, so chats need a restart.
 */
export type EngineProgramState = "loaded" | "installed" | "missing";

/** A default engine with no program: each chat fails, and the person sees no reason without this alert. */
export function engineMissingProblem(
  engine: EngineName,
  state: EngineProgramState,
  platform: NodeJS.Platform,
): AlertProblem | null {
  if (state !== "missing") return null;
  const name = engineProgramNames[engine];
  return {
    level: "error",
    message: [
      `Eva finds no ${name} program, so chats fail.`,
      `Press Install next to ${engine === "claude-code" ? "claude" : "pi"} in Settings, Updates, then Restart now.`,
      "Or run `eva setup` again on this computer.",
      `Or install it by hand: ${engineInstallSteps(engine, platform)}`,
    ].join(" "),
    resolvedMessage: `Eva finds the ${name} program again.`,
  };
}

/**
 * A program installed since the start. It has its own key: an open key changes its text with no
 * new alert, so the phone would not hear that a restart now fixes the chats.
 */
export function engineRestartProblem(engine: EngineName, state: EngineProgramState): AlertProblem | null {
  if (state !== "installed") return null;
  const name = engineProgramNames[engine];
  return {
    level: "warn",
    // No /restart: on a relayed alert, a Telegram command restarts the hub.
    message: `The ${name} program is installed now, but chats use it only after a restart. Press Restart now in Settings, Updates.`,
    resolvedMessage: `Chats use the ${name} program.`,
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

/** The vault's record lists a migration that this Eva does not know: a newer Eva wrote it. */
export function vaultAheadProblem(ahead: VaultAhead | null, machine: string, version: string): AlertProblem | null {
  if (ahead === null) return null;
  const problem = ahead.readable
    ? `${machine} runs Eva ${version}, but the vault needs ${ahead.version === null ? "a newer Eva" : `Eva ${ahead.version}`}. Update Eva on ${machine}.`
    : `Eva on ${machine} cannot read .eva/migrations.json in the vault. Ask the Assistant to repair it, or update Eva on ${machine}.`;
  return {
    level: "warn",
    message: `${problem} Until then, Eva on ${machine} does not change the vault's settings, schedules or hub. Chats and the vault sync go on.`,
    resolvedMessage: `${machine} runs an Eva that knows the vault's format again.`,
  };
}

/** A migration at start failed, or its record is broken. Eva keeps the files and tries again at the next start. */
export function migrationFailedMessage(store: "machine" | "vault", id: string | null, reason: string): string {
  if (id === null)
    return `Eva cannot read the record of the ${store} migrations. ${reason} Repair or delete the file: each migration is safe to run again.`;
  return `The ${store} migration ${id} failed. ${reason} The files stay as they were. Eva tries again at the next start. Send /logs to see more.`;
}

/** The machine's record lists a migration that this Eva does not know, such as after a person installed an older Eva. */
export function machineAheadMessage(version: string): string {
  return `A newer Eva migrated the files of this computer, so Eva ${version} runs no migration on them. Install the newer Eva again.`;
}

/** The news of a release that the update policy holds back, or null when none waits. */
export function heldBackNews(status: UpdateStatus): string | null {
  const version = status.heldBack;
  if (version === null) return null;
  const major = status.releases.find((release) => release.version === version)?.level === "major";
  return [
    `Eva ${version} is out. Your update policy (${status.install}) does not install it by herself.`,
    major ? "It is a major release, so it can break things." : "",
    "Send /update to see what it brings and install it.",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * A problem that another machine reports through the vault, for the hub to send. A Telegram command
 * acts on the hub, so the alert points to the web page of the machine with the problem.
 */
export function relayedProblem(machine: string, reportFile: string, problem: OpenAlert): AlertProblem {
  // A message such as vault_ahead starts with the machine name already.
  const named = (line: string): string => (line.startsWith(`${machine} `) ? line : `On ${machine}: ${line}`);
  return {
    level: problem.level,
    message: [
      named(problem.message),
      `A Telegram command acts on the hub, so open Eva's web page on ${machine}.`,
      `If ${machine} no longer runs Eva, ask the Assistant to delete ${reportFile}.`,
    ].join(" "),
    resolvedMessage:
      problem.resolvedMessage === "" ? `${machine} no longer reports this problem.` : named(problem.resolvedMessage),
  };
}

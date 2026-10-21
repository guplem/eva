import { describe, expect, test } from "bun:test";
import {
  scheduleCardProblem,
  scheduleFiringProblem,
  engineUpdateProblem,
  relayedProblem,
  updateProblem,
  vaultOfflineAlertMs,
  vaultSyncProblem,
} from "../../../../src/core/alerts/problem-rules.ts";
import type { UpdateStatus } from "../../../../src/core/updates/updater.ts";
import type { VaultSyncState } from "../../../../src/core/vault/vault-sync.ts";

function syncState(status: VaultSyncState["status"], lastError: string | null = null): VaultSyncState {
  return { status, lastCommitAt: null, lastPushAt: null, lastError, withheldFiles: [] };
}

const idleUpdate: UpdateStatus = {
  kind: "source",
  frequency: "daily",
  install: "minor",
  target: null,
  heldBack: null,
  releases: [],
  phase: "idle",
  current: "aaa1111",
  latest: "aaa1111",
  available: false,
  lastCheckAt: "2026-10-17T10:00:00.000Z",
  lastError: null,
  failedStep: null,
  download: null,
};

describe("vaultSyncProblem", () => {
  test("a conflict is an error that names the files and the fix from a phone", () => {
    const problem = vaultSyncProblem(syncState("conflict", "Conflict in Notes/a.md"), 0);
    expect(problem).toMatchObject({ level: "error" });
    const message = problem === "keep" ? "" : (problem?.message ?? "");
    expect(message).toContain("Conflict in Notes/a.md");
    expect(message).toContain("/conflicts");
    expect(message).toContain("web page");
    expect(message).not.toContain("git add");
  });

  test("a sync error is an error with git's reason", () => {
    const problem = vaultSyncProblem(syncState("error", "git commit failed: disk full"), 0);
    expect(problem).toMatchObject({ level: "error" });
    expect(problem === "keep" ? "" : (problem?.message ?? "")).toContain("disk full");
  });

  test("offline is a problem only after 30 minutes", () => {
    expect(vaultSyncProblem(syncState("offline"), vaultOfflineAlertMs)).toBe("keep");
    expect(vaultSyncProblem(syncState("offline"), vaultOfflineAlertMs + 1)).toMatchObject({ level: "warn" });
  });

  test("ok clears the problem, and skipped keeps whatever was there", () => {
    expect(vaultSyncProblem(syncState("ok"), 0)).toBeNull();
    expect(vaultSyncProblem(syncState("skipped", "busy"), 0)).toBe("keep");
  });
});

describe("updateProblem", () => {
  test("no error is no problem", () => {
    expect(updateProblem(idleUpdate)).toBeNull();
  });

  test("a failed check and a failed install each say which step failed", () => {
    const check = updateProblem({ ...idleUpdate, lastError: "offline", failedStep: "check" });
    const install = updateProblem({ ...idleUpdate, lastError: "bun install failed", failedStep: "install" });
    expect(check?.message).toStartWith("The update check failed: offline.");
    expect(install?.message).toStartWith("The update install failed: bun install failed.");
    expect(install?.level).toBe("error");
  });
});

describe("scheduleFiringProblem", () => {
  test("names the schedule and the reason", () => {
    const problem = scheduleFiringProblem("Lunch", "no engine");
    expect(problem.message).toContain("Lunch");
    expect(problem.message).toContain("no engine");
    expect(problem.resolvedMessage).toContain("Lunch");
  });
});

describe("scheduleCardProblem", () => {
  test("names the schedule and a fix from a phone", () => {
    const problem = scheduleCardProblem("Lunch");
    expect(problem.message).toContain("Lunch");
    expect(problem.message).toContain("web app");
    expect(problem.message).toContain("Telegram");
    expect(problem.resolvedMessage).toContain("Lunch");
  });
});

describe("engineUpdateProblem", () => {
  const result = { before: "2.1.0", after: "2.1.0", detail: null, at: "2026-10-17T10:00:00.000Z" };

  test("only a failed engine update is a problem, and it says what to do from the phone", () => {
    expect(engineUpdateProblem({ ...result, outcome: "up_to_date" })).toBeNull();
    expect(engineUpdateProblem({ ...result, outcome: "updated" })).toBeNull();
    const problem = engineUpdateProblem({ ...result, outcome: "failed", detail: "No network." });
    expect(problem?.level).toBe("warn");
    expect(problem?.message).toBe(
      "The Claude Code update failed: No network. Chats keep the old version; press Update next to claude in Settings, Updates, to try again.",
    );
  });
});

describe("relayedProblem", () => {
  const file = ".eva/machines/laptop.json";

  test("names the machine once, points to its web page, and names the file to delete", () => {
    const relayed = relayedProblem("laptop", file, {
      key: "update",
      level: "error",
      message: "The update install failed.",
      resolvedMessage: "Updates work again.",
    });
    expect(relayed.level).toBe("error");
    expect(relayed.message).toBe(
      "On laptop: The update install failed. A Telegram command acts on the hub, so open Eva's web page on laptop. If laptop no longer runs Eva, ask the Assistant to delete .eva/machines/laptop.json.",
    );
    expect(relayed.resolvedMessage).toBe("On laptop: Updates work again.");
  });

  test("adds no prefix to a message that names the machine already", () => {
    const relayed = relayedProblem("laptop", file, {
      key: "vault_ahead",
      level: "warn",
      message: "laptop runs Eva 1.0.0.",
      resolvedMessage: "",
    });
    expect(relayed.message.startsWith("laptop runs Eva 1.0.0. ")).toBe(true);
    expect(relayed.resolvedMessage).toBe("laptop no longer reports this problem.");
  });

  test("a short name inside a word is no name: the prefix stays", () => {
    const relayed = relayedProblem("pc", ".eva/machines/pc.json", {
      key: "update",
      level: "warn",
      message: "The update check failed: no specification.",
      resolvedMessage: "Updates work again.",
    });
    expect(relayed.message.startsWith("On pc: The update check failed")).toBe(true);
  });
});

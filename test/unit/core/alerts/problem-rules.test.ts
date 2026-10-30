import { describe, expect, test } from "bun:test";
import {
  scheduleCardProblem,
  scheduleFiringProblem,
  engineLoginProblem,
  engineMissingProblem,
  engineRestartProblem,
  engineUpdateProblem,
  relayedProblem,
  updateProblem,
  vaultErrorAlertSteps,
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
  failingSince: null,
  download: null,
};

describe("vaultSyncProblem", () => {
  test("a conflict is an error that names the files and the fix from a phone", () => {
    const problem = vaultSyncProblem(syncState("conflict", "Conflict in Notes/a.md"), 0, 0);
    expect(problem).toMatchObject({ level: "error" });
    const message = problem === "keep" ? "" : (problem?.message ?? "");
    expect(message).toContain("Conflict in Notes/a.md");
    expect(message).toContain("/conflicts");
    expect(message).toContain("web page");
    expect(message).not.toContain("git add");
  });

  test("a sync error is an error with git's reason", () => {
    const problem = vaultSyncProblem(syncState("error", "git commit failed: disk full"), 0, vaultErrorAlertSteps);
    expect(problem).toMatchObject({ level: "error" });
    expect(problem === "keep" ? "" : (problem?.message ?? "")).toContain("disk full");
    const ended = vaultSyncProblem(syncState("error", "git push failed."), 0, vaultErrorAlertSteps);
    expect(ended === "keep" ? "" : ended?.message).toStartWith("The vault sync failed: git push failed. Send");
  });

  test("a sync error is a problem only when the next sync step fails too (#631)", () => {
    const error = syncState("error", "git add failed: a note moved");
    expect(vaultSyncProblem(error, 0, vaultErrorAlertSteps - 1)).toBe("keep");
    expect(vaultSyncProblem(error, 0, vaultErrorAlertSteps)).toMatchObject({ level: "error" });
  });

  test("offline is a problem only after 30 minutes", () => {
    expect(vaultSyncProblem(syncState("offline"), vaultOfflineAlertMs, 0)).toBe("keep");
    expect(vaultSyncProblem(syncState("offline"), vaultOfflineAlertMs + 1, 0)).toMatchObject({ level: "warn" });
  });

  test("ok clears the problem, and a skip with no reason keeps whatever was there", () => {
    expect(vaultSyncProblem(syncState("ok"), 0, 0)).toBeNull();
    expect(vaultSyncProblem(syncState("skipped"), 0, 0)).toBe("keep");
  });

  test("a skip on the wrong branch warns, with the reason and a fix from a phone (#505)", () => {
    const reason =
      "Eva syncs main, but the vault is on feat/work. If main is right, ask the Assistant to switch the vault back to it.";
    const problem = vaultSyncProblem(syncState("skipped", reason), 0, 0);
    expect(problem).toMatchObject({ level: "warn" });
    expect(problem === "keep" ? "" : problem?.message).toBe(`The vault sync is paused. ${reason} Then send /sync.`);
  });
});

describe("updateProblem", () => {
  /** A check that fails since `since`, and failed again at `last`. */
  const failing = (since: string, last = "2026-10-17T12:00:00.000Z"): UpdateStatus => ({
    ...idleUpdate,
    lastError: "GitHub could not be reached.",
    failedStep: "check",
    failingSince: since,
    lastCheckAt: last,
  });

  test("no error is no problem", () => {
    expect(updateProblem(idleUpdate)).toBeNull();
  });

  test("checks that fail for less than 2 hours keep whatever was there (#541)", () => {
    expect(updateProblem(failing("2026-10-17T10:00:00.001Z"))).toBe("keep");
  });

  test("one failed check stays quiet however long ago it was: no check since then failed", () => {
    expect(updateProblem(failing("2026-10-17T12:00:00.000Z"))).toBe("keep");
  });

  test("checks that fail for 2 hours warn, with one period after the reason and no slash command", () => {
    expect(updateProblem(failing("2026-10-17T10:00:00.000Z"))).toEqual({
      level: "warn",
      message:
        "Eva could not check for updates for 2 hours or more. The last error: GitHub could not be reached. She tries again within an hour. To try now, open Settings, Updates.",
      resolvedMessage: "Updates work again.",
    });
  });

  test("with the checks off, the warning does not say that Eva tries again", () => {
    const problem = updateProblem({ ...failing("2026-10-17T09:00:00.000Z"), frequency: "off" });
    expect(problem === "keep" ? "" : problem?.message).toBe(
      "Eva could not check for updates for 2 hours or more. The last error: GitHub could not be reached. To try now, open Settings, Updates.",
    );
  });

  test("a failed install is an error at once", () => {
    expect(updateProblem({ ...idleUpdate, lastError: "bun install failed.", failedStep: "install" })).toEqual({
      level: "error",
      message:
        "Eva could not install the update: bun install failed. She still runs the old version. To try again, open Settings, Updates.",
      resolvedMessage: "Updates work again.",
    });
  });
});

describe("scheduleFiringProblem", () => {
  test("names the schedule and the reason", () => {
    const problem = scheduleFiringProblem("Lunch", "no engine");
    expect(problem.message).toContain("Lunch");
    expect(problem.message).toContain("no engine");
    expect(problem.resolvedMessage).toContain("Lunch");
  });

  test("a reason that ends with a period gets no second one", () => {
    expect(scheduleFiringProblem("Lunch", "No engine.").message).toStartWith(
      "The schedule Lunch failed to fire: No engine. Check",
    );
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

describe("engineLoginProblem", () => {
  test("names the engine and the fix from a phone, never a terminal command", () => {
    const problem = engineLoginProblem("claude-code");
    expect(problem.level).toBe("error");
    expect(problem.message).toContain("Claude Code login expired");
    expect(problem.message).toContain("Settings, AI engines, Claude Code");
    expect(problem.message).not.toContain("/login");
    expect(problem.resolvedMessage).toBe("The Claude Code login works again.");
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

  test("names the machine once, says where to fix it, and names the file to delete", () => {
    const relayed = relayedProblem("laptop", "desktop", file, {
      key: "update",
      level: "error",
      message: "The update install failed.",
      resolvedMessage: "Updates work again.",
    });
    expect(relayed.level).toBe("error");
    expect(relayed.message).toBe(
      "On laptop: The update install failed. Fix it in Eva on laptop, not on desktop. If laptop no longer runs Eva, ask the Assistant to delete .eva/machines/laptop.json.",
    );
    expect(relayed.resolvedMessage).toBe("On laptop: Updates work again.");
  });

  test("adds no prefix to a message that names the machine already", () => {
    const relayed = relayedProblem("laptop", "desktop", file, {
      key: "vault_ahead",
      level: "warn",
      message: "laptop runs Eva 1.0.0.",
      resolvedMessage: "",
    });
    expect(relayed.message.startsWith("laptop runs Eva 1.0.0. ")).toBe(true);
    expect(relayed.resolvedMessage).toBe("laptop no longer reports this problem.");
  });

  test("a short name inside a word is no name: the prefix stays", () => {
    const relayed = relayedProblem("pc", "desktop", ".eva/machines/pc.json", {
      key: "update",
      level: "warn",
      message: "Eva could not check for updates: no specification.",
      resolvedMessage: "Updates work again.",
    });
    expect(relayed.message.startsWith("On pc: Eva could not check")).toBe(true);
  });

  test("says how old the report is when it is more than one day old (#542)", () => {
    const problem = { key: "update", level: "warn", message: "No update check.", resolvedMessage: "" } as const;
    const dayMs = 24 * 60 * 60_000;
    const aged = (ageMs: number | null): string => relayedProblem("laptop", "desktop", file, problem, ageMs).message;
    expect(aged(5 * dayMs + 60_000)).toBe(
      "On laptop: No update check. laptop last reported 5 days ago. Fix it in Eva on laptop, not on desktop. If laptop no longer runs Eva, ask the Assistant to delete .eva/machines/laptop.json.",
    );
    expect(aged(dayMs + 60_000)).toContain(" laptop last reported 1 day ago. ");
    for (const fresh of [null, dayMs, -5 * dayMs]) expect(aged(fresh)).not.toContain("last reported");
  });
});

describe("engineMissingProblem", () => {
  test("a loaded or installed engine is no missing program", () => {
    expect(engineMissingProblem("claude-code", "loaded", "linux")).toBeNull();
    expect(engineMissingProblem("claude-code", "installed", "linux")).toBeNull();
  });

  test("a missing program is an error that names the engine and each fix", () => {
    const problem = engineMissingProblem("claude-code", "missing", "linux");
    expect(problem?.level).toBe("error");
    expect(problem?.message).toBe(
      "Eva finds no Claude Code program, so chats fail. Press Install next to claude in Settings, Updates, then Restart now. Or run `eva setup` again on this computer. Or install it by hand: Run `curl -fsSL https://claude.ai/install.sh | bash`. See https://code.claude.com.",
    );
    expect(problem?.resolvedMessage).toBe("Eva finds the Claude Code program again.");
  });

  test("the steps by hand fit the system", () => {
    expect(engineMissingProblem("pi", "missing", "win32")?.message).toContain(
      "In PowerShell, run `irm https://pi.dev/install.ps1 | iex`.",
    );
  });
});

describe("engineRestartProblem", () => {
  test("only a program installed since the start asks for a restart", () => {
    expect(engineRestartProblem("pi", "loaded")).toBeNull();
    expect(engineRestartProblem("pi", "missing")).toBeNull();
    const problem = engineRestartProblem("pi", "installed");
    expect(problem?.level).toBe("warn");
    expect(problem?.message).toBe(
      "The pi program is installed now, but chats use it only after a restart. Press Restart now in Settings, Updates.",
    );
  });
});

test("the relayed update check warning reads as one clear notice (#541)", () => {
  const status: UpdateStatus = {
    ...idleUpdate,
    lastError: "GitHub could not be reached.",
    failedStep: "check",
    failingSince: "2026-10-17T10:00:00.000Z",
    lastCheckAt: "2026-10-17T12:00:00.000Z",
  };
  const problem = updateProblem(status);
  if (problem === null || problem === "keep") throw new Error("A warning was expected.");
  expect(relayedProblem("laptop", "desktop", ".eva/machines/laptop.json", { key: "update", ...problem }).message).toBe(
    "On laptop: Eva could not check for updates for 2 hours or more. The last error: GitHub could not be reached. She tries again within an hour. To try now, open Settings, Updates. Fix it in Eva on laptop, not on desktop. If laptop no longer runs Eva, ask the Assistant to delete .eva/machines/laptop.json.",
  );
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AlertProblem } from "../../../../src/core/alerts/alert-center.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { VaultUpkeep } from "../../../../src/core/vault/vault-upkeep.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

function createUpkeep(state: { busy: boolean; reports: (AlertProblem | null)[] }): VaultUpkeep {
  const now = (): Date => new Date(2026, 9, 14, 12, 0);
  return new VaultUpkeep({
    vaultSync: new VaultSync({ vaultPath: vault, runner: systemProcessRunner, environment: gitEnvironment, now }),
    now,
    syncEnabled: () => true,
    vaultTurnRunning: () => state.busy,
    reportProblem: (problem) => state.reports.push(problem),
  });
}

describe("VaultUpkeep alerts for a skipped sync", () => {
  test("a vault on another branch opens a warning, a busy skip does not, and the way back closes it (#505)", async () => {
    const state = { busy: false, reports: [] as (AlertProblem | null)[] };
    const upkeep = createUpkeep(state);
    sandbox.git(vault, "switch", "-q", "-c", "ideas");
    sandbox.write(vault, "note.md", "kept\n");

    expect(await upkeep.sweep()).toBe("skipped");
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({ level: "warn" });
    expect(state.reports[0]?.message).toContain("Eva syncs main, but the vault is on ideas.");

    state.busy = true;
    expect((await upkeep.syncNow()).status).toBe("skipped");
    expect(await upkeep.sweep()).toBe("skipped");
    expect(state.reports).toHaveLength(1);

    state.busy = false;
    sandbox.git(vault, "switch", "-q", "main");
    expect(await upkeep.sweep()).toBe("ok");
    expect(state.reports.at(-1)).toBeNull();
  });
});

describe("VaultUpkeep undo of answers", () => {
  const answers = [{ before: "refs/eva/turns/chat/0/before", after: "refs/eva/turns/chat/0/after" }];

  test("undoes the files of an answer, and pushes the undo", async () => {
    const upkeep = createUpkeep({ busy: false, reports: [] });
    sandbox.write(vault, "plan.md", "first\n");
    await upkeep.save();
    await upkeep.snapshot(answers[0]?.before ?? "");
    sandbox.write(vault, "plan.md", "bad\n");
    await upkeep.snapshot(answers[0]?.after ?? "");
    await upkeep.save();

    expect(await upkeep.undoPreview(answers)).toEqual({ restore: ["plan.md"], changed: [], notKept: [], answers: 1 });
    expect((await upkeep.undo(answers)).restore).toEqual(["plan.md"]);
    expect(sandbox.git(sandbox.remote, "show", "main:plan.md")).toBe("first");
    await upkeep.deleteSnapshots("chat");
    expect(sandbox.git(vault, "for-each-ref", "refs/eva")).toBe("");
  });

  test("refuses while an Assistant chat runs a turn", async () => {
    const caught = await createUpkeep({ busy: true, reports: [] })
      .undo(answers)
      .catch((error: unknown) => error);
    expect(isEvaError(caught, "session_busy")).toBe(true);
  });

  test("with no vault, nothing to undo", async () => {
    const upkeep = new VaultUpkeep({
      vaultSync: null,
      now: () => new Date(2026, 9, 14, 12, 0),
      syncEnabled: () => true,
      vaultTurnRunning: () => false,
      reportProblem: () => undefined,
    });
    await upkeep.snapshot("refs/eva/turns/chat/0/before");
    await upkeep.deleteSnapshots("chat");
    expect(await upkeep.undoPreview(answers)).toEqual({ restore: [], changed: [], notKept: [], answers: 0 });
    expect(await upkeep.undo(answers)).toEqual({ restore: [], changed: [], notKept: [], answers: 0 });
  });
});

test("an undo refuses when an Assistant turn starts during its pull", async () => {
  let checks = 0;
  const upkeep = new VaultUpkeep({
    vaultSync: new VaultSync({
      vaultPath: vault,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      now: () => new Date(2026, 9, 14, 12, 0),
    }),
    now: () => new Date(2026, 9, 14, 12, 0),
    syncEnabled: () => true,
    vaultTurnRunning: () => (checks += 1) > 1,
    reportProblem: () => undefined,
  });
  const caught = await upkeep
    .undo([{ before: "refs/eva/turns/chat/0/before", after: "refs/eva/turns/chat/0/after" }])
    .catch((error: unknown) => error);
  expect(isEvaError(caught, "session_busy")).toBe(true);
});

test("with sync off, a retry asks nothing and undoes nothing", async () => {
  let enabled = true;
  const now = (): Date => new Date(2026, 9, 14, 12, 0);
  const upkeep = new VaultUpkeep({
    vaultSync: new VaultSync({ vaultPath: vault, runner: systemProcessRunner, environment: gitEnvironment, now }),
    now,
    syncEnabled: () => enabled,
    vaultTurnRunning: () => false,
    reportProblem: () => undefined,
  });
  const answers = [{ before: "refs/eva/turns/chat/0/before", after: "refs/eva/turns/chat/0/after" }];
  await upkeep.snapshot(answers[0]?.before ?? "");
  sandbox.write(vault, "plan.md", "bad\n");
  await upkeep.snapshot(answers[0]?.after ?? "");
  enabled = false;
  const none = { restore: [], changed: [], notKept: [], answers: 0 };
  expect(await upkeep.undoPreview(answers)).toEqual(none);
  expect(await upkeep.undo(answers)).toEqual(none);
  expect(sandbox.git(vault, "status", "--porcelain")).toContain("plan.md");
  // With sync off, no new snapshot either.
  await upkeep.snapshot("refs/eva/turns/chat/1/before");
  expect(sandbox.git(vault, "for-each-ref", "--format=%(refname)", "refs/eva/turns/chat/1")).toBe("");
});

describe("VaultUpkeep afterFetch (#529)", () => {
  interface FetchState {
    busy: boolean;
    syncEnabled: boolean;
    fetches: number;
  }

  function createFetchUpkeep(state: FetchState, onFetch: () => void = () => undefined): VaultUpkeep {
    const now = (): Date => new Date(2026, 9, 14, 12, 0);
    return new VaultUpkeep({
      vaultSync: new VaultSync({ vaultPath: vault, runner: systemProcessRunner, environment: gitEnvironment, now }),
      now,
      syncEnabled: () => state.syncEnabled,
      vaultTurnRunning: () => state.busy,
      reportProblem: () => undefined,
      afterFetch: () => {
        state.fetches += 1;
        onFetch();
      },
    });
  }

  const sync = { enabled: true, pullIntervalMinutes: 5, sweepSeconds: 60 };

  test("the timed pull runs it after a fetch that worked", async () => {
    const state = { busy: false, syncEnabled: true, fetches: 0 };
    await createFetchUpkeep(state).pullIfDue(sync);
    expect(state.fetches).toBe(1);
  });

  test("Sync now runs it between the pull and the save, so the save pushes its file", async () => {
    const state = { busy: false, syncEnabled: true, fetches: 0 };
    const upkeep = createFetchUpkeep(state, () => {
      sandbox.write(vault, ".eva/hub.json", '{"machine":"example-pc","since":""}\n');
    });
    expect((await upkeep.syncNow()).status).toBe("ok");
    expect(state.fetches).toBe(1);
    expect(sandbox.git(sandbox.remote, "show", "main:.eva/hub.json")).toContain("example-pc");
  });

  test("Sync now with sync off does not run it", async () => {
    const state = { busy: false, syncEnabled: false, fetches: 0 };
    await createFetchUpkeep(state).syncNow();
    expect(state.fetches).toBe(0);
  });

  test("a read or a pick of a conflict, the sweep and the turn pull never run it", async () => {
    const state = { busy: false, syncEnabled: true, fetches: 0 };
    const upkeep = createFetchUpkeep(state);
    await upkeep.conflicts();
    await upkeep.resolve("note.md", "mine");
    await upkeep.sweep();
    await upkeep.pull();
    expect(state.fetches).toBe(0);
  });

  test("a pull that cannot reach the remote does not run it", async () => {
    const state = { busy: false, syncEnabled: true, fetches: 0 };
    sandbox.git(vault, "remote", "set-url", "origin", `${sandbox.root}/missing.git`);
    const upkeep = createFetchUpkeep(state);
    await upkeep.pullIfDue(sync);
    expect((await upkeep.syncNow()).status).toBe("offline");
    expect(state.fetches).toBe(0);
  });

  test("an Assistant turn that starts during the fetch stops it", async () => {
    const state = { busy: false, syncEnabled: true, fetches: 0 };
    const now = (): Date => new Date(2026, 9, 14, 12, 0);
    const vaultSync = new VaultSync({
      vaultPath: vault,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      now,
    });
    const upkeep = new VaultUpkeep({
      vaultSync,
      now,
      syncEnabled: () => true,
      // The timed pull asks once before the fetch; each later answer says a turn runs.
      vaultTurnRunning: () => {
        const busy = state.busy;
        state.busy = true;
        return busy;
      },
      reportProblem: () => undefined,
      afterFetch: () => {
        state.fetches += 1;
      },
    });
    await upkeep.pullIfDue(sync);
    expect(state.fetches).toBe(0);
  });
});

describe("VaultUpkeep alerts for a sync error (#631)", () => {
  /** git commit fails while `failing.on` is true; every other step runs for real. */
  function failingUpkeep(state: { reports: (AlertProblem | null)[] }, failing: { on: boolean }): VaultUpkeep {
    const runner: ProcessRunner = {
      run(command, options) {
        if (failing.on && command[1] === "commit")
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "fatal: boom" });
        return systemProcessRunner.run(command, options);
      },
    };
    const now = (): Date => new Date(2026, 9, 14, 12, 0);
    return new VaultUpkeep({
      vaultSync: new VaultSync({ vaultPath: vault, runner, environment: gitEnvironment, now }),
      now,
      syncEnabled: () => true,
      vaultTurnRunning: () => false,
      reportProblem: (problem) => state.reports.push(problem),
    });
  }

  test("one failed sweep that the next sweep fixes opens no alert", async () => {
    const state = { reports: [] as (AlertProblem | null)[] };
    const failing = { on: true };
    const upkeep = failingUpkeep(state, failing);
    sandbox.write(vault, "note.md", "kept\n");
    expect(await upkeep.sweep()).toBe("error");
    failing.on = false;
    expect(await upkeep.sweep()).toBe("ok");
    expect(state.reports.filter((problem) => problem !== null)).toEqual([]);
  });

  test("an error on two sweeps in a row opens the alert, and a read of the conflicts does not count", async () => {
    const state = { reports: [] as (AlertProblem | null)[] };
    const upkeep = failingUpkeep(state, { on: true });
    sandbox.write(vault, "note.md", "kept\n");
    expect(await upkeep.sweep()).toBe("error");
    // The web app reads the conflicts on its own; the read runs no sync step.
    await upkeep.conflicts();
    expect(state.reports.filter((problem) => problem !== null)).toEqual([]);
    expect(await upkeep.sweep()).toBe("error");
    expect(state.reports.at(-1)).toMatchObject({ level: "error" });
    expect(state.reports.at(-1)?.message).toContain("fatal: boom");
  });
});

describe("VaultUpkeep alerts for a save that fails while pulls work (#631)", () => {
  test("a pull that works neither resets the count nor closes the alert of a failed save", async () => {
    const state = { reports: [] as (AlertProblem | null)[] };
    const runner: ProcessRunner = {
      run(command, options) {
        if (command[1] === "commit") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "fatal: boom" });
        return systemProcessRunner.run(command, options);
      },
    };
    const now = (): Date => new Date(2026, 9, 14, 12, 0);
    const upkeep = new VaultUpkeep({
      vaultSync: new VaultSync({ vaultPath: vault, runner, environment: gitEnvironment, now }),
      now,
      syncEnabled: () => true,
      vaultTurnRunning: () => false,
      reportProblem: (problem) => state.reports.push(problem),
    });
    sandbox.write(vault, "note.md", "kept\n");
    expect(await upkeep.sweep()).toBe("error");
    expect((await upkeep.pull()).status).toBe("ok");
    expect(await upkeep.sweep()).toBe("error");
    expect(state.reports.at(-1)).toMatchObject({ level: "error" });
    expect((await upkeep.pull()).status).toBe("ok");
    expect(state.reports.at(-1)).toMatchObject({ level: "error" });
  });
});

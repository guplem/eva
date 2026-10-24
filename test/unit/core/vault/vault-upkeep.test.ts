import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AlertProblem } from "../../../../src/core/alerts/alert-center.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { VaultUpkeep } from "../../../../src/core/vault/vault-upkeep.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
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
    assistantBusy: () => state.busy,
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
      assistantBusy: () => state.busy,
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
      assistantBusy: () => {
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

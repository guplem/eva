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

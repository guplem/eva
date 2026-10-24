import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AlertProblem } from "../../../../src/core/alerts/alert-center.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { VaultUpkeep } from "../../../../src/core/vault/vault-upkeep.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
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

    expect(await upkeep.undoPreview(answers)).toEqual({ restore: ["plan.md"], changed: [], notKept: [] });
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
      assistantBusy: () => false,
      reportProblem: () => undefined,
    });
    await upkeep.snapshot("refs/eva/turns/chat/0/before");
    await upkeep.deleteSnapshots("chat");
    expect(await upkeep.undoPreview(answers)).toEqual({ restore: [], changed: [], notKept: [] });
    expect(await upkeep.undo(answers)).toEqual({ restore: [], changed: [], notKept: [] });
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
    assistantBusy: () => (checks += 1) > 1,
    reportProblem: () => undefined,
  });
  const caught = await upkeep
    .undo([{ before: "refs/eva/turns/chat/0/before", after: "refs/eva/turns/chat/0/after" }])
    .catch((error: unknown) => error);
  expect(isEvaError(caught, "session_busy")).toBe(true);
});

/** Tests of the hub claim and of the reports that each machine shares. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Alert } from "../../../src/core/alerts/alert-center.ts";
import type { Eva } from "../../../src/core/eva.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { useEvaTestbed, clock, sandbox, setClock, start, syncOn, vault } from "../../support/eva-testbed.ts";

useEvaTestbed();

describe("the hub claim after a later fetch (#529)", () => {
  const claimedBy = (): unknown => JSON.parse(readFileSync(join(vault, ".eva", "hub.json"), "utf-8"));

  test("a machine that started with no claim claims the hub at its first timed pull", async () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.backgroundTick();
    expect(claimedBy()).toMatchObject({ machine: "example-pc" });
    expect(instance.role()).toBe("hub");
  });

  test("a claim that another machine pushed wins over a later fetch", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "claim");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(new FakeEngine(), { machineName: "example-pc", sync: syncOn });
    await instance.backgroundTick();
    expect(claimedBy()).toMatchObject({ machine: "other-pc" });
    expect(instance.role()).toBe("satellite");
  });
});

describe("machine reports (#126)", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }
  const hubClaim = (machine: string): string => JSON.stringify({ machine, since: "" });
  const laptopReport = (problems: unknown[]): string =>
    JSON.stringify({ machine: "laptop", version: "0.1.0", problems });
  const ahead = { key: "vault_ahead", level: "warn", message: "Update Eva on laptop.", resolvedMessage: "Fixed." };
  const readReport = (machine: string): unknown =>
    JSON.parse(readFileSync(join(vault, ".eva", "machines", `${machine}.json`), "utf-8"));

  test("a satellite behind the vault writes its problem to its report, and the sync pushes it", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    sandbox.write(
      vault,
      ".eva/migrations.json",
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportStartMigrations({ machine: { kind: "done", applied: [], later: [] }, vault: null });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({
      machine: "example-pc",
      problems: [{ key: "vault_ahead", level: "warn" }],
    });
    expect(sandbox.git(vault, "status", "--porcelain")).toBe("");
  });

  test("the report leaves out the vault sync problem, which cannot travel through the sync", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("vault_sync", { level: "error", message: "The sync failed.", resolvedMessage: "Ok." });
    instance.reportProblem("telegram", { level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({ problems: [{ key: "telegram" }] });
  });

  test("the report leaves out the vault structure warning, which belongs to the hub alone (#801)", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportStartMigrations({ machine: { kind: "done", applied: [], later: [] }, vault: null });
    instance.reportProblem("telegram", { level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." });
    expect(instance.status().problemDetails.map((problem) => problem.key)).toContain("vault_structure");
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({ problems: [{ key: "telegram" }] });
  });

  test("the hub raises one alert per problem of another machine, named after it, until the report clears", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    sandbox.write(
      vault,
      ".eva/machines/example-pc.json",
      JSON.stringify({ machine: "example-pc", version: "", problems: [ahead] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["machine:laptop:vault_ahead", "warn"]]);
    expect(alerts[0]?.message.startsWith("On laptop: Update Eva on laptop. ")).toBe(true);
    expect(alerts[0]?.message).toContain(".eva/machines/laptop.json");
    expect(instance.status().problems).toHaveLength(1);
    // The hub's own report never carries the problems that it relays.
    expect(readReport("example-pc")).toMatchObject({ problems: [] });
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([]));
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["machine:laptop:vault_ahead", "warn"],
      ["machine:laptop:vault_ahead", "resolved"],
    ]);
    expect(alerts[1]?.message).toBe("On laptop: Fixed.");
  });

  test("the shell sandbox gap of another machine ends with no resolved alert: it may have become news (#825)", async () => {
    const wall = { key: "shell_wall", level: "warn", message: "No sandbox.", resolvedMessage: "Walled." };
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([wall]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([]));
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["machine:laptop:shell_wall", "warn"]]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a satellite's report marks a problem that the person hid there, and only that one (#541)", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("telegram", { level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." });
    instance.reportProblem("update", { level: "warn", message: "No update check.", resolvedMessage: "Ok." });
    instance.hideProblem("update");
    await instance.syncVault();
    expect(readReport("example-pc")).toEqual({
      machine: "example-pc",
      version: expect.any(String) as string,
      reportedAt: clock.toISOString(),
      problems: [
        { key: "telegram", level: "warn", message: "Telegram fails.", resolvedMessage: "Ok." },
        { key: "update", level: "warn", message: "No update check.", resolvedMessage: "Ok.", hidden: true },
      ],
    });
  });

  test("the hub hides a problem that another machine reports as hidden, so it sends no reminder", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([{ ...ahead, hidden: true }]));
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.hidden).toBe(true);
    setClock(new Date(clock.getTime() + 25 * 60 * 60_000));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
  });

  test("the hub says how old a report is once it is more than a day old (#542)", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(
      vault,
      ".eva/machines/laptop.json",
      JSON.stringify({ machine: "laptop", version: "0.1.0", reportedAt: clock.toISOString(), problems: [ahead] }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.message).not.toContain("last reported");
    setClock(new Date(clock.getTime() + 3 * 24 * 60 * 60_000));
    await instance.syncVault();
    expect(instance.status().problemDetails[0]?.message).toContain("laptop last reported 3 days ago.");
  });

  test("the hub sends no alert for a problem that another machine hid before the hub saw it", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([{ ...ahead, hidden: true }]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts).toEqual([]);
    expect(instance.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("a relayed problem that cleared while the hub was off loses its mark, so its next failure alerts", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const first = start(new FakeEngine(), { machineName: "example-pc" });
    await first.syncVault();
    expect(first.hideProblem("machine:laptop:vault_ahead")).toBe(true);
    first.stop();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([]));
    const second = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(second);
    await second.syncVault();
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    await second.syncVault();
    expect(alerts.map((alert) => alert.key)).toEqual(["machine:laptop:vault_ahead"]);
    expect(second.status().problemDetails[0]?.hidden).toBe(false);
  });

  test("a relayed problem that is still open keeps its mark across a hub restart", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const first = start(new FakeEngine(), { machineName: "example-pc" });
    await first.syncVault();
    first.hideProblem("machine:laptop:vault_ahead");
    first.stop();
    const second = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(second);
    await second.syncVault();
    expect(alerts).toEqual([]);
    expect(second.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("a deleted report, such as from a computer that is gone, resolves its alerts", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    rmSync(join(vault, ".eva", "machines", "laptop.json"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a satellite drops the schedule problems of its time as hub, because no firing clears them now", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportProblem("schedule:daily", {
      level: "error",
      message: "The schedule failed.",
      resolvedMessage: "Ok.",
    });
    await instance.syncVault();
    expect(readReport("example-pc")).toMatchObject({ problems: [] });
    expect(instance.status().problems).toEqual([]);
  });

  test("a broken report keeps its alerts until it reads again", async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    writeFileSync(join(vault, ".eva", "machines", "laptop.json"), "<<<<<<< ours\n");
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    expect(instance.status().problems).toHaveLength(1);
  });

  test('a hub that becomes a satellite drops what it relayed with no false "resolved" line', async () => {
    sandbox.write(vault, ".eva/hub.json", hubClaim("example-pc"));
    sandbox.write(vault, ".eva/machines/laptop.json", laptopReport([ahead]));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    await instance.syncVault();
    expect(alerts).toHaveLength(1);
    sandbox.write(vault, ".eva/hub.json", hubClaim("other-pc"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    expect(instance.status().problems).toEqual([]);
  });
});

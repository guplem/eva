/** Tests of what Eva checks in the vault at start: structure, migrations and secret files. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import type { StartMigrations } from "../../../src/core/migrations/migrations.ts";
import { newestStructureVersion } from "../../../src/core/vault/vault-structure.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Alert } from "../../../src/core/alerts/alert-center.ts";
import type { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { templateParts } from "../../../src/core/vault/vault-template.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { useEvaTestbed, home, sandbox, start, syncOff, vault, waitFor } from "../../support/eva-testbed.ts";

useEvaTestbed();

describe("vault structure (#773)", () => {
  const startMigrations: StartMigrations = { machine: { kind: "done", applied: [], later: [] }, vault: null };
  const structureWarnings = (instance: Eva): unknown[] =>
    instance.status().problemDetails.filter((problem) => problem.key === "vault_structure");

  test("the hub tells the person once for each version, and the first new chat gets the line once", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    expect(instance.vaultStructure()).toMatchObject({
      current: 2,
      available: newestStructureVersion,
      canUpgrade: true,
    });
    instance.reportStartMigrations(startMigrations);
    instance.reportStartMigrations(startMigrations);
    const news = alerts.filter((alert) => alert.key === "vault_structure");
    expect(news.map((alert) => alert.level)).toEqual(["warn"]);
    expect(news[0]?.message).toContain("Vault and sync, Vault structure");
    // A restart reads the hub's memory, so the alert does not come again; the warning stays (#801).
    const again = start(engine);
    const later: Alert[] = [];
    again.onAlert((alert) => {
      later.push(alert);
    });
    again.reportStartMigrations(startMigrations);
    expect(later.filter((alert) => alert.key === "vault_structure")).toEqual([]);
    expect(structureWarnings(again)).toHaveLength(1);
    const line = `[Vault structure: version ${String(newestStructureVersion)} is available. This vault is at version 2.`;
    const first = again.createAssistantSession({ source: "web" });
    await again.sessions.send(first.id, "Hello");
    const second = again.createAssistantSession({ source: "web" });
    await again.sessions.send(second.id, "Hello again");
    const prompts = engine.requests.map((request) => request.appendSystemPrompt ?? "");
    expect(prompts.filter((prompt) => prompt.includes(line))).toHaveLength(1);
  });

  test("a vault with the newest structure gets no alert, and the card says so", () => {
    sandbox.write(vault, ".eva/vault-structure.json", JSON.stringify({ version: newestStructureVersion }));
    const instance = start(new FakeEngine());
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    instance.reportStartMigrations(startMigrations);
    expect(alerts.filter((alert) => alert.key === "vault_structure")).toEqual([]);
    expect(instance.vaultStructure()).toMatchObject({ current: newestStructureVersion, summary: "" });
  });

  test("a read warning goes, and stays gone for that version after a restart (#801)", () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    instance.reportStartMigrations(startMigrations);
    expect(structureWarnings(instance)).toMatchObject([{ level: "warn", hidden: false }]);
    expect(instance.hideProblem("vault_structure")).toBe(true);
    expect(structureWarnings(instance)).toEqual([]);
    expect(instance.notifications().entries.filter((entry) => entry.key === "vault_structure")).toMatchObject([
      { level: "warn", read: true },
    ]);
    const again = start(engine);
    again.reportStartMigrations(startMigrations);
    expect(structureWarnings(again)).toEqual([]);
  });

  test("marking all as read reads the warning too (#801)", () => {
    const instance = start(new FakeEngine());
    instance.reportStartMigrations(startMigrations);
    instance.markNotificationsRead({ all: true });
    expect(structureWarnings(instance)).toEqual([]);
    const again = start(new FakeEngine());
    again.reportStartMigrations(startMigrations);
    expect(structureWarnings(again)).toEqual([]);
  });

  test("the warning clears when the vault reaches the newest structure, with no resolved alert (#801)", async () => {
    const instance = start(new FakeEngine());
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    instance.reportStartMigrations(startMigrations);
    // As `eva vault-upgrade finish` records it; a step that fails still looks again.
    sandbox.write(vault, ".eva/vault-structure.json", JSON.stringify({ version: newestStructureVersion }));
    await instance.upgradeVault("finish").catch(() => undefined);
    expect(structureWarnings(instance)).toEqual([]);
    expect(alerts.filter((alert) => alert.key === "vault_structure").map((alert) => alert.level)).toEqual(["warn"]);
    // An undo takes the vault back: the warning that was never read comes back, unsent.
    sandbox.write(vault, ".eva/vault-structure.json", JSON.stringify({ version: 2 }));
    await instance.upgradeVault("undo").catch(() => undefined);
    expect(structureWarnings(instance)).toHaveLength(1);
    expect(alerts.filter((alert) => alert.key === "vault_structure")).toHaveLength(1);
  });

  test("a hub that cannot record the alert still shows the warning, unsent (#801)", () => {
    // A folder in place of the state file makes each write fail.
    mkdirSync(homePaths(home).vaultStructureState, { recursive: true });
    const instance = start(new FakeEngine());
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    instance.reportStartMigrations(startMigrations);
    expect(alerts.filter((alert) => alert.key === "vault_structure")).toEqual([]);
    expect(structureWarnings(instance)).toHaveLength(1);
  });

  test("a satellite shows no warning (#801)", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    instance.reportStartMigrations(startMigrations);
    expect(instance.role()).toBe("satellite");
    expect(structureWarnings(instance)).toEqual([]);
  });
});

describe("migrations (#119)", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }
  const futureRecord = JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] });
  // A vault with the newest structure, so no vault structure alert mixes in.
  beforeEach(() => {
    sandbox.write(vault, ".eva/vault-structure.json", JSON.stringify({ version: newestStructureVersion }));
  });

  test("a vault that needs a newer Eva makes the update install at least that version, past the policy", async () => {
    sandbox.write(
      vault,
      ".eva/migrations.json",
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "0.3.0" }] }),
    );
    const releases = [
      { version: "1.0.0", notes: "" },
      { version: "0.3.0", notes: "" },
      { version: "0.2.1", notes: "" },
    ];
    const instance = start(
      new FakeEngine(),
      { updates: { ...defaultConfig.updates, install: "patch" } },
      {
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.2.0", latest: "1.0.0", available: true, releases }),
          apply: () => Promise.resolve({ current: "0.2.0", latest: "0.3.0", available: false, releases: [] }),
        },
      },
    );
    expect(await instance.checkForUpdate()).toMatchObject({ target: "0.3.0", heldBack: "1.0.0" });
  });

  test("a computer where the shell of a Project chat has no wall says so at start, with why (#711)", async () => {
    const instance = start(
      new FakeEngine(),
      {},
      {
        shellWallGap: () =>
          Promise.resolve({ reason: "The shell sandbox needs bubblewrap.", fixable: true, piOnly: false }),
      },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(alerts.find((alert) => alert.key === "shell_wall")).toMatchObject({ level: "warn" });
    expect(alerts.find((alert) => alert.key === "shell_wall")?.message).toContain("bubblewrap");
  });

  test("a computer with only pi checks the sandbox too, and the notice names pi chats (#759)", async () => {
    const engine = new FakeEngine();
    // Only the engine's name matters here: the start check runs for each engine with a Project shell.
    Object.defineProperty(engine, "name", { value: "pi" });
    const instance = start(
      engine,
      {},
      {
        shellWallGap: () =>
          Promise.resolve({ reason: "pi's shell sandbox needs ripgrep.", fixable: true, piOnly: true }),
      },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(alerts.find((alert) => alert.key === "shell_wall")?.message).toContain("The shell of a pi Project chat");
  });

  test("Eva's AppArmor profile, left over next to the system's own, is a problem of its own (#903)", async () => {
    const instance = start(
      new FakeEngine(),
      {},
      { shellWallGap: () => Promise.resolve(null), bwrapProfileLeft: () => true },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(alerts.find((alert) => alert.key === "bwrap_profile_left")).toMatchObject({ level: "warn" });
    // The wall works with either profile, so the shell gap stays closed.
    expect(instance.status().problemDetails.some((problem) => problem.key === "shell_wall")).toBe(false);
  });

  test("with no leftover AppArmor profile, Eva reports no such problem (#903)", async () => {
    const instance = start(
      new FakeEngine(),
      {},
      { shellWallGap: () => Promise.resolve(null), bwrapProfileLeft: () => false },
    );
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(instance.status().problemDetails.some((problem) => problem.key === "bwrap_profile_left")).toBe(false);
  });

  test("a gap that the person cannot fix, as on Windows, is news and not a problem that stays open (#825)", async () => {
    const instance = start(
      new FakeEngine(),
      {},
      {
        shellWallGap: () =>
          Promise.resolve({ reason: "Eva has no shell sandbox on Windows.", fixable: false, piOnly: false }),
      },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await Promise.resolve();
    expect(alerts.filter((alert) => alert.key === "shell_wall").map((alert) => alert.level)).toEqual(["news"]);
    expect(instance.status().problemDetails.some((problem) => problem.key === "shell_wall")).toBe(false);
  });

  test("at start, Eva syncs the vault in the Windows Search index, and warns when Windows Search hangs (#942)", async () => {
    const vaults: string[] = [];
    const instance = start(
      new FakeEngine(),
      {},
      {
        searchIndex: (vaultPath) => {
          vaults.push(vaultPath);
          return Promise.resolve({ kind: "timeout" });
        },
      },
    );
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vaults).toHaveLength(1);
    expect(alerts.find((alert) => alert.key === "windows_search")).toMatchObject({ level: "warn" });
  });

  test("a Windows Search sync that works, or a Windows Search that is off, is no problem (#942)", async () => {
    for (const result of [
      { kind: "synced", added: 2, removed: 0 },
      { kind: "unavailable", reason: "The service is off." },
    ] as const) {
      const instance = start(new FakeEngine(), {}, { searchIndex: () => Promise.resolve(result) });
      instance.reportStartMigrations({
        machine: { kind: "done", applied: [], later: [] },
        vault: { kind: "done", applied: [], later: [] },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(instance.status().problemDetails.some((problem) => problem.key === "windows_search")).toBe(false);
    }
  });

  test("a failed migration at start sends an alert with its id and the error", () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "failed", applied: [], id: "2026-10-20-example", reason: "disk is full" },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["migration_failed:machine", "error"]]);
    expect(alerts[0]?.message).toContain("2026-10-20-example");
    expect(alerts[0]?.message).toContain("disk is full");
  });

  test("after the vault migrations, the hub brings the template parts up to date", () => {
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(existsSync(join(vault, ".eva", "settings", "text-actions", "Polish.md"))).toBe(true);
    expect(instance.templateParts()?.parts.map((part) => [part.name, part.state])).toEqual([
      [".eva", "current"],
      ["Summary", "current"],
      ["Polish", "current"],
    ]);
    expect(instance.templateParts()?.canChoose).toBe(true);
    expect(alerts).toEqual([]);
  });

  test("a template part that the person changed waits for their choice, with an alert", () => {
    sandbox.write(vault, ".eva/settings/text-actions/Polish.md", "# My own text action\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["template_alignment", "warn"]]);
    expect(readFileSync(join(vault, ".eva", "settings", "text-actions", "Polish.md"), "utf-8")).toBe(
      "# My own text action\n",
    );
    const parts = instance.chooseTemplateVersion(".eva/settings/text-actions/Polish.md", "mine");
    expect(parts.find((part) => part.name === "Polish")?.state).toBe("kept");
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a satellite leaves the template parts alone", () => {
    const instance = start(new FakeEngine());
    instance.reportStartMigrations({ machine: { kind: "done", applied: [], later: [] }, vault: null });
    expect(existsSync(join(vault, ".eva", "settings", "text-actions", "Polish.md"))).toBe(false);
  });

  test("a satellite shows the template parts but leaves the choice to the hub", () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(vault, ".eva/settings/text-actions/Polish.md", "# My own text action\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    expect(instance.templateParts()?.canChoose).toBe(false);
    expect(() => instance.chooseTemplateVersion(".eva/settings/text-actions/Polish.md", "new")).toThrow("hub");
  });

  test("the alert of a part clears after a sync that brings the person's fix", async () => {
    sandbox.write(vault, ".eva/settings/text-actions/Polish.md", "# My own text action\n");
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    expect(alerts.map((alert) => alert.level)).toEqual(["warn"]);
    sandbox.write(
      vault,
      ".eva/settings/text-actions/Polish.md",
      templateParts[".eva/settings/text-actions/Polish.md"] ?? "",
    );
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("only the hub sends the alerts to the devices, as only the hub runs Telegram", async () => {
    const pushed: string[] = [];
    const pushSender = (request: { endpoint: string }): Promise<number> => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    };
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "k", auth: "a" } };
    const hub = start(new FakeEngine(), { machineName: "example-pc" }, { pushSender });
    hub.subscribePush(subscription, "Phone", null);
    hub.reportProblem("example", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toHaveLength(1);

    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const satellite = start(new FakeEngine(), { machineName: "example-pc" }, { pushSender });
    satellite.reportProblem("other", { level: "warn", message: "Broke.", resolvedMessage: "Fixed." });
    await Bun.sleep(10);
    expect(pushed).toHaveLength(1);
    expect(satellite.pushKey().isHub).toBe(false);
  });

  test("a finished turn goes to each device that picked replies and shows no page of the chat, also on a satellite", async () => {
    const pushed: string[] = [];
    const pushSender = (request: { endpoint: string }): Promise<number> => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    };
    const phone = { endpoint: "https://fcm.googleapis.com/fcm/send/phone", keys: { p256dh: "k", auth: "a" } };
    const laptop = { endpoint: "https://fcm.googleapis.com/fcm/send/laptop", keys: { p256dh: "k", auth: "a" } };
    const desk = { endpoint: "https://fcm.googleapis.com/fcm/send/desk", keys: { p256dh: "k", auth: "a" } };
    const tablet = { endpoint: "https://fcm.googleapis.com/fcm/send/tablet", keys: { p256dh: "k", auth: "a" } };
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    const instance = start(
      new FakeEngine((request) => FakeEngine.answer(request, "The report is ready.")),
      { machineName: "example-pc", sync: syncOff },
      { pushSender },
    );
    instance.subscribePush(phone, "Phone", null);
    instance.subscribePush(laptop, "Laptop", null);
    instance.subscribePush(desk, "Desk", null);
    instance.subscribePush(tablet, "Tablet", null);
    instance.setPushKinds(laptop.endpoint, ["alerts"]);
    const session = instance.createAssistantSession({ source: "web", title: "Weekly report" });
    instance.markPushInView(desk.endpoint, "desk-tab", true, [session.id]);
    // A page in view on another chat still gets the answer of this one (#614).
    instance.markPushInView(tablet.endpoint, "tablet-tab", true, ["other-chat"]);
    await instance.sessions.send(session.id, "Write the report.", "api");
    await Bun.sleep(10);
    expect(pushed).toEqual([phone.endpoint, tablet.endpoint]);
    expect(instance.recentNotifications(laptop.endpoint)).toEqual([]);
    expect(instance.recentNotifications(phone.endpoint)).toMatchObject([
      {
        key: `chat:${session.id}`,
        title: "Weekly report",
        message: "The report is ready.",
        url: `/#/chat/${session.id}`,
      },
    ]);
  });

  test("a finished turn goes to no device while the person reads its chat on any device (#1136)", async () => {
    const pushed: string[] = [];
    const pushSender = (request: { endpoint: string }): Promise<number> => {
      pushed.push(request.endpoint);
      return Promise.resolve(201);
    };
    const phone = { endpoint: "https://fcm.googleapis.com/fcm/send/phone", keys: { p256dh: "k", auth: "a" } };
    const instance = start(
      new FakeEngine((request) => FakeEngine.answer(request, "The report is ready.")),
      { machineName: "example-pc", sync: syncOff },
      { pushSender },
    );
    instance.subscribePush(phone, "Phone", null);
    const session = instance.createAssistantSession({ source: "web", title: "Weekly report" });
    // The computer gets no notifications, so its page claims with no push address.
    instance.markPushInView(null, "desk-tab", true, [session.id], true);
    await instance.sessions.send(session.id, "Write the report.", "api");
    await Bun.sleep(10);
    expect(pushed).toEqual([]);
    // The person left the computer: the page is still in front, but nobody reads it.
    instance.markPushInView(null, "desk-tab", true, [session.id], false);
    await instance.sessions.send(session.id, "Write it again.", "api");
    await Bun.sleep(10);
    expect(pushed).toEqual([phone.endpoint]);
  });

  test("a removed device login loses its notifications", () => {
    const instance = start(new FakeEngine());
    instance.deviceLogins.attachApprover({ name: "Test", canApprove: () => true, ask: () => undefined });
    const request = instance.deviceLogins.request("owner", "Phone");
    instance.deviceLogins.answer(request.id, "allow");
    const state = instance.deviceLogins.check(request.id, "owner");
    const token = state.state === "allowed" ? state.token : "";
    instance.subscribePush(
      { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "k", auth: "a" } },
      "Phone",
      token,
    );
    instance.deviceLogins.forget(token);
    expect(instance.pushDevices()).toEqual([]);
  });

  test("a machine record from a newer Eva sends an alert, and a satellite reports no vault run", () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "ahead", unknown: ["2099-01-01-from-the-future"] },
      vault: null,
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["machine_ahead", "warn"]]);
  });

  test("a vault that a newer Eva migrated raises one alert with the computer and the versions, until it clears", async () => {
    sandbox.write(vault, ".eva/migrations.json", futureRecord);
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    const alerts = collectAlerts(instance);
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "ahead", unknown: ["2099-01-01-from-the-future"] },
    });
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["vault_ahead", "warn"]]);
    expect(alerts[0]?.message).toContain("example-pc");
    expect(alerts[0]?.message).toContain("9.0.0");
    expect(instance.status().problems).toEqual([alerts[0]?.message ?? ""]);
    await instance.syncVault();
    expect(alerts).toHaveLength(1);
    rmSync(join(vault, ".eva", "migrations.json"));
    await instance.syncVault();
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
  });

  test("a machine that becomes the hub runs the vault migrations", async () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(
      vault,
      ".eva/settings.json",
      JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] } }),
    );
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    expect(instance.role()).toBe("satellite");
    await instance.becomeHub();
    expect(instance.role()).toBe("hub");
    expect(JSON.parse(readFileSync(join(vault, ".eva", "settings", "settings.json"), "utf-8"))).toEqual({});
    expect(existsSync(join(vault, ".eva", "settings.json"))).toBe(false);
    expect(existsSync(join(vault, ".eva", "migrations.json"))).toBe(true);
    expect(existsSync(join(vault, ".eva", "settings", "text-actions", "Polish.md"))).toBe(true);
  });

  test("a machine that is behind the vault cannot become the hub", async () => {
    sandbox.write(vault, ".eva/hub.json", JSON.stringify({ machine: "other-pc", since: "" }));
    sandbox.write(vault, ".eva/migrations.json", futureRecord);
    const instance = start(new FakeEngine(), { machineName: "example-pc" });
    let caught: unknown = null;
    try {
      await instance.becomeHub();
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toContain("9.0.0");
    expect(instance.role()).toBe("satellite");
  });
});

describe("the vault's secret files at start (#707)", () => {
  test("a secret file that a commit holds in plain text is encrypted at start, such as after an update", async () => {
    sandbox.write(vault, "deploy/id.key", "PRIVATE\n");
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "before the update");
    const instance = start(new FakeEngine());
    instance.reportStartMigrations({
      machine: { kind: "done", applied: [], later: [] },
      vault: { kind: "done", applied: [], later: [] },
    });
    await waitFor(() => readFileSync(join(vault, "deploy/id.key"), "utf8").startsWith("Encrypted by Eva."));
  });
});

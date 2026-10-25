import { describe, expect, test } from "bun:test";
import {
  AlertCenter,
  type Alert,
  type AlertProblem,
  type HiddenProblems,
} from "../../../../src/core/alerts/alert-center.ts";
import type { NotificationHistory } from "../../../../src/core/alerts/notification-history.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { Redactor } from "../../../../src/shared/redaction.ts";

const hourMs = 60 * 60_000;
const offline: AlertProblem = {
  level: "warn",
  message: "The vault cannot reach its remote.",
  resolvedMessage: "The vault reaches its remote again.",
};

interface Harness {
  readonly center: AlertCenter;
  readonly alerts: Alert[];
  readonly logs: string[];
  /** Each set of hidden marks that the center asked to save. */
  readonly saved: HiddenProblems[];
  advanceHours(hours: number): void;
}

function harness(redactor?: Redactor, hidden?: HiddenProblems): Harness {
  let now = new Date("2026-10-17T10:00:00Z");
  const alerts: Alert[] = [];
  const logs: string[] = [];
  const saved: HiddenProblems[] = [];
  const center = new AlertCenter({
    now: () => now,
    logger: { log: (level: LogLevel, message: string) => logs.push(`${level}: ${message}`) },
    ...(redactor === undefined ? {} : { redactor }),
    ...(hidden === undefined ? {} : { hidden }),
    onHiddenChange: (marks) => saved.push(marks),
  });
  center.onAlert((alert) => {
    alerts.push(alert);
  });
  return {
    center,
    alerts,
    logs,
    saved,
    advanceHours: (hours) => {
      now = new Date(now.getTime() + hours * hourMs);
    },
  };
}

describe("AlertCenter", () => {
  test("sends an alert when a problem starts, and keeps it as an open problem", () => {
    const run = harness();
    run.center.report("vault_sync", offline);
    expect(run.alerts).toEqual([
      { key: "vault_sync", level: "warn", message: offline.message, at: "2026-10-17T10:00:00.000Z" },
    ]);
    expect(run.center.openProblems()).toEqual([offline.message]);
  });

  test("sends a problem that lasts at most once in 24 hours", () => {
    const run = harness();
    run.center.report("vault_sync", offline);
    run.advanceHours(23);
    run.center.report("vault_sync", offline);
    expect(run.alerts).toHaveLength(1);
    run.advanceHours(1);
    run.center.report("vault_sync", offline);
    expect(run.alerts).toHaveLength(2);
  });

  test("keeps the newest message of an open problem without a second alert", () => {
    const run = harness();
    run.center.report("vault_sync", offline);
    run.center.report("vault_sync", { ...offline, message: "The vault sync stopped on a conflict." });
    expect(run.alerts).toHaveLength(1);
    expect(run.center.openProblems()).toEqual(["The vault sync stopped on a conflict."]);
  });

  test("sends one resolved alert when the problem clears, and nothing when no problem was open", () => {
    const run = harness();
    run.center.report("vault_sync", null);
    run.center.report("vault_sync", offline);
    run.center.report("vault_sync", null);
    run.center.report("vault_sync", null);
    expect(run.alerts.map((alert) => [alert.level, alert.message])).toEqual([
      ["warn", offline.message],
      ["resolved", offline.resolvedMessage],
    ]);
    expect(run.center.openProblems()).toEqual([]);
  });

  test("a problem that starts again after it cleared sends a new alert at once", () => {
    const run = harness();
    run.center.report("vault_sync", offline);
    run.center.report("vault_sync", null);
    run.center.report("vault_sync", offline);
    expect(run.alerts.map((alert) => alert.level)).toEqual(["warn", "resolved", "warn"]);
  });

  test("a notice is sent once and never stays open", () => {
    const run = harness();
    run.center.notify("unclean_exit", "warn", "Eva restarted after an unclean exit.");
    expect(run.alerts).toHaveLength(1);
    expect(run.center.openProblems()).toEqual([]);
  });

  test("every alert goes to the log at its level; a resolved alert is info", () => {
    const run = harness();
    run.center.report("update", { ...offline, level: "error" });
    run.center.report("update", null);
    expect(run.logs).toEqual([`error: ${offline.message}`, `info: ${offline.resolvedMessage}`]);
  });

  test("redacts each message (lesson 95)", () => {
    const redactor = new Redactor();
    redactor.addSecret("secret-value-for-tests");
    const run = harness(redactor);
    run.center.report("vault_sync", { ...offline, message: "git said secret-value-for-tests" });
    expect(run.alerts[0]?.message).toBe("git said [redacted]");
    expect(run.center.openProblems()).toEqual(["git said [redacted]"]);
  });

  test("a dismissed problem leaves no resolved alert, and a later report is new", () => {
    const run = harness();
    run.center.report("update", offline);
    run.center.dismiss("update");
    expect(run.center.openProblems()).toEqual([]);
    run.center.report("update", null);
    run.center.report("update", offline);
    expect(run.alerts.map((alert) => alert.level)).toEqual(["warn", "warn"]);
  });

  test("lists each open problem with its key, both lines redacted, for the machine report", () => {
    const redactor = new Redactor();
    redactor.addSecret("secret-value-for-tests");
    const run = harness(redactor);
    run.center.report("update", { ...offline, resolvedMessage: "secret-value-for-tests works" });
    run.center.report("vault_ahead", { ...offline, level: "error" });
    run.center.report("vault_ahead", null);
    expect(run.center.openAlerts()).toEqual([
      { key: "update", level: "warn", message: offline.message, resolvedMessage: "[redacted] works" },
    ]);
  });

  test("a listener that throws or rejects never stops the others or the caller", async () => {
    const run = harness();
    run.center.onAlert(() => {
      throw new Error("listener broke");
    });
    run.center.onAlert(() => Promise.reject(new Error("listener rejected")));
    const late: Alert[] = [];
    run.center.onAlert((alert) => {
      late.push(alert);
    });
    expect(() => {
      run.center.report("vault_sync", offline);
    }).not.toThrow();
    await Bun.sleep(0);
    expect(late).toHaveLength(1);
    expect(run.logs.filter((line) => line.includes("An alert listener failed."))).toHaveLength(2);
  });

  test("an unsubscribed listener gets no more alerts", () => {
    const run = harness();
    const received: Alert[] = [];
    const unsubscribe = run.center.onAlert((alert) => {
      received.push(alert);
    });
    unsubscribe();
    run.center.report("vault_sync", offline);
    expect(received).toEqual([]);
  });
});

describe("AlertCenter hidden problems (#541)", () => {
  test("a hidden problem stays open and listed, marked as hidden, and its mark is saved", () => {
    const run = harness();
    run.center.report("update", offline);
    expect(run.center.hide("update")).toBe(true);
    expect(run.center.openProblems()).toEqual([offline.message]);
    expect(run.center.problemDetails()).toEqual([
      { key: "update", level: "warn", message: offline.message, hidden: true, since: "2026-10-17T10:00:00.000Z" },
    ]);
    expect(run.saved).toEqual([{ update: "warn" }]);
  });

  test("only an open problem can be hidden", () => {
    const run = harness();
    expect(run.center.hide("update")).toBe(false);
    expect(run.saved).toEqual([]);
  });

  test("a hidden problem sends no reminder after 24 hours, even with a new reason", () => {
    const run = harness();
    run.center.report("update", offline);
    run.center.hide("update");
    run.advanceHours(25);
    run.center.report("update", { ...offline, message: "The vault cannot reach its remote: DNS failed." });
    expect(run.alerts).toHaveLength(1);
    expect(run.center.problemDetails()[0]?.hidden).toBe(true);
  });

  test("a problem that rises from warn to error shows again and sends an alert at once", () => {
    const run = harness();
    run.center.report("update", offline);
    run.center.hide("update");
    run.center.report("update", { ...offline, level: "error" });
    expect(run.alerts.map((alert) => alert.level)).toEqual(["warn", "error"]);
    expect(run.center.problemDetails()[0]?.hidden).toBe(false);
    expect(run.saved.at(-1)).toEqual({});
  });

  test("a problem that clears forgets its mark, so it shows again when it starts again", () => {
    const run = harness();
    run.center.report("update", offline);
    run.center.hide("update");
    run.center.report("update", null);
    run.center.report("update", offline);
    expect(run.alerts.map((alert) => alert.level)).toEqual(["warn", "resolved", "warn"]);
    expect(run.center.problemDetails()[0]?.hidden).toBe(false);
    expect(run.saved.at(-1)).toEqual({});
  });

  test("after a restart, a saved mark keeps the problem hidden and quiet", () => {
    const run = harness(undefined, { update: "warn" });
    run.center.report("update", offline);
    expect(run.alerts).toEqual([]);
    expect(run.center.problemDetails()[0]?.hidden).toBe(true);
  });

  test("a saved mark of a problem that is gone is forgotten at its first report", () => {
    const run = harness(undefined, { update: "warn" });
    run.center.report("update", null);
    expect(run.saved).toEqual([{}]);
  });

  test("a dismissed problem forgets its mark", () => {
    const run = harness();
    run.center.report("update", offline);
    run.center.hide("update");
    run.center.dismiss("update");
    expect(run.saved.at(-1)).toEqual({});
  });
});

describe("AlertCenter saved marks after a start (#541)", () => {
  test("forgets the saved marks that apply and whose problems are not open, and keeps the others", () => {
    const run = harness(undefined, {
      "machine:pc:update": "warn",
      "machine:laptop:update": "warn",
      "engine_login:pi": "error",
    });
    run.center.report("machine:pc:update", offline);
    run.center.forgetHiddenUnlessOpen((key) => key.startsWith("machine:"));
    expect(run.saved).toEqual([{ "machine:pc:update": "warn", "engine_login:pi": "error" }]);
    run.center.report("machine:laptop:update", offline);
    expect(run.alerts.map((alert) => alert.key)).toEqual(["machine:laptop:update"]);
  });

  test("saves nothing when every mark is open", () => {
    const run = harness(undefined, { update: "warn" });
    run.center.report("update", offline);
    run.center.forgetHiddenUnlessOpen(() => true);
    expect(run.saved).toEqual([]);
  });
});

test("hiding a hidden problem again saves nothing, as the hub does at each sync", () => {
  const run = harness();
  run.center.report("update", offline);
  run.center.hide("update");
  run.center.hide("update");
  expect(run.saved).toHaveLength(1);
  expect(run.center.isHidden("update")).toBe(true);
});

describe("AlertCenter history (#566)", () => {
  interface HistoryRun {
    readonly center: AlertCenter;
    readonly written: NotificationHistory[];
    advanceHours(hours: number): void;
  }

  function historyRun(history?: NotificationHistory, hidden?: HiddenProblems): HistoryRun {
    let now = new Date("2026-10-17T10:00:00Z");
    const written: NotificationHistory[] = [];
    const center = new AlertCenter({
      now: () => now,
      ...(history === undefined ? {} : { history }),
      ...(hidden === undefined ? {} : { hidden }),
      onHistoryChange: (changed) => written.push(changed),
    });
    return {
      center,
      written,
      advanceHours: (hours) => {
        now = new Date(now.getTime() + hours * hourMs);
      },
    };
  }

  const levels = (center: AlertCenter): string[] =>
    center.historyEntries().map((entry) => `${entry.key}:${entry.level}`);

  test("records a start, a rise, a resolved problem and news, but not a reminder", () => {
    const run = historyRun();
    run.center.report("vault_sync", offline);
    run.advanceHours(25);
    run.center.report("vault_sync", offline);
    run.advanceHours(25);
    run.center.report("vault_sync", { ...offline, level: "error" });
    run.center.report("vault_sync", null);
    run.center.notify("update_held_back", "news", "Eva 4.0.0 waits for you.");
    expect(levels(run.center)).toEqual([
      "vault_sync:warn",
      "vault_sync:error",
      "vault_sync:resolved",
      "update_held_back:news",
    ]);
    expect(run.written.at(-1)?.entries).toHaveLength(4);
    expect(run.center.historyEntries().map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
  });

  test("records the redacted text only", () => {
    const redactor = new Redactor();
    redactor.addSecret("secret-value-for-tests");
    const center = new AlertCenter({ now: () => new Date("2026-10-17T10:00:00Z"), redactor });
    center.notify("x", "news", "The token secret-value-for-tests expired.");
    expect(center.historyEntries()[0]?.message).toBe("The token [redacted] expired.");
  });

  test("an open problem keeps the time it started, across reports and a restart", () => {
    const run = historyRun();
    run.center.report("update", offline);
    run.advanceHours(30);
    run.center.report("update", offline);
    expect(run.center.problemDetails()[0]?.since).toBe("2026-10-17T10:00:00.000Z");

    const restarted = historyRun(run.written.at(-1));
    restarted.advanceHours(50);
    restarted.center.report("update", offline);
    expect(restarted.center.problemDetails()[0]?.since).toBe("2026-10-17T10:00:00.000Z");
    expect(levels(restarted.center)).toEqual(["update:warn"]);
  });

  test("a hidden problem after a restart takes its start from the history, and records nothing", () => {
    const first = historyRun();
    first.center.report("update", offline);
    const restarted = historyRun(first.written.at(-1), { update: "warn" });
    restarted.advanceHours(5);
    restarted.center.report("update", offline);
    expect(restarted.center.problemDetails()[0]?.since).toBe("2026-10-17T10:00:00.000Z");
    expect(restarted.center.historyEntries()).toHaveLength(1);
  });

  test("hiding a problem also marks its entries as read", () => {
    const run = historyRun();
    run.center.report("update", offline);
    run.center.notify("news", "news", "Eva updated.");
    run.center.hide("update");
    expect(run.center.historyEntries().map((entry) => entry.read)).toEqual([true, false]);
  });

  test("marks chosen entries as read, and saves nothing when nothing changes", () => {
    const run = historyRun();
    run.center.notify("a", "news", "A.");
    run.center.notify("b", "news", "B.");
    const writes = run.written.length;
    run.center.markRead([1]);
    run.center.markRead([1, 99]);
    expect(run.center.historyEntries().map((entry) => entry.read)).toEqual([true, false]);
    expect(run.written).toHaveLength(writes + 1);
  });

  test("marks every entry as read and hides every open problem", () => {
    const run = historyRun();
    run.center.report("update", offline);
    run.center.report("vault_sync", { ...offline, level: "error" });
    run.center.notify("news", "news", "Eva updated.");
    run.center.markAllRead();
    expect(run.center.historyEntries().every((entry) => entry.read)).toBe(true);
    expect(run.center.problemDetails().every((problem) => problem.hidden)).toBe(true);
  });
});

describe("AlertCenter history edge cases (#566)", () => {
  function run(): { center: AlertCenter; alerts: Alert[]; advanceHours: (hours: number) => void } {
    let now = new Date("2026-10-17T10:00:00Z");
    const alerts: Alert[] = [];
    const center = new AlertCenter({ now: () => now });
    center.onAlert((alert) => {
      alerts.push(alert);
    });
    return {
      center,
      alerts,
      advanceHours: (hours) => {
        now = new Date(now.getTime() + hours * hourMs);
      },
    };
  }
  const levels = (center: AlertCenter): string[] =>
    center.historyEntries().map((entry) => `${entry.key}:${entry.level}`);

  test("a one-off alert is recorded each time, even with the same key and level", () => {
    const { center } = run();
    center.notify("unclean_exit", "warn", "Eva stopped without a clean exit.");
    center.notify("unclean_exit", "warn", "Eva stopped without a clean exit.");
    expect(levels(center)).toEqual(["unclean_exit:warn", "unclean_exit:warn"]);
  });

  test("a rise within 24 hours is recorded, though it sends no alert", () => {
    const { center, alerts } = run();
    center.report("update", offline);
    center.report("update", { ...offline, level: "error" });
    expect(alerts).toHaveLength(1);
    expect(levels(center)).toEqual(["update:warn", "update:error"]);
  });

  test("a drop from error to warn adds no entry: only a start or a rise does", () => {
    const { center } = run();
    center.report("vault_sync", { ...offline, level: "error" });
    center.report("vault_sync", offline);
    center.report("vault_sync", { ...offline, level: "error" });
    expect(levels(center)).toEqual(["vault_sync:error"]);
  });

  test("a problem that ends and starts again is a new entry, with a new start time", () => {
    const { center, advanceHours } = run();
    center.report("update", offline);
    center.report("update", null);
    advanceHours(5);
    center.report("update", offline);
    expect(levels(center)).toEqual(["update:warn", "update:resolved", "update:warn"]);
    expect(center.problemDetails()[0]?.since).toBe("2026-10-17T15:00:00.000Z");
  });

  test("a dismissed problem that starts again is a new entry, with a new start time", () => {
    const { center, advanceHours } = run();
    center.report("machine:laptop:update", offline);
    center.dismiss("machine:laptop:update");
    advanceHours(5);
    center.report("machine:laptop:update", offline);
    expect(levels(center)).toEqual(["machine:laptop:update:warn", "machine:laptop:update:warn"]);
    expect(center.problemDetails()[0]?.since).toBe("2026-10-17T15:00:00.000Z");
  });
});

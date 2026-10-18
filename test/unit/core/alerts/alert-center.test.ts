import { describe, expect, test } from "bun:test";
import { AlertCenter, type Alert, type AlertProblem } from "../../../../src/core/alerts/alert-center.ts";
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
  advanceHours(hours: number): void;
}

function harness(redactor?: Redactor): Harness {
  let now = new Date("2026-10-17T10:00:00Z");
  const alerts: Alert[] = [];
  const logs: string[] = [];
  const center = new AlertCenter({
    now: () => now,
    logger: { log: (level: LogLevel, message: string) => logs.push(`${level}: ${message}`) },
    ...(redactor === undefined ? {} : { redactor }),
  });
  center.onAlert((alert) => {
    alerts.push(alert);
  });
  return {
    center,
    alerts,
    logs,
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

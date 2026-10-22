/** Tests for the small branches that the larger suites do not reach on every platform. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../src/core/settings/home.ts";
import { isProcessAlive } from "../../src/core/instance/instance-lock.ts";
import { abortControllerFor } from "../../src/engines/claude-code/claude-code-adapter.ts";
import { describeEvent } from "../../src/frontends/cli/chat.ts";
import { SequenceCounter, systemClock } from "../../src/shared/clock.ts";
import type { SessionEvent } from "../../src/shared/events.ts";
import { signalGroup, stopSteps } from "../../src/shared/process-runner.ts";
import { FakeEngine } from "../support/fake-engine.ts";

describe("stopSteps (lesson 81)", () => {
  test("Windows stops the whole tree with taskkill", () => {
    expect(stopSteps("win32", 42)).toEqual([{ kind: "command", command: ["taskkill", "/T", "/F", "/PID", "42"] }]);
  });

  test("Linux stops the group gently, then hard after a grace period", () => {
    expect(stopSteps("linux", 42)).toEqual([
      { kind: "signal-group", signal: "SIGTERM", afterMs: 0 },
      { kind: "signal-group", signal: "SIGKILL", afterMs: 2_000 },
    ]);
  });

  test("a signal to a group that does not exist reports false", () => {
    expect(signalGroup(2_147_483_000, "SIGTERM")).toBe(false);
  });
});

describe("isProcessAlive", () => {
  test("is true for this process and false for a pid that cannot exist", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_000)).toBe(false);
  });
});

describe("clock", () => {
  test("the system clock and the counter work on their own", () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
    const counter = new SequenceCounter();
    counter.next();
    expect(counter.next()).toBe(2);
  });
});

describe("abortControllerFor", () => {
  test("follows a signal that aborts later, and one that is already aborted", () => {
    const later = new AbortController();
    const linked = abortControllerFor(later.signal);
    expect(linked.signal.aborted).toBe(false);
    later.abort();
    expect(linked.signal.aborted).toBe(true);

    const done = new AbortController();
    done.abort();
    expect(abortControllerFor(done.signal).signal.aborted).toBe(true);
  });
});

describe("describeEvent", () => {
  const base = { sessionId: "s", seq: 1, at: "2026-10-14T00:00:00Z" };
  test("gives each event kind its terminal line", () => {
    const events: SessionEvent[] = [
      { ...base, kind: "text", text: "Hi", messageId: "m" },
      { ...base, kind: "tool_started", toolUseId: "t", name: "Read", category: "tool", summary: "Read a.md" },
      { ...base, kind: "task_changed", taskId: "k", description: "search", state: "running" },
      { ...base, kind: "approval_needed", requestId: "r", toolName: "Bash", summary: "git push" },
      { ...base, kind: "notice", text: "saved" },
      { ...base, kind: "history_lost" },
      { ...base, kind: "usage_limit", status: "rejected", window: "five_hour", usedPercent: 100, resetsAt: null },
      { ...base, kind: "turn_failed", reason: "boom" },
      { ...base, kind: "tool_finished", toolUseId: "t", isError: false },
      { ...base, kind: "approval_resolved", requestId: "r", answer: "allow", timedOut: false },
      { ...base, kind: "session_renamed", title: "Trip plans" },
      {
        ...base,
        kind: "turn_finished",
        engineSessionId: "e",
        lastMessageId: null,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
        contextTokens: null,
        contextWindow: null,
      },
      { ...base, kind: "message_received", text: "Hi", origin: "api" },
      { ...base, kind: "session_deleted" },
      { ...base, kind: "project_work_started", projectId: "p", projectSessionId: "q", request: "r" },
      { ...base, kind: "session_seen", seenTurns: 1 },
      { ...base, kind: "session_archived", archived: true },
    ];
    expect(events.map(describeEvent)).toEqual([
      "Hi\n",
      "  · Read a.md\n",
      "  · task running: search\n",
      "  ! Eva wants to run Bash: git push\n",
      "  (saved)\n",
      "  (The earlier history of this chat is lost.)\n",
      "  (You reached your 5-hour usage limit.)\n",
      "  The turn failed: boom\n",
      null,
      null,
      null,
      null,
      null,
      "  (This chat was deleted elsewhere.)\n",
      null,
      null,
      null,
    ]);
  });
});

describe("Eva background work", () => {
  test("the idle sweep timer starts once and stops", () => {
    const home = mkdtempSync(join(tmpdir(), "eva-timer-"));
    const eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) },
      processEnvironment: {},
      now: () => new Date(),
      basePrompt: "Base.",
    });
    eva.startBackgroundWork();
    eva.startBackgroundWork();
    eva.stop();
    eva.stop();
    rmSync(home, { recursive: true, force: true });
  });
});

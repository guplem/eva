import { describe, expect, test } from "bun:test";
import {
  claudeLoginExpired,
  isOtherMachineProblem,
  problemAction,
} from "../../../../../src/frontends/web/client/problem-actions.ts";

describe("problemAction", () => {
  test("a vault conflict opens the note picker", () => {
    expect(problemAction("vault_sync", "conflict")).toBe("pick_version");
  });

  test("another sync problem opens Settings, where Sync now is", () => {
    expect(problemAction("vault_sync", "offline")).toBe("open_settings");
  });

  test("a template part that differs opens its card", () => {
    expect(problemAction("template_alignment", "ok")).toBe("choose_template_version");
    expect(problemAction("template_alignment", "ok", "settings")).toBeNull();
  });

  test("a schedule problem opens the schedules", () => {
    expect(problemAction("schedule:lunch", "ok")).toBe("open_schedules");
    expect(problemAction("schedule_card:lunch", "ok")).toBe("open_schedules");
  });

  test("a problem of another machine has no button here: that machine fixes it", () => {
    expect(problemAction("machine:example-pc:update", "ok")).toBeNull();
    expect(isOtherMachineProblem("machine:example-pc:update")).toBe(true);
    expect(isOtherMachineProblem("update")).toBe(false);
  });

  test("no button leads to the page that is open: the fix is already there", () => {
    expect(problemAction("update", "ok", "settings")).toBeNull();
    expect(problemAction("vault_sync", "conflict", "settings")).toBeNull();
    expect(problemAction("schedule:lunch", "ok", "settings")).toBe("open_schedules");
    expect(problemAction("schedule:lunch", "ok", "schedules")).toBeNull();
    expect(problemAction("update", "ok", "schedules")).toBe("open_settings");
  });

  test("an expired Claude Code login opens its card, where the person logs in again", () => {
    expect(problemAction("engine_login:claude-code", "ok")).toBe("open_claude_login");
    expect(problemAction("engine_login:claude-code", "ok", "settings")).toBeNull();
  });

  test("every other problem opens Settings", () => {
    expect(problemAction("update", "ok")).toBe("open_settings");
    expect(problemAction("telegram_poll", "ok")).toBe("open_settings");
  });
});

describe("claudeLoginExpired", () => {
  test("is true only while the Claude Code login problem is open", () => {
    expect(claudeLoginExpired([{ key: "update" }, { key: "engine_login:claude-code" }])).toBe(true);
    expect(
      claudeLoginExpired([{ key: "engine_login:pi" }, { key: "machine:example-pc:engine_login:claude-code" }]),
    ).toBe(false);
  });
});

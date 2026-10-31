import { describe, expect, test } from "bun:test";
import {
  claudeLoginExpired,
  isOtherMachineProblem,
  problemAction,
  shownProblems,
  withPendingHides,
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

  test("a widget update that waits opens the widget list, where the person answers it", () => {
    expect(problemAction("widget_update:example-owner/habits:0123456789ab", "ok")).toBe("review_widget_update");
  });

  test("an expired Claude Code login opens its card, where the person logs in again", () => {
    expect(problemAction("engine_login:claude-code", "ok")).toBe("open_claude_login");
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

describe("shownProblems", () => {
  test("leaves out a problem that the person hid, and keeps one from an older Eva with no mark (#541)", () => {
    const problems: { key: string; level: string; message: string; hidden?: boolean }[] = [
      { key: "update", level: "warn", message: "Hidden.", hidden: true },
      { key: "vault_sync", level: "error", message: "Shown.", hidden: false },
      { key: "telegram_poll", level: "warn", message: "Older Eva." },
    ];
    expect(shownProblems(problems).map((problem) => problem.key)).toEqual(["vault_sync", "telegram_poll"]);
  });
});

describe("withPendingHides", () => {
  test("marks a problem whose hide Eva has not answered yet, and leaves the others", () => {
    const problems = [
      { key: "update", hidden: false },
      { key: "vault_sync", hidden: false },
    ];
    expect(withPendingHides(problems, new Set(["update"]))).toEqual([
      { key: "update", hidden: true },
      { key: "vault_sync", hidden: false },
    ]);
  });
});

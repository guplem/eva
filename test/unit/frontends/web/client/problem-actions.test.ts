import { describe, expect, test } from "bun:test";
import { isOtherMachineProblem, problemAction } from "../../../../../src/frontends/web/client/problem-actions.ts";

describe("problemAction", () => {
  test("a vault conflict opens the note picker", () => {
    expect(problemAction("vault_sync", "conflict")).toBe("pick_version");
  });

  test("another sync problem opens Settings, where Sync now is", () => {
    expect(problemAction("vault_sync", "offline")).toBe("open_settings");
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

  test("on the Settings page, no button leads to Settings: the fix is already on the page", () => {
    expect(problemAction("update", "ok", { onSettings: true })).toBeNull();
    expect(problemAction("vault_sync", "conflict", { onSettings: true })).toBeNull();
    expect(problemAction("schedule:lunch", "ok", { onSettings: true })).toBe("open_schedules");
  });

  test("every other problem opens Settings", () => {
    expect(problemAction("update", "ok")).toBe("open_settings");
    expect(problemAction("telegram_poll", "ok")).toBe("open_settings");
  });
});

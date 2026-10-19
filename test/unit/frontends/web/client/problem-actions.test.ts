import { describe, expect, test } from "bun:test";
import { problemAction } from "../../../../../src/frontends/web/client/problem-actions.ts";

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
  });

  test("every other problem opens Settings", () => {
    expect(problemAction("update", "ok")).toBe("open_settings");
    expect(problemAction("telegram_poll", "ok")).toBe("open_settings");
  });
});

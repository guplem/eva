import { describe, expect, test } from "bun:test";
import {
  claudeLoginExpired,
  closedEntryAction,
  isOtherMachineProblem,
  problemAction,
  problemSettingsRoute,
  shownProblems,
  withPendingHides,
} from "../../../../../src/frontends/web/client/problem-actions.ts";
import {
  searchEntries,
  settingsHome,
  type SettingsRoute,
} from "../../../../../src/frontends/web/client/settings-routes.ts";

describe("closedEntryAction", () => {
  test("a vault structure entry of any level opens its Settings card, and other entries have no button (#801)", () => {
    expect(closedEntryAction("vault_structure", true)).toBe("open_settings");
    // After the upgrade, or on a satellite, the entry has no button.
    expect(closedEntryAction("vault_structure", false)).toBeNull();
    expect(closedEntryAction("update_held_back", true)).toBeNull();
  });
});

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

  test("an expired engine login opens Settings, on the card of that engine", () => {
    expect(problemAction("engine_login:claude-code", "ok")).toBe("open_settings");
    expect(problemAction("engine_login:pi", "ok")).toBe("open_settings");
  });

  test("every other problem opens Settings", () => {
    expect(problemAction("update", "ok")).toBe("open_settings");
    expect(problemAction("vault_structure", "ok")).toBe("open_settings");
    expect(problemAction("telegram_poll", "ok")).toBe("open_settings");
  });
});

describe("problemSettingsRoute", () => {
  test("each problem opens the card that fixes it, as a search result does (#799)", () => {
    const cases: [string, SettingsRoute][] = [
      ["vault_sync", { section: "vault", item: "vault-sync" }],
      ["vault_password", { section: "vault", item: "encrypted-files" }],
      ["vault_key_changed", { section: "vault", item: "encrypted-files" }],
      ["vault_secret_files", { section: "vault", item: "encrypted-files" }],
      ["template_alignment", { section: "vault", item: "template-alignment" }],
      ["vault_structure", { section: "vault", item: "vault-structure" }],
      ["shell_wall", { section: "engines", item: "permissions" }],
      ["engine_login:claude-code", { section: "engines", item: "claude-code" }],
      ["engine_login:pi", { section: "engines", item: "pi" }],
      ["default_engine", { section: "updates", item: "versions" }],
      ["engine_update", { section: "updates", item: "versions" }],
      ["default_engine_restart", { section: "updates", item: "restart" }],
      ["update", { section: "updates", item: "eva-updates" }],
      ["vault_ahead", { section: "updates", item: "eva-updates" }],
      ["last_location", { section: "access", item: "location" }],
      ["telegram_poll", { section: "connections", item: "telegram" }],
      ["widget_check:example-owner/habits", { section: "personalize", item: "widgets" }],
      ["widget_update:example-owner/habits:0123456789ab", { section: "personalize", item: "widgets" }],
    ];
    for (const [key, route] of cases) {
      expect([key, problemSettingsRoute(key)]).toEqual([key, route]);
      // The card exists, so the search finds it too.
      expect(searchEntries.some((entry) => entry.section === route.section && entry.item === route.item)).toBe(true);
    }
  });

  test("an unknown problem opens the Settings home page", () => {
    expect(problemSettingsRoute("something_new")).toEqual(settingsHome);
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

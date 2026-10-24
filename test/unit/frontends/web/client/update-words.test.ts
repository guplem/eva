import { describe, expect, test } from "bun:test";
import type { UpdateStatus } from "../../../../../src/core/updates/updater.ts";
import {
  evaNewest,
  installLabel,
  releaseDay,
  restartWait,
  updateCallout,
  updatesFace,
  updateWait,
  versionRows,
} from "../../../../../src/frontends/web/client/update-words.ts";

const now = new Date(2026, 9, 19, 15, 0);

const status: UpdateStatus = {
  kind: "executable",
  frequency: "daily",
  install: "minor",
  phase: "idle",
  current: "2.14.2",
  latest: "2.15.0",
  available: true,
  target: "2.15.0",
  heldBack: null,
  releases: [
    {
      version: "2.15.0",
      notes: "",
      level: "minor",
      summary: "",
      headline: "Colours for the web page.",
      publishedAt: new Date(2026, 9, 19, 9, 0).toISOString(),
    },
  ],
  lastCheckAt: null,
  lastError: null,
  failedStep: null,
  failingSince: null,
  download: null,
};

describe("releaseDay", () => {
  test("says Today, the weekday, or the date, as the chat list does", () => {
    expect(releaseDay(new Date(2026, 9, 19, 8, 0).toISOString(), now)).toBe("Today");
    expect(releaseDay(new Date(2026, 9, 16, 8, 0).toISOString(), now)).toBe("Fri");
    expect(releaseDay(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe("3 Oct");
    expect(releaseDay(new Date(2025, 9, 3, 8, 0).toISOString(), now)).toBe("3 Oct 2025");
  });

  test("says nothing for a release with no date, or a bad one", () => {
    expect(releaseDay(null, now)).toBe("");
    expect(releaseDay("not a date", now)).toBe("");
  });
});

describe("versionRows", () => {
  test("lists each newer release as new, then the installed version", () => {
    expect(versionRows(status, now)).toEqual([
      { version: "2.15.0", day: "Today", headline: "Colours for the web page.", installed: false },
      { version: "2.14.2", day: "", headline: "This version runs now.", installed: true },
    ]);
  });

  test("a release that lists no change says so", () => {
    const release = { ...status.releases[0]!, headline: null, publishedAt: null };
    expect(versionRows({ ...status, current: null, releases: [release] }, now)).toEqual([
      { version: "2.15.0", day: "", headline: "No listed changes.", installed: false },
    ]);
  });
});

test("the main button names the version and the restart", () => {
  expect(installLabel("2.15.0")).toBe("Update to v2.15.0 and restart");
});

describe("updatesFace", () => {
  test("is happy after an install, surprised when a version waits, and neutral otherwise", () => {
    expect(updatesFace(status, true)).toBe("happy");
    expect(updatesFace(status, false)).toBe("surprised");
    expect(updatesFace({ ...status, available: false }, false)).toBe("neutral");
    expect(updatesFace({ ...status, lastError: "offline" }, false)).toBe("neutral");
    expect(updatesFace(null, false)).toBe("neutral");
  });
});

describe("updateWait", () => {
  test("an install shows the version and the share of its download", () => {
    expect(
      updateWait({ ...status, phase: "updating", download: { receivedBytes: 30, totalBytes: 120 } }, null),
    ).toEqual({ label: "Installing 2.15.0…", share: 0.25 });
  });

  test("an install of unknown size, or from an older Eva, has no share", () => {
    expect(updateWait({ ...status, phase: "updating" }, "Installing 2.15.0…")).toEqual({
      label: "Installing 2.15.0…",
      share: null,
    });
    const { download: _download, ...older } = status;
    expect(updateWait({ ...older, phase: "updating" } as UpdateStatus, null)?.share).toBeNull();
  });

  test("a check, or a wait that the page started, has no share", () => {
    expect(updateWait({ ...status, phase: "checking" }, null)).toEqual({
      label: "Looking for a new version…",
      share: null,
    });
    expect(updateWait(status, "Eva restarts…")).toEqual({ label: "Eva restarts…", share: null });
  });

  test("nothing runs, so nothing waits", () => {
    expect(updateWait(status, null)).toBeNull();
    expect(updateWait(null, null)).toBeNull();
  });
});

describe("restartWait", () => {
  test("names the installed version, as the status callout hides during the wait", () => {
    expect(restartWait({ ...status, phase: "restarting" })).toBe("Eva restarts with 2.15.0 when no chat runs…");
    expect(restartWait({ ...status, phase: "restarting", latest: null })).toBe(
      "Eva restarts with the new version when no chat runs…",
    );
  });
});

describe("updateCallout", () => {
  const wait = { label: "Installing 2.15.0…", share: 0.25 };

  test("nothing runs, so the callout says the status", () => {
    expect(updateCallout(status, null)).toBe("Updates: 2.15.0 is available (this is 2.14.2); checks daily");
    expect(updateCallout(null, null)).toBe("This Eva cannot update herself.");
  });

  test("the progress bar says the wait, so the callout does not repeat it", () => {
    expect(updateCallout({ ...status, phase: "updating" }, wait)).toBeNull();
    expect(updateCallout(null, wait)).toBeNull();
  });

  test("an error shows even during a wait", () => {
    expect(updateCallout({ ...status, phase: "checking", lastError: "offline" }, wait)).toBe(
      "Updates: checks daily; the last check failed: offline",
    );
  });
});

describe("evaNewest", () => {
  test("names the newest release, or null when none is newer or Eva has not checked", () => {
    expect(evaNewest(status)).toBe("2.15.0");
    expect(evaNewest({ ...status, releases: [] })).toBeNull();
    expect(evaNewest(null)).toBeNull();
  });

  test("a source checkout names no version, as it follows the main branch", () => {
    expect(evaNewest({ ...status, kind: "source", releases: [], available: true })).toBeNull();
  });
});

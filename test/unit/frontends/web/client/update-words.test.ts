import { describe, expect, test } from "bun:test";
import type { UpdateStatus } from "../../../../../src/core/updates/updater.ts";
import {
  installLabel,
  releaseDay,
  updatesFace,
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

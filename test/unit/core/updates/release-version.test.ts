import { describe, expect, test } from "bun:test";
import {
  commitChange,
  isConventionalSubject,
  latestVersionTag,
  nextReleaseVersion,
  releaseNotes,
} from "../../../../src/core/updates/release-version.ts";

const commit = (subject: string, body = ""): { subject: string; body: string } => ({ subject, body });

describe("commit change", () => {
  test("a commit type decides the size of its change", () => {
    expect(commitChange(commit("feat: voice notes"))).toBe("feature");
    expect(commitChange(commit("feat(web): a settings page"))).toBe("feature");
    expect(commitChange(commit("fix: keep the old version on a failed install"))).toBe("fix");
    expect(commitChange(commit("perf: cache the project list"))).toBe("fix");
    expect(commitChange(commit("refactor: split the updater"))).toBe("fix");
    expect(commitChange(commit("build: bump Bun"))).toBe("fix");
    expect(commitChange(commit('Revert "feat: voice notes"'))).toBe("fix");
  });

  test("a commit that changes nothing in the executable releases nothing", () => {
    for (const subject of [
      "docs: a setup guide",
      "test: cover the scheduler",
      "chore: tidy",
      "ci: cache Bun",
      "style: wrap",
    ]) {
      expect(commitChange(commit(subject))).toBeNull();
    }
  });

  test("a bang or a BREAKING CHANGE footer marks a breaking change, whatever the type", () => {
    expect(commitChange(commit("feat!: rename the settings keys"))).toBe("breaking");
    expect(commitChange(commit("refactor(config)!: drop the old format"))).toBe("breaking");
    expect(commitChange(commit("fix: a new session format", "Why.\n\nBREAKING CHANGE: old sessions are gone"))).toBe(
      "breaking",
    );
    expect(commitChange(commit("chore: drop Node", "BREAKING-CHANGE: Bun only"))).toBe("breaking");
  });

  test("a subject that no rule knows still releases, as a fix", () => {
    expect(commitChange(commit("Update README.md"))).toBe("fix");
    expect(commitChange(commit("wip: halfway"))).toBe("fix");
  });
});

describe("conventional subjects", () => {
  test("only a known type with a colon and a summary passes", () => {
    expect(isConventionalSubject("feat: voice notes")).toBe(true);
    expect(isConventionalSubject("fix(web)!: a login loop")).toBe(true);
    expect(isConventionalSubject('Revert "feat: voice notes"')).toBe(true);
    expect(isConventionalSubject("Update README.md")).toBe(false);
    expect(isConventionalSubject("feature: voice notes")).toBe(false);
    expect(isConventionalSubject("feat:voice notes")).toBe(false);
    expect(isConventionalSubject("feat: ")).toBe(false);
  });
});

describe("latest version tag", () => {
  test("the highest version wins, not the last one in the list", () => {
    expect(latestVersionTag(["v0.2.0", "v0.10.0", "v0.9.3"])).toBe("0.10.0");
  });

  test("tags that are not versions are ignored", () => {
    expect(latestVersionTag(["nightly", "v1", "v0.3.0-beta", "v0.2.1"])).toBe("0.2.1");
    expect(latestVersionTag([])).toBeNull();
  });
});

describe("next release version", () => {
  const fix = commit("fix: a bug");
  const feature = commit("feat: a feature");
  const breaking = commit("feat!: a breaking change");
  const docs = commit("docs: a guide");

  test("the first release is the package version", () => {
    expect(nextReleaseVersion({ lastVersion: null, packageVersion: "0.1.0", commits: [] })).toBe("0.1.0");
  });

  test("the largest change since the last release decides the step", () => {
    const next = (commits: { subject: string; body: string }[]): string | null =>
      nextReleaseVersion({ lastVersion: "1.4.2", packageVersion: "0.1.0", commits });
    expect(next([fix, docs])).toBe("1.4.3");
    expect(next([fix, feature])).toBe("1.5.0");
    expect(next([fix, breaking, feature])).toBe("2.0.0");
  });

  test("before 1.0, a breaking change raises only the middle number", () => {
    expect(nextReleaseVersion({ lastVersion: "0.4.2", packageVersion: "0.1.0", commits: [breaking] })).toBe("0.5.0");
  });

  test("with no change to the executable, nothing is released", () => {
    expect(nextReleaseVersion({ lastVersion: "0.4.2", packageVersion: "0.1.0", commits: [docs] })).toBeNull();
    expect(nextReleaseVersion({ lastVersion: "0.4.2", packageVersion: "0.1.0", commits: [] })).toBeNull();
  });

  test("a package version above the last release is a step set by hand", () => {
    expect(nextReleaseVersion({ lastVersion: "0.9.4", packageVersion: "1.0.0", commits: [docs] })).toBe("1.0.0");
    expect(nextReleaseVersion({ lastVersion: "0.9.4", packageVersion: "0.9.4", commits: [fix] })).toBe("0.9.5");
  });
});

describe("release notes", () => {
  test("notes group the commits by the size of their change", () => {
    const notes = releaseNotes([
      commit("fix: a bug"),
      commit("docs: a guide"),
      commit("feat!: rename the settings keys", "BREAKING CHANGE: old keys are gone"),
      commit("feat: voice notes"),
      commit("Update README.md"),
    ]);
    expect(notes).toBe(
      [
        "## Breaking changes",
        "",
        "- feat!: rename the settings keys",
        "",
        "## New features",
        "",
        "- feat: voice notes",
        "",
        "## Fixes and other changes",
        "",
        "- fix: a bug",
        "- Update README.md",
        "",
      ].join("\n"),
    );
  });

  test("notes with no change to the executable say so", () => {
    expect(releaseNotes([commit("docs: a guide")])).toBe("No change to the executable.\n");
  });
});

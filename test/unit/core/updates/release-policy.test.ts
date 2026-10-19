import { describe, expect, test } from "bun:test";
import {
  pickUpdate,
  releaseLevel,
  releaseSummary,
  type ReleaseInfo,
  type UpdatePolicy,
} from "../../../../src/core/updates/release-policy.ts";
import { releaseNotes } from "../../../../src/core/updates/release-version.ts";

function release(version: string, ...subjects: string[]): ReleaseInfo {
  return { version, notes: releaseNotes(subjects.map((subject) => ({ subject, body: "" }))) };
}

describe("release level", () => {
  test("the first number that changes names the level", () => {
    expect(releaseLevel("1.4.2", "1.4.3")).toBe("patch");
    expect(releaseLevel("1.4.2", "1.5.0")).toBe("minor");
    expect(releaseLevel("1.4.2", "2.0.0")).toBe("major");
    expect(releaseLevel("0.2.0", "1.0.0")).toBe("major");
    expect(releaseLevel("0.2.0", "v0.3.0")).toBe("minor");
  });
});

describe("pick update", () => {
  const releases = [release("1.4.3"), release("2.0.0"), release("1.5.0"), release("1.4.1")];

  function picked(policy: UpdatePolicy): { install: string | null; heldBack: string | null } {
    const { install, heldBack } = pickUpdate("1.4.2", releases, policy);
    return { install, heldBack };
  }

  test("each policy installs, or holds back, a patch, a minor and a major release", () => {
    expect(picked("patch")).toEqual({ install: "1.4.3", heldBack: "2.0.0" });
    expect(picked("minor")).toEqual({ install: "1.5.0", heldBack: "2.0.0" });
    expect(picked("major")).toEqual({ install: "2.0.0", heldBack: null });
  });

  test("only a release that the policy refuses is held back", () => {
    const onlyMinor = [release("1.5.0")];
    expect(pickUpdate("1.4.2", onlyMinor, "patch")).toMatchObject({ install: null, heldBack: "1.5.0" });
    expect(pickUpdate("1.4.2", onlyMinor, "minor")).toMatchObject({ install: "1.5.0", heldBack: null });
    expect(pickUpdate("2.0.0", releases, "major")).toMatchObject({ install: null, heldBack: null, newer: [] });
  });

  test("the newer releases come newest first, each with its level, and never an older one", () => {
    expect(pickUpdate("1.4.2", releases, "minor").newer.map(({ version, level }) => [version, level])).toEqual([
      ["2.0.0", "major"],
      ["1.5.0", "minor"],
      ["1.4.3", "patch"],
    ]);
  });

  test("each newer release carries the summary of the jump from the current version to it", () => {
    const newer = pickUpdate(
      "1.0.0",
      [release("1.1.0", "feat: voice notes"), release("1.0.1", "fix: a crash")],
      "minor",
    ).newer;
    expect(newer.map(({ summary }) => summary)).toEqual([
      "New features:\n• feat: voice notes (1.1.0)\n\nFixes and other changes:\n• fix: a crash (1.0.1)",
      "Fixes and other changes:\n• fix: a crash (1.0.1)",
    ]);
  });

  test("each newer release carries its own first change as one sentence, a breaking change first", () => {
    const newer = pickUpdate(
      "1.0.0",
      [
        release("2.0.0", "fix(web): a typo", "feat(core)!: rename the settings keys"),
        release("1.1.0", "feat: voice notes"),
        release("1.0.1"),
      ],
      "minor",
    ).newer;
    expect(newer.map(({ headline }) => headline)).toEqual(["Rename the settings keys.", "Voice notes.", null]);
  });

  test("a pull request title loses its number, and a sentence keeps its own end mark", () => {
    const notes = releaseNotes([
      { subject: "feat: x", body: "", pullRequest: { number: 7, title: "feat(web): what is new?" } },
    ]);
    expect(pickUpdate("1.0.0", [{ version: "1.1.0", notes }], "minor").newer[0]?.headline).toBe("What is new?");
  });

  test("each newer release carries its publish date, or null when GitHub sent none", () => {
    const newer = pickUpdate(
      "1.0.0",
      [{ ...release("1.1.0"), publishedAt: "2026-10-12T09:00:00Z" }, release("1.0.1")],
      "minor",
    ).newer;
    expect(newer.map(({ publishedAt }) => publishedAt)).toEqual(["2026-10-12T09:00:00Z", null]);
  });
});

describe("a vault that needs a newer Eva (#119)", () => {
  const releases = [release("1.4.3"), release("2.0.0"), release("1.5.0"), release("1.4.1")];

  test("installs at least the version that the vault needs, whatever the policy says", () => {
    expect(pickUpdate("1.4.2", releases, "patch", "1.5.0")).toMatchObject({ install: "1.5.0", heldBack: "2.0.0" });
    expect(pickUpdate("1.4.2", releases, "patch", "1.4.4")).toMatchObject({ install: "1.5.0" });
  });

  test("keeps the policy's pick when it is newer than the version that the vault needs", () => {
    expect(pickUpdate("1.4.2", releases, "major", "1.5.0")).toMatchObject({ install: "2.0.0", heldBack: null });
  });

  test("installs the newest release when the vault does not say which version it needs", () => {
    expect(pickUpdate("1.4.2", releases, "patch", "newest")).toMatchObject({ install: "2.0.0", heldBack: null });
  });

  test("installs the newest release when no release reaches the version that the vault needs", () => {
    expect(pickUpdate("1.4.2", releases, "patch", "3.0.0")).toMatchObject({ install: "2.0.0", heldBack: null });
  });
});

describe("release summary", () => {
  test("a jump of several versions puts every breaking change first, then features, then fixes", () => {
    const summary = releaseSummary([
      release("1.0.1", "fix: a crash at start"),
      release("1.0.0", "feat!: rename the settings keys", "fix: a typo"),
      release("0.3.0", "feat: voice notes", "feat!: drop Node"),
    ]);
    expect(summary).toBe(
      [
        "Breaking changes:",
        "• feat!: drop Node (0.3.0)",
        "• feat!: rename the settings keys (1.0.0)",
        "",
        "New features:",
        "• feat: voice notes (0.3.0)",
        "",
        "Fixes and other changes:",
        "• fix: a typo (1.0.0)",
        "• fix: a crash at start (1.0.1)",
      ].join("\n"),
    );
  });

  test("the summary shows the pull requests, not the commits in the detail view", () => {
    const notes = releaseNotes([
      {
        subject: "feat: record a voice note",
        body: "",
        hash: "aaaaaaa",
        pullRequest: { number: 7, title: "Voice notes" },
      },
    ]);
    expect(releaseSummary([{ version: "1.1.0", notes }])).toBe("New features:\n• Voice notes (#7) (1.1.0)");
  });

  test("notes in another shape still show, under the other changes", () => {
    expect(releaseSummary([{ version: "1.0.0", notes: "Hand-written notes.\n\n* one point\n" }])).toBe(
      ["Fixes and other changes:", "• Hand-written notes. (1.0.0)", "• one point (1.0.0)"].join("\n"),
    );
    expect(releaseSummary([{ version: "1.0.0", notes: "No change to the executable.\n" }])).toBe("No listed changes.");
  });
});

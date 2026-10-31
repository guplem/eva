import { describe, expect, test } from "bun:test";
import type { GithubRequest } from "../../../../src/core/projects/repository-facts.ts";
import { releaseNotes } from "../../../../src/core/widgets/widget-notes.ts";

const from = "a".repeat(40);
const to = "b".repeat(40);
const compare = {
  base_commit: { commit: { committer: { date: "2026-01-01T09:00:00Z" } } },
  commits: [{ commit: { message: "feat: add streaks\n\nThe body." } }, { commit: { message: "fix: the dark mode" } }],
};

function github(releases: unknown, compareStatus = 200): { request: GithubRequest; paths: string[] } {
  const paths: string[] = [];
  const request: GithubRequest = (path) => {
    paths.push(path);
    if (path.includes("/compare/")) return Promise.resolve({ status: compareStatus, body: JSON.stringify(compare) });
    return Promise.resolve({ status: 200, body: JSON.stringify(releases) });
  };
  return { request, paths };
}

describe("releaseNotes", () => {
  test("gives each release since the approved commit, on one line", async () => {
    const { request, paths } = github([
      { name: "v1.2.0", body: "## Features\n\n* add streaks (#12)", published_at: "2026-01-02T09:00:00Z" },
      { tag_name: "v1.1.1", body: "", published_at: "2026-01-01T10:00:00Z" },
      { name: "draft", body: "x", draft: true, published_at: "2026-01-03T09:00:00Z" },
      { name: "v1.1.0", body: "old", published_at: "2025-12-01T09:00:00Z" },
    ]);
    expect(await releaseNotes(request, "example-owner/habits", from, to)).toEqual([
      "v1.2.0: Features * add streaks (#12)",
      "v1.1.1",
    ]);
    expect(paths).toEqual([
      `repos/example-owner/habits/compare/${from}...${to}`,
      "repos/example-owner/habits/releases?per_page=20",
    ]);
  });

  test("gives the commit subjects, newest first, with no release", async () => {
    const { request } = github([]);
    expect(await releaseNotes(request, "example-owner/habits", from, to)).toEqual([
      "fix: the dark mode",
      "feat: add streaks",
    ]);
  });

  test("gives nothing when GitHub does not compare the commits", async () => {
    const { request } = github([], 404);
    expect(await releaseNotes(request, "example-owner/habits", from, to)).toEqual([]);
  });
});

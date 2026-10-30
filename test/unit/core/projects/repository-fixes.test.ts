import { describe, expect, test } from "bun:test";
import { ghApiWrite, runDirectFixes, type GithubWrite } from "../../../../src/core/projects/repository-fixes.ts";
import type { GithubAnswer } from "../../../../src/core/projects/repository-facts.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A fake GitHub that records each call, and answers from the table, or 200 with `{}`. */
function fakeWrite(answers: Readonly<Record<string, GithubAnswer>> = {}): { write: GithubWrite; calls: Call[] } {
  const calls: Call[] = [];
  const write: GithubWrite = (method, path, body) => {
    calls.push({ method, path, body });
    return Promise.resolve(answers[`${method} ${path}`] ?? { status: 200, body: "{}" });
  };
  return { write, calls };
}

const ok = (body: unknown): GithubAnswer => ({ status: 200, body: JSON.stringify(body) });

describe("runDirectFixes", () => {
  test("an API fix is one call; a refused call fails with GitHub's message, and the next fix still runs", async () => {
    const { write, calls } = fakeWrite({
      "PUT repos/owner/app/vulnerability-alerts": { status: 403, body: '{"message":"Must have admin rights"}' },
    });
    const outcome = await runDirectFixes(
      "owner/app",
      [
        {
          label: "Dependabot alerts",
          directFix: { kind: "api", method: "PUT", path: "repos/owner/app/vulnerability-alerts", body: null },
        },
        {
          label: "Auto-merge",
          directFix: { kind: "api", method: "PATCH", path: "repos/owner/app", body: { allow_auto_merge: true } },
        },
      ],
      write,
    );
    expect(calls).toEqual([
      { method: "PUT", path: "repos/owner/app/vulnerability-alerts", body: undefined },
      { method: "PATCH", path: "repos/owner/app", body: { allow_auto_merge: true } },
    ]);
    expect(outcome).toEqual({
      fixed: ["Auto-merge"],
      failed: [{ label: "Dependabot alerts", reason: "GitHub refused it (HTTP 403): Must have admin rights" }],
    });
  });

  test("a call marked last runs after the commit of the file fixes", async () => {
    const { write, calls } = fakeWrite({
      "GET repos/owner/app/git/ref/heads/main": ok({ object: { sha: "head" } }),
      "GET repos/owner/app/git/commits/head": ok({ tree: { sha: "base" } }),
      "POST repos/owner/app/git/trees": ok({ sha: "tree" }),
      "POST repos/owner/app/git/commits": ok({ sha: "commit" }),
    });
    const outcome = await runDirectFixes(
      "owner/app",
      [
        {
          label: "Required checks before merge",
          directFix: {
            kind: "api",
            method: "POST",
            path: "repos/owner/app/rulesets",
            body: { name: "main" },
            last: true,
          },
        },
        {
          label: "Skill write-commit",
          directFix: { kind: "files", source: "guplem/eva", branch: "main", files: { "a/SKILL.md": "s1" }, remove: [] },
        },
      ],
      write,
    );
    expect(calls.map((call) => `${call.method} ${call.path}`).slice(-2)).toEqual([
      "PATCH repos/owner/app/git/refs/heads/main",
      "POST repos/owner/app/rulesets",
    ]);
    expect(outcome.fixed).toEqual(["Skill write-commit", "Required checks before merge"]);
  });

  test("labels copy with their colour and description, and the defaults go", async () => {
    const { write, calls } = fakeWrite({
      "GET repos/guplem/eva/labels?per_page=100": ok([
        { name: "auto-developing", color: "0e8a16", description: "An agent works on it now." },
        { name: "other", color: "ffffff", description: "" },
      ]),
    });
    const outcome = await runDirectFixes(
      "owner/app",
      [
        {
          label: "Labels",
          directFix: { kind: "labels", source: "guplem/eva", add: ["auto-developing"], remove: ["good first issue"] },
        },
      ],
      write,
    );
    expect(calls.slice(1)).toEqual([
      {
        method: "POST",
        path: "repos/owner/app/labels",
        body: { name: "auto-developing", color: "0e8a16", description: "An agent works on it now." },
      },
      { method: "DELETE", path: "repos/owner/app/labels/good%20first%20issue", body: undefined },
    ]);
    expect(outcome.fixed).toEqual(["Labels"]);
  });

  test("file fixes copy the blobs and land as one commit on the branch", async () => {
    const { write, calls } = fakeWrite({
      "GET repos/owner/app/git/ref/heads/main": ok({ object: { sha: "head" } }),
      "GET repos/owner/app/git/commits/head": ok({ tree: { sha: "base" } }),
      "GET repos/guplem/eva/git/blobs/sha-a": ok({ content: "YQ==", encoding: "base64" }),
      "GET repos/guplem/eva/git/blobs/sha-b": ok({ content: "Yg==", encoding: "base64" }),
      "POST repos/owner/app/git/trees": ok({ sha: "tree" }),
      "POST repos/owner/app/git/commits": ok({ sha: "commit" }),
    });
    const outcome = await runDirectFixes(
      "owner/app",
      [
        {
          label: "Skill a",
          directFix: {
            kind: "files",
            source: "guplem/eva",
            branch: "main",
            files: { ".agents/skills/a/SKILL.md": "sha-a" },
            remove: [".agents/skills/a/old.md"],
          },
        },
        {
          label: "Skill b",
          directFix: {
            kind: "files",
            source: "guplem/eva",
            branch: "main",
            files: { ".agents/skills/b/SKILL.md": "sha-b" },
            remove: [],
          },
        },
      ],
      write,
    );
    expect(outcome).toEqual({ fixed: ["Skill a", "Skill b"], failed: [] });
    const posted = (path: string): unknown => calls.find((call) => call.path === path && call.method !== "GET")?.body;
    expect(calls.filter((call) => call.path === "repos/owner/app/git/blobs")).toHaveLength(2);
    expect(posted("repos/owner/app/git/trees")).toEqual({
      base_tree: "base",
      tree: [
        { path: ".agents/skills/a/SKILL.md", mode: "100644", type: "blob", sha: "sha-a" },
        { path: ".agents/skills/b/SKILL.md", mode: "100644", type: "blob", sha: "sha-b" },
        { path: ".agents/skills/a/old.md", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(posted("repos/owner/app/git/commits")).toEqual({
      message: "chore: copy the agent skills of the vibe-coded standard",
      tree: "tree",
      parents: ["head"],
    });
    expect(calls.at(-1)).toEqual({
      method: "PATCH",
      path: "repos/owner/app/git/refs/heads/main",
      body: { sha: "commit" },
    });
  });

  test("a file fix that GitHub refuses fails every file item with the reason", async () => {
    const { write } = fakeWrite({ "GET repos/owner/app/git/ref/heads/main": { status: 404, body: "" } });
    const fix = { kind: "files", source: "guplem/eva", branch: "main", files: {}, remove: [] } as const;
    const outcome = await runDirectFixes("owner/app", [{ label: "Skill a", directFix: fix }], write);
    expect(outcome).toEqual({ fixed: [], failed: [{ label: "Skill a", reason: "GitHub refused it (HTTP 404)." }] });
  });
});

describe("ghApiWrite", () => {
  test("sends the method, and the body as JSON on the input", async () => {
    const runs: { command: readonly string[]; stdin: string | undefined }[] = [];
    const runner: ProcessRunner = {
      run: (command, options) => {
        runs.push({ command, stdin: options.stdin });
        return Promise.resolve({ exitCode: 0, stdout: "HTTP/2.0 204 No Content\r\n\r\n", stderr: "" });
      },
    };
    const write = ghApiWrite(runner, {});
    expect(await write("PATCH", "repos/a/b", { allow_auto_merge: true })).toEqual({ status: 204, body: "" });
    await write("PUT", "repos/a/b/vulnerability-alerts");
    expect(runs).toEqual([
      {
        command: ["gh", "api", "--include", "-X", "PATCH", "repos/a/b", "--input", "-"],
        stdin: '{"allow_auto_merge":true}',
      },
      { command: ["gh", "api", "--include", "-X", "PUT", "repos/a/b/vulnerability-alerts"], stdin: undefined },
    ]);
  });
});

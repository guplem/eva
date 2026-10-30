/**
 * Runs the direct fixes of a setup report through `gh api`, with the instance's own login: the
 * same login and admin rights that the report already needs (#681). A fix that GitHub refuses
 * fails with GitHub's reason, and the other fixes still run.
 */
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { asRecord, ghApi, listOf, parseJson, textField, type GithubAnswer } from "./repository-facts.ts";
import type { DirectFix } from "./repository-setup.ts";

export type GithubMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One call of the GitHub API that can change the repository. The body goes as JSON. */
export type GithubWrite = (method: GithubMethod, path: string, body?: unknown) => Promise<GithubAnswer>;

/** A GithubWrite over `gh api`, with the JSON body on the input, so no shell reads it. */
export function ghApiWrite(runner: ProcessRunner, environment: Readonly<Record<string, string>>): GithubWrite {
  return (method, path, body) =>
    body === undefined
      ? ghApi(runner, environment, ["-X", method, path])
      : ghApi(runner, environment, ["-X", method, path, "--input", "-"], JSON.stringify(body));
}

export interface FixItem {
  readonly label: string;
  readonly directFix: DirectFix;
}

export interface FixOutcome {
  /** The labels of the items that Eva fixed. */
  readonly fixed: readonly string[];
  readonly failed: readonly { readonly label: string; readonly reason: string }[];
}

const commitMessage = "chore: copy the agent skills of the vibe-coded standard";
const copiesAtOnce = 4;
/** One page holds every label of a reference repository. */
const labelPage = "?per_page=100";

/**
 * Runs the fixes in order. Every file fix lands in one commit, after the other fixes, and before the
 * calls marked `last`.
 */
export async function runDirectFixes(slug: string, items: readonly FixItem[], write: GithubWrite): Promise<FixOutcome> {
  const fixed: string[] = [];
  const failed: { label: string; reason: string }[] = [];
  const record = async (labels: readonly string[], fix: () => Promise<void>): Promise<void> => {
    try {
      await fix();
      fixed.push(...labels);
    } catch (error) {
      if (!isEvaError(error, "github_failed")) throw error;
      failed.push(...labels.map((label) => ({ label, reason: error.message })));
    }
  };
  const runCall = (label: string, fix: Extract<DirectFix, { kind: "api" }>): Promise<void> =>
    record([label], () => githubCall(write, fix.method, fix.path, fix.body ?? undefined).then(() => undefined));
  for (const { label, directFix } of items) {
    if (directFix.kind === "api") {
      if (directFix.last !== true) await runCall(label, directFix);
    } else if (directFix.kind === "labels") {
      await record([label], () => copyLabels(slug, directFix, write));
    }
  }
  const files = items.flatMap((item) => (item.directFix.kind === "files" ? [{ ...item, fix: item.directFix }] : []));
  const first = files[0];
  if (first !== undefined) {
    await record(
      files.map((item) => item.label),
      () =>
        commitFiles(
          slug,
          first.fix.branch,
          files.map((item) => item.fix),
          write,
        ),
    );
  }
  for (const { label, directFix } of items) {
    if (directFix.kind === "api" && directFix.last === true) await runCall(label, directFix);
  }
  return { fixed, failed };
}

async function copyLabels(
  slug: string,
  fix: Extract<DirectFix, { kind: "labels" }>,
  write: GithubWrite,
): Promise<void> {
  const source =
    fix.add.length === 0 ? [] : listOf(await githubCall(write, "GET", `repos/${fix.source}/labels${labelPage}`));
  for (const name of fix.add) {
    const found = source.find((label) => textField(label, "name") === name);
    await githubCall(write, "POST", `repos/${slug}/labels`, {
      name,
      color: textField(found, "color") ?? "ededed",
      description: textField(found, "description") ?? "",
    });
  }
  for (const name of fix.remove) await githubCall(write, "DELETE", `repos/${slug}/labels/${encodeURIComponent(name)}`);
}

/**
 * Copies each file from its source repository and deletes the others, in one commit on the branch.
 * A blob's SHA depends only on its content, so the copy keeps the SHA that the report compares.
 */
async function commitFiles(
  slug: string,
  branch: string,
  fixes: readonly Extract<DirectFix, { kind: "files" }>[],
  write: GithubWrite,
): Promise<void> {
  const address = `repos/${slug}/git`;
  const head = textField(asRecord(await githubCall(write, "GET", `${address}/ref/heads/${branch}`))?.["object"], "sha");
  const base =
    head === null
      ? null
      : textField(asRecord(await githubCall(write, "GET", `${address}/commits/${head}`))?.["tree"], "sha");
  if (head === null || base === null) throw unreadable();
  const copies = fixes.flatMap((fix) =>
    Object.entries(fix.files).map(([path, sha]) => ({ source: fix.source, path, sha })),
  );
  // A few copies run side by side: GitHub limits how many writes run at once.
  for (let start = 0; start < copies.length; start += copiesAtOnce) {
    await Promise.all(
      copies.slice(start, start + copiesAtOnce).map(async ({ source, sha }) => {
        const blob = asRecord(await githubCall(write, "GET", `repos/${source}/git/blobs/${sha}`));
        await githubCall(write, "POST", `${address}/blobs`, {
          content: textField(blob, "content") ?? "",
          encoding: textField(blob, "encoding") ?? "base64",
        });
      }),
    );
  }
  const tree: { path: string; mode: string; type: string; sha: string | null }[] = copies.map(({ path, sha }) => ({
    path,
    mode: "100644",
    type: "blob",
    sha,
  }));
  for (const fix of fixes) for (const path of fix.remove) tree.push({ path, mode: "100644", type: "blob", sha: null });
  const treeSha = textField(await githubCall(write, "POST", `${address}/trees`, { base_tree: base, tree }), "sha");
  if (treeSha === null) throw unreadable();
  const commit = textField(
    await githubCall(write, "POST", `${address}/commits`, { message: commitMessage, tree: treeSha, parents: [head] }),
    "sha",
  );
  if (commit === null) throw unreadable();
  await githubCall(write, "PATCH", `${address}/refs/heads/${branch}`, { sha: commit });
}

/** The parsed body of a 2xx answer. Throws `github_failed` with GitHub's message for any other. */
export async function githubCall(
  write: GithubWrite,
  method: GithubMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const answer = await write(method, path, body);
  const parsed = parseJson(answer.body);
  if (answer.status >= 200 && answer.status < 300) return parsed;
  const message = textField(parsed, "message");
  throw new EvaError(
    "github_failed",
    `GitHub refused it (HTTP ${String(answer.status)})${message === null ? "." : `: ${message}`}`,
  );
}

function unreadable(): EvaError {
  return new EvaError("github_failed", "GitHub sent an answer that Eva cannot read.");
}

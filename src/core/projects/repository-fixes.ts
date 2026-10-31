/**
 * Runs the direct fixes of a setup report through `gh api`, with the instance's own login: the
 * same login and admin rights that the report already needs (#681). A fix that GitHub refuses
 * fails with GitHub's reason, and the other fixes still run.
 */
import { createHash } from "node:crypto";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import {
  asRecord,
  ghApi,
  listOf,
  parseJson,
  readRequiredChecks,
  textField,
  type GithubAnswer,
} from "./repository-facts.ts";
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
  /** One line for the person about a fixed item that is not on the branch yet, such as a pull request. */
  readonly notes: readonly string[];
}

const commitMessage = "chore: copy the agent skills of the vibe-coded standard";
const skillsTopic = "agent-skills";
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
  const notes: string[] = [];
  const record = async (labels: readonly string[], fix: () => Promise<Landing | undefined>): Promise<void> => {
    try {
      const landing = await fix();
      fixed.push(...labels);
      if (landing?.kind === "pull request")
        notes.push(
          `${labels.join(", ")}: Eva opened the pull request ${landing.url}. It merges by itself when CI passes.`,
        );
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
      await record([label], () => copyLabels(slug, directFix, write).then(() => undefined));
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
  return { fixed, failed, notes };
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
 * Copies each file from its source repository and deletes the others, in one change of the branch.
 * A blob's SHA depends only on its content, so the copy keeps the SHA that the report compares.
 */
async function commitFiles(
  slug: string,
  branch: string,
  fixes: readonly Extract<DirectFix, { kind: "files" }>[],
  write: GithubWrite,
): Promise<Landing> {
  const head = await branchHead(write, slug, branch);
  const copies = fixes.flatMap((fix) =>
    Object.entries(fix.files).map(([path, sha]) => ({ source: fix.source, path, sha })),
  );
  // A few copies run side by side: GitHub limits how many writes run at once.
  for (let start = 0; start < copies.length; start += copiesAtOnce) {
    await Promise.all(
      copies.slice(start, start + copiesAtOnce).map(async ({ source, sha }) => {
        const blob = asRecord(await githubCall(write, "GET", `repos/${source}/git/blobs/${sha}`));
        await githubCall(write, "POST", `repos/${slug}/git/blobs`, {
          content: textField(blob, "content") ?? "",
          encoding: textField(blob, "encoding") ?? "base64",
        });
      }),
    );
  }
  const tree: TreeEntry[] = copies.map(({ path, sha }) => ({ path, mode: "100644", type: "blob", sha }));
  for (const fix of fixes) for (const path of fix.remove) tree.push({ path, mode: "100644", type: "blob", sha: null });
  const sources = [...new Set(fixes.map((fix) => fix.source))].join(", ");
  return landTree(write, slug, branch, head, tree, {
    message: commitMessage,
    body: `Eva copies the agent skills of the vibe-coded standard from ${sources}. Auto-merge merges this pull request when CI passes.`,
    topic: skillsTopic,
  });
}

/** A change of files that `landTree` puts on a branch. */
export interface TreeChange {
  /** The commit message, and the title of a pull request. */
  readonly message: string;
  /** The description of a pull request. */
  readonly body: string;
  /** A short name for the branch of a pull request, such as `agent-skills`. */
  readonly topic: string;
}

/** How a change reached the branch: a commit on it, or a pull request with auto-merge. */
export type Landing = { readonly kind: "commit" } | { readonly kind: "pull request"; readonly url: string };

/**
 * Puts a change of files on a branch. A branch that requires checks refuses a commit with none, so
 * the change goes through a pull request with auto-merge: it merges only when CI passes (#717).
 * Any other branch gets the commit straight away.
 */
export async function landTree(
  write: GithubWrite,
  slug: string,
  branch: string,
  head: string,
  tree: readonly TreeEntry[],
  change: TreeChange,
): Promise<Landing> {
  const rules = await branchRules(write, slug, branch);
  if (!rules.requiresChecks) {
    await commitTree(write, slug, branch, head, tree, change.message);
    return { kind: "commit" };
  }
  // The same change gets the same branch, so a second Fix finds the pull request of the first.
  const digest = createHash("sha256")
    .update(JSON.stringify({ message: change.message, tree }))
    .digest("hex");
  const name = `eva/${change.topic}-${digest.slice(0, 8)}`;
  const owner = slug.split("/")[0] ?? "";
  const open = listOf(
    await githubCall(write, "GET", `repos/${slug}/pulls?head=${owner}:${encodeURIComponent(name)}&state=open`),
  )[0];
  const pull =
    open === undefined
      ? await openPullRequest(
          write,
          slug,
          branch,
          name,
          await makeCommit(write, slug, head, tree, change.message),
          change,
        )
      : pullRequestOf(open);
  if (pull.autoMerge) return { kind: "pull request", url: pull.url };
  try {
    await enableAutoMerge(write, slug, pull.nodeId, rules.list);
  } catch (error) {
    if (!isEvaError(error, "github_failed")) throw error;
    throw new EvaError(
      "github_failed",
      `Eva opened the pull request ${pull.url}, but GitHub refused auto-merge: ${error.message}`,
      { cause: error },
    );
  }
  return { kind: "pull request", url: pull.url };
}

interface BranchRules {
  readonly requiresChecks: boolean;
  /** Each rule of the rulesets on the branch. */
  readonly list: readonly unknown[];
}

/** Unreadable rules count as none: a refused commit then names GitHub's reason. */
async function branchRules(write: GithubWrite, slug: string, branch: string): Promise<BranchRules> {
  const read = async (path: string): Promise<unknown> => {
    const answer = await write("GET", path);
    return answer.status >= 200 && answer.status < 300 ? parseJson(answer.body) : null;
  };
  const encoded = encodeURIComponent(branch);
  const [rules, info] = await Promise.all([
    read(`repos/${slug}/rules/branches/${encoded}`),
    read(`repos/${slug}/branches/${encoded}`),
  ]);
  return { requiresChecks: readRequiredChecks(rules, info) === true, list: listOf(rules) };
}

interface OpenPullRequest {
  readonly url: string;
  readonly nodeId: string;
  readonly autoMerge: boolean;
}

/** A branch of Eva at the commit, and a pull request from it. */
async function openPullRequest(
  write: GithubWrite,
  slug: string,
  base: string,
  name: string,
  commit: string,
  change: TreeChange,
): Promise<OpenPullRequest> {
  const ref = await write("POST", `repos/${slug}/git/refs`, { ref: `refs/heads/${name}`, sha: commit });
  if (ref.status === 422 && textField(parseJson(ref.body), "message") === "Reference already exists") {
    // A closed pull request left Eva's branch behind. No open pull request uses it, so it moves.
    await githubCall(write, "PATCH", `repos/${slug}/git/refs/heads/${encodeURIComponent(name)}`, {
      sha: commit,
      force: true,
    });
  } else {
    checked(ref);
  }
  return pullRequestOf(
    await githubCall(write, "POST", `repos/${slug}/pulls`, {
      title: change.message,
      head: name,
      base,
      body: change.body,
    }),
  );
}

function pullRequestOf(value: unknown): OpenPullRequest {
  const url = textField(value, "html_url");
  const nodeId = textField(value, "node_id");
  if (url === null || nodeId === null) throw unreadable();
  const autoMerge = asRecord(value)?.["auto_merge"];
  return { url, nodeId, autoMerge: autoMerge !== null && autoMerge !== undefined };
}

const autoMergeMutation =
  "mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) { clientMutationId } }";

const mergeMethods = [
  { name: "merge", setting: "allow_merge_commit" },
  { name: "squash", setting: "allow_squash_merge" },
  { name: "rebase", setting: "allow_rebase_merge" },
] as const;

/**
 * REST cannot turn on auto-merge, so this is the GraphQL call that `gh pr merge --auto` makes. The
 * method is the first one that the repository settings and the rules allow, in the order that Eva's
 * own merges use.
 */
async function enableAutoMerge(
  write: GithubWrite,
  slug: string,
  pullRequestId: string,
  rules: readonly unknown[],
): Promise<void> {
  const settings = asRecord(await githubCall(write, "GET", `repos/${slug}`));
  const linear = rules.some((rule) => textField(rule, "type") === "required_linear_history");
  const allowedByRules = rules.flatMap((rule) =>
    textField(rule, "type") === "pull_request"
      ? [listOf(asRecord(asRecord(rule)?.["parameters"])?.["allowed_merge_methods"])]
      : [],
  );
  const method =
    mergeMethods.find(
      ({ name, setting }) =>
        settings?.[setting] !== false &&
        !(linear && name === "merge") &&
        allowedByRules.every((allowed) => allowed.length === 0 || allowed.includes(name)),
    )?.name ?? "merge";
  const mergeMethod = method.toUpperCase();
  const answer = await githubCall(write, "POST", "graphql", {
    query: autoMergeMutation,
    variables: { pullRequestId, mergeMethod },
  });
  // GraphQL answers 200 with a list of errors.
  const errors = listOf(asRecord(answer)?.["errors"]);
  if (errors.length > 0)
    throw new EvaError("github_failed", errors.map((error) => textField(error, "message") ?? "").join(" "));
}

/** One entry of a Git tree: a blob by its SHA, null to delete the path, or its text. */
export type TreeEntry =
  | { readonly path: string; readonly mode: "100644"; readonly type: "blob"; readonly sha: string | null }
  | { readonly path: string; readonly mode: "100644"; readonly type: "blob"; readonly content: string };

/** The SHA of the newest commit of a branch. */
export async function branchHead(write: GithubWrite, slug: string, branch: string): Promise<string> {
  const head = textField(
    asRecord(await githubCall(write, "GET", `repos/${slug}/git/ref/heads/${encodeURIComponent(branch)}`))?.["object"],
    "sha",
  );
  if (head === null) throw unreadable();
  return head;
}

/** One commit on top of `head` that changes these entries of its tree; then the branch points at it. */
export async function commitTree(
  write: GithubWrite,
  slug: string,
  branch: string,
  head: string,
  tree: readonly TreeEntry[],
  message: string,
): Promise<void> {
  const commit = await makeCommit(write, slug, head, tree, message);
  await githubCall(write, "PATCH", `repos/${slug}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit });
}

/** One commit on top of `head` that changes these entries of its tree, on no branch yet. Its SHA. */
async function makeCommit(
  write: GithubWrite,
  slug: string,
  head: string,
  tree: readonly TreeEntry[],
  message: string,
): Promise<string> {
  const address = `repos/${slug}/git`;
  const base = textField(asRecord(await githubCall(write, "GET", `${address}/commits/${head}`))?.["tree"], "sha");
  if (base === null) throw unreadable();
  const treeSha = textField(await githubCall(write, "POST", `${address}/trees`, { base_tree: base, tree }), "sha");
  if (treeSha === null) throw unreadable();
  const commit = textField(
    await githubCall(write, "POST", `${address}/commits`, { message, tree: treeSha, parents: [head] }),
    "sha",
  );
  if (commit === null) throw unreadable();
  return commit;
}

/** The parsed body of a 2xx answer. Throws `github_failed` with GitHub's message for any other. */
export async function githubCall(
  write: GithubWrite,
  method: GithubMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return checked(await write(method, path, body));
}

function checked(answer: GithubAnswer): unknown {
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

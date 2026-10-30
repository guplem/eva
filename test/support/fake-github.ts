/**
 * A fake GitHub API for the setup report: each repository answers its main address, its tree,
 * its labels and its file contents. Every other address answers 404.
 */
import { createHash } from "node:crypto";
import type { GithubAnswer, GithubRequest } from "../../src/core/projects/repository-facts.ts";
import type { GithubWrite } from "../../src/core/projects/repository-fixes.ts";

/** The blob SHA that git gives a file with this text, as a real tree lists it. */
function gitBlobSha(text: string): string {
  const body = Buffer.from(text, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${String(body.length)}\0`), body]))
    .digest("hex");
}

export interface FakeRepository {
  /** Fields of `GET repos/{slug}` on top of a public repository where Eva is admin. */
  readonly repository?: Readonly<Record<string, unknown>>;
  /** Each file path and its content. */
  readonly files: Readonly<Record<string, string>>;
  readonly labels: readonly string[];
  /** More answers, by the path after `repos/{slug}/`, such as `pages`. */
  readonly answers?: Readonly<Record<string, unknown>>;
  /** The GraphQL security facts; both true when not given. */
  readonly security?: { readonly hasVulnerabilityAlertsEnabled: boolean; readonly isSecurityPolicyEnabled: boolean };
}

export function fakeGithub(repositories: Readonly<Record<string, FakeRepository>>): GithubRequest {
  return (path, raw = false, fields = {}) => {
    const named = repositories[`${fields["owner"] ?? ""}/${fields["name"] ?? ""}`];
    if (path === "graphql" && named !== undefined) {
      const security = named.security ?? { hasVulnerabilityAlertsEnabled: true, isSecurityPolicyEnabled: true };
      return Promise.resolve({ status: 200, body: JSON.stringify({ data: { repository: security } }) });
    }
    for (const [slug, fake] of Object.entries(repositories)) {
      const answer = answerFor(`repos/${slug}`, fake, path, raw);
      if (answer !== null) return Promise.resolve(answer);
    }
    return Promise.resolve({ status: 404, body: '{"message":"Not Found"}' });
  };
}

function answerFor(address: string, fake: FakeRepository, path: string, raw: boolean): GithubAnswer | null {
  const ok = (body: unknown): GithubAnswer => ({ status: 200, body: JSON.stringify(body) });
  if (path === address) {
    return ok({ default_branch: "main", private: false, permissions: { admin: true }, ...fake.repository });
  }
  if (path === `${address}/git/trees/main?recursive=1`) {
    const tree = Object.entries(fake.files).map(([filePath, content]) => ({
      path: filePath,
      type: "blob",
      sha: gitBlobSha(content),
    }));
    return ok({ truncated: false, tree });
  }
  if (path === `${address}/labels?per_page=100&page=1`) return ok(fake.labels.map((name) => ({ name })));
  const extra = path.startsWith(`${address}/`) ? fake.answers?.[path.slice(address.length + 1)] : undefined;
  if (extra !== undefined) return ok(extra);
  const contents = new RegExp(`^${address}/contents/(.+)\\?ref=main$`).exec(path);
  const content = contents === null ? undefined : fake.files[decodeURIComponent(contents[1] ?? "")];
  if (raw && content !== undefined) return { status: 200, body: content };
  return null;
}

/**
 * A fake GitHub API that takes every direct fix: it answers the reads of a commit with made-up
 * SHAs, and every change with 204. It changes nothing, so a report stays the same.
 */
export function fakeGithubWrite(): GithubWrite {
  return (method, path) => {
    const ok = (body: unknown): Promise<GithubAnswer> => Promise.resolve({ status: 200, body: JSON.stringify(body) });
    if (method === "GET" && path.includes("/git/ref/heads/")) return ok({ object: { sha: "head" } });
    if (method === "GET" && path.includes("/git/commits/")) return ok({ tree: { sha: "tree" } });
    if (method === "GET" && path.includes("/git/blobs/")) return ok({ content: "", encoding: "base64" });
    if (method === "GET" && path.includes("/labels?")) return ok([]);
    if (method === "POST" && /\/git\/(trees|commits)$/.test(path)) return ok({ sha: "new" });
    return Promise.resolve({ status: 204, body: "" });
  };
}

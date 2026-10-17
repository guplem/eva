/**
 * A fake GitHub API for the setup report: each repository answers its main address, its tree,
 * its labels and its file contents. Every other address answers 404.
 */
import type { GithubAnswer, GithubGet } from "../../src/core/projects/repository-facts.ts";
import { gitBlobSha } from "../../src/core/projects/repository-setup.ts";

export interface FakeRepository {
  /** Fields of `GET repos/{slug}` on top of a public repository where Eva is admin. */
  readonly repository?: Readonly<Record<string, unknown>>;
  /** Each file path and its content. */
  readonly files: Readonly<Record<string, string>>;
  readonly labels: readonly string[];
}

export function fakeGithub(repositories: Readonly<Record<string, FakeRepository>>): GithubGet {
  return (path, raw = false) => {
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
  const contents = new RegExp(`^${address}/contents/(.+)\\?ref=main$`).exec(path);
  const content = contents === null ? undefined : fake.files[decodeURIComponent(contents[1] ?? "")];
  if (raw && content !== undefined) return { status: 200, body: content };
  return null;
}

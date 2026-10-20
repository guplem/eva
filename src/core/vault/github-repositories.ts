/**
 * The person's GitHub repositories, through the GitHub API with the setup login token: setup lists
 * them to pick the vault, and creates a private one for a new vault, with no GitHub CLI. Eva also
 * reads the account, for the name and email of her commits.
 */
import { EvaError } from "../../shared/errors.ts";

export interface GitHubRepository {
  /** Such as `you/vault`. */
  readonly fullName: string;
  /** The HTTPS address, which Eva's git credential helper can use with the token. */
  readonly cloneUrl: string;
  readonly private: boolean;
}

export interface GitHubApiOptions {
  readonly token: string;
  /** The GitHub API address; a test points it at a fake server. */
  readonly baseUrl?: string;
  /** A test makes it short. */
  readonly requestTimeoutMs?: number;
}

const requestTimeoutMs = 30_000;
// The letters that GitHub keeps in a repository name; it silently changes the others.
const repositoryName = /^[A-Za-z0-9._-]{1,100}$/;

/** The repositories that the token can reach, pushed most recently first, with no archived one. */
export async function listGitHubRepositories(options: GitHubApiOptions): Promise<GitHubRepository[]> {
  // One page holds the repositories that a person is likely to pick; a typed address covers the rest.
  const body = await request(options, "GET", "/user/repos?sort=pushed&per_page=100");
  if (!Array.isArray(body)) throw new EvaError("github_failed", "GitHub sent a list that Eva cannot read.");
  // Eva must push to the vault, and GitHub refuses a push to an archived repository.
  return body.flatMap((item: unknown) => {
    const repository = repositoryOf(item);
    return repository === null || (item as Record<string, unknown>)["archived"] === true ? [] : [repository];
  });
}

/** Creates an empty private repository for a new vault. */
export async function createGitHubRepository(
  options: GitHubApiOptions & { readonly name: string },
): Promise<GitHubRepository> {
  if (!repositoryName.test(options.name)) {
    throw new EvaError(
      "github_failed",
      `GitHub cannot name a repository "${options.name}". Use only letters, digits, dots, dashes and underscores.`,
    );
  }
  // No first commit on GitHub, so the push of the local vault's main is a fast-forward.
  const body = await request(options, "POST", "/user/repos", { name: options.name, private: true, auto_init: false });
  const repository = repositoryOf(body);
  if (repository === null) throw new EvaError("github_failed", "GitHub sent an answer that Eva cannot read.");
  return repository;
}

export interface GitHubAccount {
  readonly id: number;
  readonly login: string;
  /** Null when the account has no display name. */
  readonly name: string | null;
}

/** Only the id, login and name of the token's account: the commit identity needs no more. */
export async function readGitHubAccount(options: GitHubApiOptions): Promise<GitHubAccount> {
  const body = await request(options, "GET", "/user");
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const { id, login, name } = fields;
  if (typeof id !== "number" || typeof login !== "string") {
    throw new EvaError("github_failed", "GitHub sent an account that Eva cannot read.");
  }
  return { id, login, name: typeof name === "string" && name.trim() !== "" ? name : null };
}

async function request(
  options: GitHubApiOptions,
  method: "GET" | "POST",
  path: string,
  fields?: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${options.baseUrl ?? "https://api.github.com"}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        // GitHub refuses a request with no user agent.
        "user-agent": "eva",
        ...(fields === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(fields === undefined ? {} : { body: JSON.stringify(fields) }),
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? requestTimeoutMs),
    });
  } catch (error) {
    throw new EvaError("github_failed", "Eva could not reach GitHub. Check the network, then try again.", {
      cause: error,
    });
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && body !== null) return body;
  const reason = describe(body);
  throw new EvaError(
    "github_failed",
    reason === null
      ? `GitHub sent an answer that Eva cannot read (HTTP ${String(response.status)}).`
      : `GitHub refused the request (HTTP ${String(response.status)}): ${reason}`,
  );
}

function repositoryOf(item: unknown): GitHubRepository | null {
  if (typeof item !== "object" || item === null) return null;
  const fields = item as Record<string, unknown>;
  if (typeof fields["full_name"] !== "string" || typeof fields["clone_url"] !== "string") return null;
  return { fullName: fields["full_name"], cloneUrl: fields["clone_url"], private: fields["private"] === true };
}

/** GitHub's messages, the detailed ones first, such as "name already exists on this account". */
function describe(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as Record<string, unknown>;
  const details = Array.isArray(fields["errors"])
    ? fields["errors"].flatMap((error: unknown) =>
        typeof error === "object" && error !== null && typeof (error as Record<string, unknown>)["message"] === "string"
          ? [(error as Record<string, string>)["message"]]
          : [],
      )
    : [];
  const messages = [...details, ...(typeof fields["message"] === "string" ? [fields["message"]] : [])];
  return messages.length === 0 ? null : messages.join(". ");
}

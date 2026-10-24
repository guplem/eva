import { afterEach, describe, expect, test } from "bun:test";
import {
  createGitHubRepository,
  listGitHubRepositories,
  readGitHubAccount,
} from "../../../../src/core/vault/github-repositories.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

interface FakeReply {
  readonly status: number;
  /** A string is sent as is, such as an HTML error page; anything else as JSON. */
  readonly body: unknown;
}

interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

let server: ReturnType<typeof Bun.serve> | null = null;
afterEach(async () => {
  await server?.stop(true);
  server = null;
});

/** A fake GitHub API that answers each request with `reply`. */
function fakeApi(reply: FakeReply): { baseUrl: string; requests: SeenRequest[] } {
  const requests: SeenRequest[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: request.headers,
        body: await request.text(),
      });
      return typeof reply.body === "string"
        ? new Response(reply.body, { status: reply.status })
        : Response.json(reply.body, { status: reply.status });
    },
  });
  return { baseUrl: `http://127.0.0.1:${String(server.port)}`, requests };
}

function repository(fullName: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: fullName,
    clone_url: `https://github.com/${fullName}.git`,
    private: true,
    archived: false,
    continuedFrom: null,
    firstMessageDraft: null,
    ...extra,
  };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isEvaError(error, "github_failed")) return error.message;
    throw error;
  }
  throw new Error("The call did not fail.");
}

describe("listGitHubRepositories", () => {
  test("lists the repositories pushed most recently, with the token in the header", async () => {
    const api = fakeApi({
      status: 200,
      body: [repository("you/vault"), repository("team/notes", { private: false })],
    });

    const repositories = await listGitHubRepositories({ token: "secret-token", baseUrl: api.baseUrl });

    expect(repositories).toEqual([
      { fullName: "you/vault", cloneUrl: "https://github.com/you/vault.git", private: true },
      { fullName: "team/notes", cloneUrl: "https://github.com/team/notes.git", private: false },
    ]);
    expect(api.requests[0]?.path).toBe("/user/repos?sort=pushed&per_page=100");
    expect(api.requests[0]?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(api.requests[0]?.headers.get("user-agent")).toBeTruthy();
  });

  test("skips archived repositories, which Eva cannot push to", async () => {
    const api = fakeApi({ status: 200, body: [repository("you/old", { archived: true }), repository("you/vault")] });

    const repositories = await listGitHubRepositories({ token: "secret-token", baseUrl: api.baseUrl });

    expect(repositories.map((each) => each.fullName)).toEqual(["you/vault"]);
  });

  test("a refused token fails with GitHub's message, never the token", async () => {
    const api = fakeApi({ status: 403, body: { message: "Resource not accessible by personal access token" } });

    const message = await failure(listGitHubRepositories({ token: "secret-token", baseUrl: api.baseUrl }));

    expect(message).toContain("Resource not accessible by personal access token");
    expect(message).not.toContain("secret-token");
  });

  test("an answer that is not JSON fails with the HTTP status", async () => {
    const api = fakeApi({ status: 502, body: "<html>Bad gateway</html>" });

    expect(await failure(listGitHubRepositories({ token: "secret-token", baseUrl: api.baseUrl }))).toContain("502");
  });

  test("no network fails with a clear message", async () => {
    const message = await failure(
      listGitHubRepositories({ token: "secret-token", baseUrl: "http://127.0.0.1:9", requestTimeoutMs: 2000 }),
    );

    expect(message).toContain("could not reach GitHub");
  });
});

describe("createGitHubRepository", () => {
  test("creates an empty private repository", async () => {
    const api = fakeApi({ status: 201, body: repository("you/vault") });

    const created = await createGitHubRepository({ token: "secret-token", name: "vault", baseUrl: api.baseUrl });

    expect(created).toEqual({ fullName: "you/vault", cloneUrl: "https://github.com/you/vault.git", private: true });
    expect(api.requests[0]?.method).toBe("POST");
    expect(api.requests[0]?.path).toBe("/user/repos");
    // No first commit on GitHub, so the push of the local main is a fast-forward.
    expect(JSON.parse(api.requests[0]?.body ?? "{}")).toEqual({ name: "vault", private: true, auto_init: false });
  });

  test("a project repository gets a first commit and a description", async () => {
    const api = fakeApi({ status: 201, body: repository("you/example-app") });

    await createGitHubRepository({
      token: "secret-token",
      name: "example-app",
      description: "An example app.",
      initialize: true,
      baseUrl: api.baseUrl,
    });

    expect(JSON.parse(api.requests[0]?.body ?? "{}")).toEqual({
      name: "example-app",
      description: "An example app.",
      private: true,
      auto_init: true,
    });
  });

  test("a name that exists says so", async () => {
    const api = fakeApi({
      status: 422,
      body: {
        message: "Repository creation failed.",
        errors: [
          { resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" },
        ],
      },
    });

    const message = await failure(
      createGitHubRepository({ token: "secret-token", name: "vault", baseUrl: api.baseUrl }),
    );

    expect(message).toContain("name already exists on this account");
  });

  test("a name that GitHub cannot take fails before any request", async () => {
    const api = fakeApi({ status: 201, body: repository("you/vault") });

    const message = await failure(
      createGitHubRepository({ token: "secret-token", name: "my vault", baseUrl: api.baseUrl }),
    );

    expect(message).toContain("my vault");
    expect(api.requests).toHaveLength(0);
  });
});

describe("readGitHubAccount", () => {
  test("reads the id, the login and the name of the token's account", async () => {
    const api = fakeApi({ status: 200, body: { id: 1234, login: "example-user", name: "Example User", plan: {} } });

    const account = await readGitHubAccount({ token: "secret-token", baseUrl: api.baseUrl });

    expect(account).toEqual({ id: 1234, login: "example-user", name: "Example User" });
    expect(api.requests[0]?.path).toBe("/user");
    expect(api.requests[0]?.headers.get("authorization")).toBe("Bearer secret-token");
  });

  test("an account with no name has a null name", async () => {
    const api = fakeApi({ status: 200, body: { id: 1234, login: "example-user", name: null } });

    expect(await readGitHubAccount({ token: "secret-token", baseUrl: api.baseUrl })).toEqual({
      id: 1234,
      login: "example-user",
      name: null,
    });
  });

  test("an answer with no id or login fails", async () => {
    const api = fakeApi({ status: 200, body: [] });

    expect(await failure(readGitHubAccount({ token: "secret-token", baseUrl: api.baseUrl }))).toContain("cannot read");
  });
});

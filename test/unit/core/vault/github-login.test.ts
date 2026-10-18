import { afterEach, describe, expect, test } from "bun:test";
import { githubDeviceLogin, type GitHubLoginOptions } from "../../../../src/core/vault/github-login.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

type Reply = Record<string, unknown>;

let server: ReturnType<typeof Bun.serve> | null = null;
afterEach(async () => {
  await server?.stop(true);
  server = null;
});

/**
 * A fake GitHub: the code request gets `codeReply`, and each poll gets the next of `pollReplies`.
 * A null reply is an HTML error page. As on GitHub, a request without the JSON header gets form encoding.
 */
function fakeGitHub(
  pollReplies: (Reply | null)[],
  codeReply: Reply = {},
): { baseUrl: string; requests: URLSearchParams[] } {
  const requests: URLSearchParams[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requests.push(new URLSearchParams(await request.text()));
      const reply =
        new URL(request.url).pathname === "/login/device/code"
          ? {
              device_code: "device-code",
              user_code: "ABCD-1234",
              verification_uri: "https://github.com/login/device",
              expires_in: 900,
              interval: 5,
              ...codeReply,
            }
          : pollReplies.length > 0
            ? pollReplies.shift()
            : { error: "authorization_pending" };
      if (reply === null) return new Response("<html>Bad gateway</html>", { status: 502 });
      if (request.headers.get("accept") !== "application/json") {
        return new Response(new URLSearchParams(reply as Record<string, string>).toString());
      }
      return Response.json(reply);
    },
  });
  return { baseUrl: `http://127.0.0.1:${String(server.port)}`, requests };
}

function login(
  baseUrl: string,
  extra: Partial<GitHubLoginOptions> = {},
): { result: Promise<string>; shown: string[]; slept: number[] } {
  const shown: string[] = [];
  const slept: number[] = [];
  let now = 0;
  const result = githubDeviceLogin({
    clientId: "client-id-for-tests",
    baseUrl,
    show: (code, link) => shown.push(`${code} ${link}`),
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
    clock: { now: () => new Date(now) },
    ...extra,
  });
  return { result, shown, slept };
}

async function failure(result: Promise<string>): Promise<unknown> {
  return result.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("the GitHub browser login", () => {
  test("shows the code and the link, waits, and returns the token", async () => {
    const github = fakeGitHub([
      { error: "authorization_pending" },
      { access_token: "gho_token", token_type: "bearer" },
    ]);
    const { result, shown, slept } = login(github.baseUrl);
    expect(await result).toBe("gho_token");
    expect(shown).toEqual(["ABCD-1234 https://github.com/login/device"]);
    expect(slept).toEqual([5000, 5000]);
    expect(github.requests[0]?.get("client_id")).toBe("client-id-for-tests");
    expect(github.requests[0]?.get("scope")).toBe("repo");
    expect(github.requests[1]?.get("device_code")).toBe("device-code");
    expect(github.requests[1]?.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });

  test("waits longer after slow_down, as GitHub asks", async () => {
    const github = fakeGitHub([
      { error: "slow_down", interval: 10 },
      { error: "slow_down" },
      { access_token: "gho_t" },
    ]);
    const { result, slept } = login(github.baseUrl);
    expect(await result).toBe("gho_t");
    expect(slept).toEqual([5000, 10_000, 15_000]);
  });

  test("a refused login is an error that says so", async () => {
    const github = fakeGitHub([{ error: "access_denied" }]);
    const error = await failure(login(github.baseUrl).result);
    expect(isEvaError(error, "github_failed")).toBe(true);
    expect(String(error)).toContain("refused");
  });

  test("an expired code is an error, from GitHub or from the clock", async () => {
    const expired = await failure(login(fakeGitHub([{ error: "expired_token" }]).baseUrl).result);
    expect(isEvaError(expired, "github_failed")).toBe(true);
    expect(String(expired)).toContain("expired");
    await server?.stop(true);
    // GitHub keeps saying "pending": the code's own lifetime ends the wait.
    const late = await failure(login(fakeGitHub([], { expires_in: 12 }).baseUrl).result);
    expect(String(late)).toContain("expired");
  });

  test("an unknown answer and a missing code are errors", async () => {
    const unknown = await failure(login(fakeGitHub([{ error: "unsupported_grant_type" }]).baseUrl).result);
    expect(String(unknown)).toContain("unsupported_grant_type");
    await server?.stop(true);
    const noCode = await failure(
      login(fakeGitHub([], { error: "device_flow_disabled", user_code: null }).baseUrl).result,
    );
    expect(isEvaError(noCode, "github_failed")).toBe(true);
    expect(String(noCode)).toContain("device_flow_disabled");
    await server?.stop(true);
    // A wrong client id gets a message, with no error code.
    const wrongId = await failure(
      login(fakeGitHub([], { error: undefined, message: "Not Found", user_code: null }).baseUrl).result,
    );
    expect(String(wrongId)).toContain("GitHub did not start the login: Not Found.");
  });

  test("a confirmation in the last seconds of the code still counts", async () => {
    const github = fakeGitHub([{ error: "authorization_pending" }, { access_token: "gho_late" }], { expires_in: 10 });
    expect(await login(github.baseUrl).result).toBe("gho_late");
  });

  test("a short loss of GitHub while it waits is not the end of the login", async () => {
    const github = fakeGitHub([null, null, { access_token: "gho_after_a_gap" }]);
    expect(await login(github.baseUrl).result).toBe("gho_after_a_gap");
    await server?.stop(true);
    const lastGitHub = fakeGitHub([null, null, null]);
    const gone = await failure(login(lastGitHub.baseUrl).result);
    expect(isEvaError(gone, "github_failed")).toBe(true);
    expect(String(gone)).toContain("GitHub sent an answer that Eva cannot read (HTTP 502)");
    expect(lastGitHub.requests).toHaveLength(4);
    await server?.stop(true);
    // Good polls in between start the count again.
    const between = fakeGitHub([null, null, { error: "authorization_pending" }, null, null, { access_token: "gho_t" }]);
    expect(await login(between.baseUrl).result).toBe("gho_t");
  });

  test("an error never shows the device code", async () => {
    const github = fakeGitHub([{ error: "incorrect_device_code", device_code: "device-code" }]);
    const error = await failure(login(github.baseUrl).result);
    expect(String(error)).toContain("incorrect_device_code");
    expect(String(error)).not.toContain("device-code");
  });

  test("GitHub out of reach, or too slow, is an error", async () => {
    const offline = await failure(login("http://127.0.0.1:1").result);
    expect(isEvaError(offline, "github_failed")).toBe(true);
    expect(String(offline)).toContain("could not reach GitHub");
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => undefined) });
    const slow = await failure(login(`http://127.0.0.1:${String(server.port)}`, { requestTimeoutMs: 20 }).result);
    expect(String(slow)).toContain("could not reach GitHub");
  });
});

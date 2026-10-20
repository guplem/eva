import { describe, expect, test } from "bun:test";
import { GitHubBrowserLogin, type DeviceLogin } from "../../../../src/core/vault/github-browser-login.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";

/** A device flow that the test steers: it shows the code at once, then waits for `confirm` or `fail`. */
function fakeDeviceFlow(): {
  login: DeviceLogin;
  starts: () => number;
  confirm: (token: string) => void;
  fail: (error: Error) => void;
  /** Runs the flow's next sleep, as a poll would. */
  poll: () => Promise<void>;
} {
  let starts = 0;
  let resolve: (token: string) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  let sleep: ((ms: number) => Promise<void>) | null = null;
  const login: DeviceLogin = (show, sleepOf) => {
    starts += 1;
    sleep = sleepOf;
    show(`CODE-${String(starts)}`, "https://github.com/login/device");
    return new Promise<string>((ok, no) => {
      resolve = ok;
      reject = no;
    });
  };
  return {
    login,
    starts: () => starts,
    confirm: (token) => resolve(token),
    fail: (error) => reject(error),
    poll: async () => {
      try {
        await sleep?.(5000);
      } catch (error) {
        reject(error as Error);
      }
    },
  };
}

function makeLogin(
  login: DeviceLogin | null,
  save: (token: string) => Promise<void> = () => Promise.resolve(),
): GitHubBrowserLogin {
  return new GitHubBrowserLogin({ login, save, sleep: () => Promise.resolve() });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("the GitHub browser login of the page", () => {
  test("start gives the code and the link; the token is saved when GitHub gives it", async () => {
    const flow = fakeDeviceFlow();
    const saved: string[] = [];
    const login = makeLogin(flow.login, (token) => {
      saved.push(token);
      return Promise.resolve();
    });
    expect(await login.start()).toEqual({ code: "CODE-1", url: "https://github.com/login/device" });
    flow.confirm("gho_token");
    await login.finish();
    expect(saved).toEqual(["gho_token"]);
  });

  test("the token is saved even when the page never asks for the end", async () => {
    const flow = fakeDeviceFlow();
    const saved: string[] = [];
    const login = makeLogin(flow.login, (token) => {
      saved.push(token);
      return Promise.resolve();
    });
    await login.start();
    flow.confirm("gho_token");
    await Bun.sleep(0);
    expect(saved).toEqual(["gho_token"]);
  });

  test("a second start while the login waits gives the same code, so a reload keeps it", async () => {
    const flow = fakeDeviceFlow();
    const login = makeLogin(flow.login);
    const first = await login.start();
    expect(await login.start()).toEqual(first);
    expect(flow.starts()).toBe(1);
  });

  test("a start after the end makes a new code", async () => {
    const flow = fakeDeviceFlow();
    const login = makeLogin(flow.login);
    await login.start();
    flow.confirm("gho_token");
    await login.finish();
    expect((await login.start()).code).toBe("CODE-2");
  });

  test("two waits for the end get the same result", async () => {
    const flow = fakeDeviceFlow();
    const saved: string[] = [];
    const login = makeLogin(flow.login, (token) => {
      saved.push(token);
      return Promise.resolve();
    });
    await login.start();
    const both = Promise.all([login.finish(), login.finish()]);
    flow.confirm("gho_token");
    await both;
    expect(saved).toEqual(["gho_token"]);
  });

  test("a wait that comes again after the end gets the same result, as after a lost request", async () => {
    const flow = fakeDeviceFlow();
    const saved: string[] = [];
    const login = makeLogin(flow.login, (token) => {
      saved.push(token);
      return Promise.resolve();
    });
    await login.start();
    flow.confirm("gho_token");
    await login.finish();
    // A phone lost the first answer, and the page asks again.
    await login.finish();
    expect(saved).toEqual(["gho_token"]);
  });

  test("a failure reaches the page, even when it comes before the page asks", async () => {
    const flow = fakeDeviceFlow();
    const login = makeLogin(flow.login);
    await login.start();
    flow.fail(new EvaError("github_failed", "The GitHub login code expired."));
    await Bun.sleep(0);
    const error = await failure(login.finish());
    expect(isEvaError(error, "github_failed")).toBe(true);
    expect(String(error)).toContain("expired");
    // The failed login is over: the next start makes a new code.
    expect((await login.start()).code).toBe("CODE-2");
  });

  test("a failure before the code reaches start", async () => {
    const login = makeLogin(() => Promise.reject(new EvaError("github_failed", "GitHub did not start the login.")));
    const error = await failure(login.start());
    expect(isEvaError(error, "github_failed")).toBe(true);
  });

  test("the end with no login says so", async () => {
    const error = await failure(makeLogin(fakeDeviceFlow().login).finish());
    expect(isEvaError(error, "github_failed")).toBe(true);
    expect(String(error)).toContain("shows the saved token");
  });

  test("with no OAuth App, start points to a pasted token", async () => {
    const error = await failure(makeLogin(null).start());
    expect(isEvaError(error, "github_failed")).toBe(true);
    expect(String(error)).toContain("token");
  });

  test("stop ends the wait at the next poll, and saves nothing", async () => {
    const flow = fakeDeviceFlow();
    const saved: string[] = [];
    const login = makeLogin(flow.login, (token) => {
      saved.push(token);
      return Promise.resolve();
    });
    await login.start();
    const end = failure(login.finish());
    login.stop();
    await flow.poll();
    expect(isEvaError(await end, "github_failed")).toBe(true);
    flow.confirm("gho_late");
    await Bun.sleep(0);
    expect(saved).toEqual([]);
  });
});

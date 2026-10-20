/**
 * The GitHub browser login of the web page. It runs the device flow of `eva setup` in the
 * background: the page shows the code, the person confirms it on any device, and Eva saves the
 * token as soon as GitHub gives it. A phone may close the page meanwhile, so the save never waits
 * for the page.
 */
import { EvaError } from "../../shared/errors.ts";

/** The device flow, such as `githubDeviceLogin` with Eva's client id. It waits only in `sleep`. */
export type DeviceLogin = (
  show: (code: string, url: string) => void,
  sleep: (ms: number) => Promise<void>,
) => Promise<string>;

export interface GitHubBrowserLoginOptions {
  /** Null while Eva has no OAuth App (#113). */
  readonly login: DeviceLogin | null;
  readonly sleep: (ms: number) => Promise<void>;
  /** Saves the token, as a pasted one. */
  readonly save: (token: string) => Promise<void>;
}

interface Attempt {
  readonly shown: Promise<{ code: string; url: string }>;
  readonly done: Promise<void>;
  settled: boolean;
}

export class GitHubBrowserLogin {
  private readonly options: GitHubBrowserLoginOptions;
  /** One person, so one login at a time. */
  private current: Attempt | null;

  constructor(options: GitHubBrowserLoginOptions) {
    this.options = options;
    this.current = null;
  }

  /** Starts the login, or gives the code of the login that waits: a reload must not void a typed code. */
  start(): Promise<{ code: string; url: string }> {
    if (this.current !== null && !this.current.settled) return this.current.shown;
    const { login } = this.options;
    if (login === null)
      return Promise.reject(
        new EvaError("github_failed", "This Eva has no GitHub browser login. Paste a token instead."),
      );
    let show: (shown: { code: string; url: string }) => void = () => undefined;
    const shown = new Promise<{ code: string; url: string }>((resolve) => {
      show = resolve;
    });
    // A stopped login ends at its next poll; a reply already on its way is not saved.
    const sleep = async (ms: number): Promise<void> => {
      await this.options.sleep(ms);
      if (this.current !== attempt) throw stopped();
    };
    const done = login((code, url) => show({ code, url }), sleep).then((token) => {
      if (this.current !== attempt) throw stopped();
      return this.options.save(token);
    });
    const attempt: Attempt = {
      shown: Promise.race([shown, done.then(() => shown)]),
      done: done.finally(() => {
        attempt.settled = true;
      }),
      settled: false,
    };
    // A page that never asks for the end must not leave an unhandled rejection.
    attempt.done.catch(() => undefined);
    this.current = attempt;
    return attempt.shown;
  }

  /** Waits until the token is saved, or the login fails. */
  async finish(): Promise<void> {
    const attempt = this.current;
    if (attempt === null)
      throw new EvaError("github_failed", "No GitHub login waits. Press Log in with GitHub to start one.");
    try {
      await attempt.done;
    } finally {
      if (this.current === attempt) this.current = null;
    }
  }

  stop(): void {
    this.current = null;
  }
}

function stopped(): EvaError {
  return new EvaError("github_failed", "The GitHub login stopped. Press Log in with GitHub to start again.");
}

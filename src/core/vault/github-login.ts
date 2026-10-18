/**
 * The GitHub browser login (the device flow): GitHub gives a short code, the person confirms it
 * at github.com/login/device on any device, and Eva gets a token with no hand-made token.
 */
import type { Clock } from "../../shared/clock.ts";
import { EvaError } from "../../shared/errors.ts";

/**
 * The public client id of the Eva OAuth App, which has the device flow on. A client id is not a
 * secret. Null until the owner registers the app (#113): setup then asks for a pasted token.
 */
export const githubClientId: string | null = null;

/** The one sentence that setup says before the login. It must match `scope` below. */
export const githubLoginAccess =
  "The login lets Eva read and write all your GitHub repositories, private ones too. Eva uses it only to reach GitHub for you, and never gives it to the AI tools that she runs.";

export interface GitHubLoginOptions {
  readonly clientId: string;
  /** Tells the person the code and the page where they enter it. */
  readonly show: (code: string, link: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly clock: Clock;
  /** The GitHub address; a test points it at a fake server. */
  readonly baseUrl?: string;
  /** A test makes it short. */
  readonly requestTimeoutMs?: number;
}

const requestTimeoutMs = 30_000;
// GitHub asks for 5 more seconds after each slow_down.
const slowDownStepSeconds = 5;
const scope = "repo";
// Three failed polls in a row: from about 15 seconds when GitHub fails at once, to about 2 minutes when each request times out.
const maxFailedPolls = 3;

/** Waits until the person confirms the code, then returns the token. */
export async function githubDeviceLogin(options: GitHubLoginOptions): Promise<string> {
  const code = await post(options, "/login/device/code", { client_id: options.clientId, scope });
  if (typeof code["device_code"] !== "string" || typeof code["user_code"] !== "string") {
    throw new EvaError("github_failed", `GitHub did not start the login: ${describe(code)}.`);
  }
  const deviceCode = code["device_code"];
  const link =
    typeof code["verification_uri"] === "string" ? code["verification_uri"] : "https://github.com/login/device";
  options.show(code["user_code"], link);
  const deadline = options.clock.now().getTime() + seconds(code["expires_in"], 900) * 1000;
  let interval = seconds(code["interval"], slowDownStepSeconds);
  let failedPolls = 0;
  for (;;) {
    await options.sleep(interval * 1000);
    let reply: Record<string, unknown>;
    try {
      reply = await post(options, "/login/oauth/access_token", {
        client_id: options.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      failedPolls = 0;
    } catch (error) {
      // The person can confirm the code on another device while this one loses the network for a moment.
      failedPolls += 1;
      if (failedPolls >= maxFailedPolls) throw error;
      reply = { error: "authorization_pending" };
    }
    if (typeof reply["access_token"] === "string") return reply["access_token"];
    if (reply["error"] === "expired_token") break;
    if (reply["error"] === "access_denied") throw new EvaError("github_failed", "The GitHub login was refused.");
    if (reply["error"] === "slow_down") interval = seconds(reply["interval"], interval + slowDownStepSeconds);
    else if (reply["error"] !== "authorization_pending") {
      throw new EvaError("github_failed", `The GitHub login failed: ${describe(reply)}.`);
    }
    // After the poll, so a confirmation in the last seconds still counts.
    if (options.clock.now().getTime() >= deadline) break;
  }
  throw new EvaError("github_failed", "The GitHub login code expired.");
}

async function post(
  options: GitHubLoginOptions,
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${options.baseUrl ?? "https://github.com"}${path}`, {
      method: "POST",
      // Without this header, GitHub answers in form encoding.
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? requestTimeoutMs),
    });
  } catch (error) {
    throw new EvaError("github_failed", "Eva could not reach GitHub. Check the network, then try again.", {
      cause: error,
    });
  }
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    throw new EvaError(
      "github_failed",
      `GitHub sent an answer that Eva cannot read (HTTP ${String(response.status)}).`,
    );
  }
  return body as Record<string, unknown>;
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

/** GitHub's error code or message, never the whole reply, which can hold a device code. */
function describe(reply: Record<string, unknown>): string {
  if (typeof reply["error"] === "string") return reply["error"];
  return typeof reply["message"] === "string" ? reply["message"] : "no answer";
}

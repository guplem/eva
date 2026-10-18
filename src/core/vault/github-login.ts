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
  "The login lets Eva read and write all your GitHub repositories, private ones too. Eva uses it only for her own git commands, and never gives it to an agent.";

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
  for (;;) {
    await options.sleep(interval * 1000);
    if (options.clock.now().getTime() >= deadline) break;
    const reply = await post(options, "/login/oauth/access_token", {
      client_id: options.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (typeof reply["access_token"] === "string") return reply["access_token"];
    if (reply["error"] === "authorization_pending") continue;
    if (reply["error"] === "slow_down") {
      interval = seconds(reply["interval"], interval + slowDownStepSeconds);
      continue;
    }
    if (reply["error"] === "expired_token") break;
    if (reply["error"] === "access_denied") throw new EvaError("github_failed", "The GitHub login was refused.");
    throw new EvaError("github_failed", `The GitHub login failed: ${describe(reply)}.`);
  }
  throw new EvaError("github_failed", "The GitHub login code expired. Run setup again to get a new one.");
}

async function post(
  options: GitHubLoginOptions,
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${options.baseUrl ?? "https://github.com"}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? requestTimeoutMs),
    });
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch (error) {
    throw new EvaError("github_failed", "Eva could not reach GitHub. Check the network, then try again.", {
      cause: error,
    });
  }
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

/** GitHub's error code, never the whole reply, which can hold a device code. */
function describe(reply: Record<string, unknown>): string {
  return typeof reply["error"] === "string" ? reply["error"] : "no answer";
}

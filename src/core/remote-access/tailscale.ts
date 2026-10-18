/**
 * Phone access through Tailscale: Eva reads the machine's Tailscale state and publishes her web
 * UI inside the tailnet only.
 */
import { posix, win32 } from "node:path";
import { isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

/** What Tailscale says about this machine, when it runs and is logged in. */
export interface TailscaleFacts {
  /** This machine's name in the tailnet, such as `server.example-tailnet.ts.net`. */
  readonly hostName: string;
  /** The account that owns this machine, such as `person@example.com`. */
  readonly ownerLogin: string | null;
  /** False until the tailnet turns HTTPS on; `tailscale serve` then waits for a person instead of failing. */
  readonly httpsEnabled: boolean;
}

export type TailscaleState =
  | { readonly kind: "missing" }
  | { readonly kind: "stopped"; readonly detail: string }
  /** Tailscale has a link only after `tailscale up` asked for one. */
  | { readonly kind: "needs_login"; readonly loginUrl: string | null }
  | { readonly kind: "running"; readonly facts: TailscaleFacts };

/** How Eva runs Tailscale: the program, with a socket flag for her own userspace install. */
export interface TailscaleContext {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly program: readonly string[];
}

/** The outcome of `tailscale serve`: the address, or the problem and the page that fixes it. */
export interface PublishResult {
  readonly url: string | null;
  readonly problem: string | null;
  readonly link: string | null;
}

const tailscaleTimeoutMs = 10_000;
/** `tailscale up` waits this long for a sign-in link, then stops; the daemon keeps waiting for the sign-in. */
const signInWaitSeconds = 15;
const defaultPort = 7420;
export const enableHttpsPage = "https://login.tailscale.com/admin/dns";
const loginLinkPattern = /https:\/\/login\.tailscale\.com\/\S+/;
const operatorFix =
  "Tailscale runs for the administrator here and refuses Eva. Run `sudo tailscale set --operator=$USER` once on this machine.";

/** The folders of Eva's userspace install on Linux, which needs no root. */
export function userspaceFolders(homeFolder: string): { lib: string; state: string; socket: string } {
  const state = posix.join(homeFolder, ".local", "share", "tailscale");
  return {
    lib: posix.join(homeFolder, ".local", "lib", "tailscale"),
    state,
    socket: posix.join(state, "tailscaled.sock"),
  };
}

/**
 * The program that runs Tailscale. Eva's PATH does not change after an install, so the
 * places where the installers put Tailscale come before the bare name.
 */
export function findTailscale(input: {
  readonly platform: NodeJS.Platform;
  readonly homeFolder: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly exists: (path: string) => boolean;
  readonly which: (name: string) => string | null;
}): string[] {
  if (input.platform === "win32") {
    const onPath = input.which("tailscale");
    if (onPath !== null) return [onPath];
    const programFiles = input.environment["ProgramFiles"] ?? input.environment["PROGRAMFILES"];
    const installed = programFiles === undefined ? null : win32.join(programFiles, "Tailscale", "tailscale.exe");
    return installed !== null && input.exists(installed) ? [installed] : ["tailscale"];
  }
  // Eva's own install runs through its own socket: the wrapper script may not be on a service's PATH.
  const folders = userspaceFolders(input.homeFolder);
  const own = posix.join(folders.lib, "tailscale");
  if (input.exists(own)) return [own, `--socket=${folders.socket}`];
  return ["tailscale"];
}

/** Every state of Tailscale on this machine; a bad answer means a daemon that does not run. */
export async function readTailscaleState(context: TailscaleContext): Promise<TailscaleState> {
  let stdout: string;
  try {
    const result = await context.runner.run([...context.program, "status", "--json"], {
      cwd: ".",
      environment: context.environment,
      timeoutMs: tailscaleTimeoutMs,
    });
    if (result.exitCode !== 0) return { kind: "stopped", detail: firstLine(`${result.stderr}\n${result.stdout}`) };
    stdout = result.stdout;
  } catch (error) {
    if (isEvaError(error, "process_failed")) return { kind: "missing" };
    return { kind: "stopped", detail: error instanceof Error ? error.message : String(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  // A bad answer never crashes Eva: `null` parses too, but it has no fields.
  if (typeof parsed !== "object" || parsed === null)
    return { kind: "stopped", detail: "tailscale status gave no JSON" };
  const status = parsed as {
    BackendState?: unknown;
    AuthURL?: unknown;
    CertDomains?: unknown;
    Self?: { DNSName?: unknown; UserID?: unknown };
    User?: Record<string, { LoginName?: unknown } | undefined>;
  };
  const backend = status.BackendState;
  if (backend === "NeedsLogin") {
    // Only Tailscale's own login page: the link lets anyone who opens it take this machine.
    const link = status.AuthURL;
    return {
      kind: "needs_login",
      loginUrl: typeof link === "string" && loginLinkPattern.exec(link)?.[0] === link ? link : null,
    };
  }
  // `tailscale down` keeps the login; `tailscale up` turns it on again.
  if (backend === "Stopped") return { kind: "stopped", detail: "Tailscale is turned off. Run `tailscale up`." };
  const name = status.Self?.DNSName;
  if (backend !== "Running" || typeof name !== "string" || name.length < 2)
    return { kind: "stopped", detail: `Tailscale is ${typeof backend === "string" ? backend : "not ready"}` };
  const owner = status.User?.[String(status.Self?.UserID)]?.LoginName;
  return {
    kind: "running",
    facts: {
      hostName: name.replace(/\.$/, ""),
      ownerLogin: typeof owner === "string" ? owner : null,
      httpsEnabled: Array.isArray(status.CertDomains) && status.CertDomains.length > 0,
    },
  };
}

/**
 * The HTTPS port in the tailnet: 443 for the default instance, so the phone needs no port in
 * the address, and Eva's own port for any other instance on the machine.
 */
export function tailnetPort(port: number): number {
  return port === defaultPort ? 443 : port;
}

/** The address that opens this instance on every device in the tailnet. */
export function tailnetAddress(hostName: string, port: number): string {
  const httpsPort = tailnetPort(port);
  return `https://${hostName}${httpsPort === 443 ? "" : `:${String(httpsPort)}`}`;
}

/**
 * Publishes the web UI in the tailnet only, never on the internet (no Funnel). The
 * command is safe to repeat; Tailscale keeps the setting across restarts.
 */
export async function publishWithTailscale(
  context: TailscaleContext,
  tailscale: TailscaleFacts,
  port: number,
): Promise<PublishResult> {
  if (!tailscale.httpsEnabled) return turnOnHttps(enableHttpsPage);
  let output: string;
  try {
    const result = await context.runner.run(
      [...context.program, "serve", "--bg", `--https=${String(tailnetPort(port))}`, `http://127.0.0.1:${String(port)}`],
      { cwd: ".", environment: context.environment, timeoutMs: tailscaleTimeoutMs },
    );
    if (result.exitCode === 0) return { url: tailnetAddress(tailscale.hostName, port), problem: null, link: null };
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
  }
  if (isAccessDenied(output)) return { url: null, problem: operatorFix, link: null };
  // A new tailnet must turn HTTPS on once; Tailscale prints the page that does it.
  const enableLink = loginLinkPattern.exec(output)?.[0];
  return enableLink === undefined
    ? { url: null, problem: `tailscale serve failed: ${firstLine(output)}`, link: null }
    : turnOnHttps(enableLink);
}

/**
 * Asks Tailscale for a fresh sign-in link. Links expire, so each sign-in asks again.
 * `tailscale up` would wait for the person; the timeout ends it once the link is out.
 */
export async function signInToTailscale(
  context: TailscaleContext,
): Promise<{ readonly link: string | null; readonly problem: string | null }> {
  let output: string;
  let exitCode: number | null = null;
  try {
    const result = await context.runner.run([...context.program, "up", `--timeout=${String(signInWaitSeconds)}s`], {
      cwd: ".",
      environment: context.environment,
      timeoutMs: (signInWaitSeconds + 15) * 1000,
    });
    output = `${result.stdout}\n${result.stderr}`;
    exitCode = result.exitCode;
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
  }
  const link = loginLinkPattern.exec(output)?.[0];
  if (link !== undefined) return { link, problem: null };
  if (exitCode === 0) return { link: null, problem: null };
  if (isAccessDenied(output)) return { link: null, problem: operatorFix };
  return { link: null, problem: `tailscale up gave no sign-in link: ${firstLine(output)}` };
}

function turnOnHttps(link: string): PublishResult {
  return { url: null, problem: "Turn on HTTPS for your tailnet once. Eva then publishes her page by herself.", link };
}

/** A root tailscaled refuses a normal user until the administrator makes the user an operator. */
function isAccessDenied(output: string): boolean {
  return /access denied|--operator/i.test(output);
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

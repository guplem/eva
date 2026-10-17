/**
 * The network step of `eva setup`: it brings the machine into the person's
 * tailnet, turns HTTPS on, and ends with the address that opens Eva on every other device.
 * Each step that needs the person shows a link and waits; nothing here needs root.
 */
import {
  readTailscale,
  tailnetPort,
  type RemoteAccess,
  type TailscaleFacts,
} from "../../core/remote-access/tailscale.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface NetworkSetupOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly write: (line: string) => void;
  /** Answers a yes or no question; an empty answer means the default. */
  readonly ask: (question: string) => Promise<string>;
  /** False: no question and no wait, only the state and what to do. */
  readonly interactive: boolean;
  readonly port: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long a wait for the person lasts. */
  readonly waitLimitMs?: number;
}

const installPage = "https://tailscale.com/download";
const enableHttpsPage = "https://login.tailscale.com/admin/dns";
const pollMs = 5_000;
const defaultWaitLimitMs = 10 * 60_000;
const loginTimeoutMs = 30_000;

/** The access lines: the address for every device, then the machine's own address (advanced). */
export function describeAccess(access: { remoteAccess: RemoteAccess | null; localUrl: string }): string[] {
  const remote = access.remoteAccess;
  const lines =
    remote === null
      ? [
          "Phone and other computers: not set up. Install Tailscale on this machine, then run `eva setup` again (docs/guide/setup.md, Open Eva on your phone).",
        ]
      : remote.url === null
        ? [`Phone and other computers: ${remote.problem ?? "not available"}`]
        : [
            `Open Eva: ${remote.url}`,
            "It works on any phone or computer that is signed in to Tailscale with your account. The first time, tap Allow in Telegram.",
          ];
  return [
    ...lines,
    `On this machine only (advanced): ${access.localUrl}, with the token \`localApiToken\` from secrets.json.`,
  ];
}

/** Walks the person through Tailscale. Returns the address that opens Eva, or null. */
export async function runNetworkSetup(options: NetworkSetupOptions): Promise<string | null> {
  options.write("");
  options.write("Network: Tailscale (a free private network of your own devices) opens Eva on your phone.");
  let tailscale = await readTailscale(options.runner, options.environment);
  tailscale ??= await logIn(options);
  if (tailscale !== null && !tailscale.httpsEnabled) tailscale = await turnOnHttps(options, tailscale);
  const url =
    tailscale?.httpsEnabled === true
      ? `https://${tailscale.hostName}${tailnetPort(options.port) === 443 ? "" : `:${String(options.port)}`}`
      : null;
  const remoteAccess: RemoteAccess | null =
    tailscale === null
      ? null
      : { url, problem: url === null ? `turn on HTTPS once at ${enableHttpsPage}, then restart Eva.` : null };
  for (const line of describeAccess({ remoteAccess, localUrl: `http://127.0.0.1:${String(options.port)}` }))
    options.write(line);
  if (url !== null) options.write("Eva publishes this address each time she starts. Ask her for it in any chat.");
  return url;
}

/** Logs the machine in, when Tailscale is installed. Returns null when it is not, or when the person skips. */
async function logIn(options: NetworkSetupOptions): Promise<TailscaleFacts | null> {
  const version = await options.runner
    .run(["tailscale", "version"], { cwd: ".", environment: options.environment, timeoutMs: loginTimeoutMs })
    .catch(() => null);
  if (version?.exitCode !== 0) {
    options.write(
      `Tailscale is not installed. Install it from ${installPage}; without admin rights, see docs/guide/setup.md (Tailscale without root).`,
    );
    return null;
  }
  if (!options.interactive) {
    options.write("Tailscale is not logged in. Run `tailscale up`, open its link, then restart Eva.");
    return null;
  }
  if (/^n/i.test((await options.ask("Log this machine in to Tailscale now? [Y/n]: ")).trim())) return null;
  const up = await options.runner
    .run(["tailscale", "up", "--timeout=10s"], {
      cwd: ".",
      environment: options.environment,
      timeoutMs: loginTimeoutMs,
    })
    .catch(() => null);
  const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(`${up?.stdout ?? ""}\n${up?.stderr ?? ""}`)?.[0];
  if (link === undefined) {
    const reason = (up?.stderr ?? "").trim().split("\n")[0] ?? "";
    options.write(`tailscale up gave no login link${reason === "" ? "" : `: ${reason}`}. Is tailscaled running?`);
    return null;
  }
  options.write(`Open this link on any device and sign in: ${link}`);
  options.write("Waiting for the sign-in…");
  return waitFor(options, (facts) => facts !== null);
}

async function turnOnHttps(options: NetworkSetupOptions, tailscale: TailscaleFacts): Promise<TailscaleFacts> {
  options.write(`Turn on HTTPS for your tailnet once: open ${enableHttpsPage} and enable HTTPS Certificates.`);
  if (!options.interactive) return tailscale;
  options.write("Waiting for HTTPS…");
  return (await waitFor(options, (facts) => facts?.httpsEnabled === true)) ?? tailscale;
}

async function waitFor(
  options: NetworkSetupOptions,
  done: (facts: TailscaleFacts | null) => boolean,
): Promise<TailscaleFacts | null> {
  const limit = options.waitLimitMs ?? defaultWaitLimitMs;
  for (let waited = 0; waited < limit; waited += pollMs) {
    await options.sleep(pollMs);
    const facts = await readTailscale(options.runner, options.environment);
    if (done(facts)) return facts;
  }
  options.write("Stopped waiting. Finish it later, then restart Eva.");
  return readTailscale(options.runner, options.environment);
}

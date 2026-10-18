/**
 * Phone access through Tailscale: Eva reads the machine's Tailscale state and publishes her web
 * UI inside the tailnet only.
 */
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

/** Phone access through `tailscale serve`: the address, or why there is none. */
export interface RemoteAccess {
  readonly url: string | null;
  readonly problem: string | null;
}

const tailscaleTimeoutMs = 10_000;
const defaultPort = 7420;
const enableHttpsPage = "https://login.tailscale.com/admin/dns";

/** Null when Tailscale is missing, stopped, or not logged in. */
export async function readTailscale(
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<TailscaleFacts | null> {
  try {
    const result = await runner.run(["tailscale", "status", "--json"], {
      cwd: ".",
      environment,
      timeoutMs: tailscaleTimeoutMs,
    });
    if (result.exitCode !== 0) return null;
    const status = JSON.parse(result.stdout) as {
      BackendState?: unknown;
      CertDomains?: unknown;
      Self?: { DNSName?: unknown; UserID?: unknown };
      User?: Record<string, { LoginName?: unknown } | undefined>;
    };
    const name = status.Self?.DNSName;
    if (status.BackendState !== "Running" || typeof name !== "string" || name.length < 2) return null;
    const owner = status.User?.[String(status.Self?.UserID)]?.LoginName;
    return {
      hostName: name.replace(/\.$/, ""),
      ownerLogin: typeof owner === "string" ? owner : null,
      httpsEnabled: Array.isArray(status.CertDomains) && status.CertDomains.length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * The HTTPS port in the tailnet: 443 for the default instance, so the phone needs no port in
 * the address, and Eva's own port for any other instance on the machine.
 */
export function tailnetPort(port: number): number {
  return port === defaultPort ? 443 : port;
}

/**
 * Publishes the web UI in the tailnet only, never on the internet (no Funnel). The
 * command is safe to repeat; Tailscale keeps the setting across restarts.
 */
export async function publishWithTailscale(
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
  tailscale: TailscaleFacts,
  port: number,
): Promise<RemoteAccess> {
  if (!tailscale.httpsEnabled)
    return {
      url: null,
      problem: `Turn on HTTPS for your tailnet once at ${enableHttpsPage}. Eva then publishes her page by herself.`,
    };
  const httpsPort = tailnetPort(port);
  let output: string;
  try {
    const result = await runner.run(
      ["tailscale", "serve", "--bg", `--https=${String(httpsPort)}`, `http://127.0.0.1:${String(port)}`],
      { cwd: ".", environment, timeoutMs: tailscaleTimeoutMs },
    );
    if (result.exitCode === 0)
      return {
        url: `https://${tailscale.hostName}${httpsPort === 443 ? "" : `:${String(httpsPort)}`}`,
        problem: null,
      };
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
  }
  // A new tailnet must turn HTTPS on once; Tailscale prints the page that does it.
  const enableLink = /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0];
  return {
    url: null,
    problem:
      enableLink === undefined
        ? `tailscale serve failed: ${output.trim().split("\n")[0] ?? ""}`
        : `Turn on HTTPS for your tailnet once at ${enableLink}. Eva then publishes her page by herself.`,
  };
}

export interface TailscalePublisherOptions {
  /** The `remoteAccess.tailscaleServe` setting. */
  readonly enabled: boolean;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly port: number;
}

/** Publishes the web UI at the start, and again until the tailnet turns HTTPS on, so the person never needs a restart. */
export class TailscalePublisher {
  private readonly options: TailscalePublisherOptions;
  private readonly facts: TailscaleFacts | null;
  private current: RemoteAccess | null;

  private constructor(options: TailscalePublisherOptions, facts: TailscaleFacts | null, current: RemoteAccess | null) {
    this.options = options;
    this.facts = facts;
    this.current = current;
  }

  static async start(options: TailscalePublisherOptions): Promise<TailscalePublisher> {
    const facts = options.enabled ? await readTailscale(options.runner, options.environment) : null;
    const access =
      facts === null ? null : await publishWithTailscale(options.runner, options.environment, facts, options.port);
    return new TailscalePublisher(options, facts, access);
  }

  /** The address for the phone now, or null when Tailscale does not run here. */
  access(): RemoteAccess | null {
    return this.current;
  }

  /** This machine's name in the tailnet, or null. */
  hostName(): string | null {
    return this.facts?.hostName ?? null;
  }

  /** The account that owns this machine in Tailscale, or null. */
  ownerLogin(): string | null {
    return this.facts?.ownerLogin ?? null;
  }

  /** Publishes again while there is no address yet. True when this call got the address. */
  async retry(): Promise<boolean> {
    if (this.facts === null || (this.current !== null && this.current.url !== null)) return false;
    const fresh = await readTailscale(this.options.runner, this.options.environment);
    if (fresh === null) return false;
    this.current = await publishWithTailscale(this.options.runner, this.options.environment, fresh, this.options.port);
    return this.current.url !== null;
  }
}

/** Plug and play: with no list, only the account that owns this machine in Tailscale gets in. */
export function allowedTailscaleIdentities(
  configured: readonly string[],
  ownerLogin: string | null,
): readonly string[] {
  return configured.length > 0 || ownerLogin === null ? configured : [ownerLogin];
}

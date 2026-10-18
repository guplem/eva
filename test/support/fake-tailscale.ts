/**
 * A fake `tailscale` program behind the process runner seam. A test sets its state as it goes,
 * and the real RemoteAccessWatcher reads it.
 */
import { RemoteAccessWatcher } from "../../src/core/remote-access/remote-access.ts";
import { EvaError } from "../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../src/shared/process-runner.ts";

/** The answer of `tailscale status --json` for a machine that runs and is signed in. */
export function runningStatus(
  https: boolean,
  owner = "owner@example.com",
  host = "server.example-tailnet.ts.net",
): string {
  return JSON.stringify({
    BackendState: "Running",
    CertDomains: https ? [host] : null,
    Self: { DNSName: `${host}.`, UserID: 7 },
    User: { "7": { LoginName: owner } },
  });
}

export const needsLoginStatus = JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "" });

export class FakeTailscale {
  /** A status JSON, or "missing" (no program) or "stopped" (no daemon). */
  status: string;
  serveExitCode: number;
  serveOutput: string;
  /** `tailscale up` exits 1 when its timeout ends before the sign-in, and 0 when no sign-in was needed. */
  upExitCode: number;
  upOutput: string;
  /** The verb of each command, such as "status" or "serve". */
  readonly commands: string[];
  readonly full: string[][];
  readonly runner: ProcessRunner;

  constructor() {
    this.status = "missing";
    this.serveExitCode = 0;
    this.serveOutput = "serve broke";
    this.upExitCode = 1;
    this.upOutput = "To authenticate, visit:\n\thttps://login.tailscale.com/a/fresh\n";
    this.commands = [];
    this.full = [];
    this.runner = {
      run: (command): Promise<ProcessResult> => {
        // The watcher below runs a bare program, so the verb follows it.
        const verb = command[1] ?? "";
        this.commands.push(verb);
        this.full.push([...command]);
        if (this.status === "missing")
          return Promise.reject(new EvaError("process_failed", "Could not start tailscale."));
        if (verb === "up") return Promise.resolve({ exitCode: this.upExitCode, stdout: "", stderr: this.upOutput });
        if (verb === "serve")
          return Promise.resolve({ exitCode: this.serveExitCode, stdout: "", stderr: this.serveOutput });
        if (this.status === "stopped") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "no tailscaled" });
        return Promise.resolve({ exitCode: 0, stdout: this.status, stderr: "" });
      },
    };
  }

  /** A real watcher on this fake program. */
  watcher(options: { install?: (() => Promise<void>) | null; port?: number } = {}): RemoteAccessWatcher {
    return new RemoteAccessWatcher({
      runner: this.runner,
      environment: {},
      port: options.port ?? 7420,
      program: () => ["tailscale"],
      install: options.install ?? null,
    });
  }
}

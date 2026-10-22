/**
 * The facts of the process that runs a CLI command. `src/main.ts` reads them from the
 * real process; a test passes its own, so each command runs in a test.
 */
import { existsSync } from "node:fs";
import { RemoteAccessWatcher, type RemoteAccess } from "../../core/remote-access/remote-access.ts";
import { findTailscale, readTailnetAccounts } from "../../core/remote-access/tailscale.ts";
import { canInstallTailscale, installTailscale } from "../../core/remote-access/tailscale-install.ts";
import {
  baseEnvironmentAllowlist,
  buildChildEnvironment,
  proxyEnvironmentAllowlist,
  type EnvironmentMap,
} from "../../shared/environment.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface CliHost {
  /** The whole environment of this process. */
  readonly environment: EnvironmentMap;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** The OS user's home folder. */
  readonly userHome: string;
  readonly userName: string;
  readonly hostName: string;
  readonly pid: number;
  /** The parent pid now. It changes while Eva runs: an orphan gets a new parent. */
  readonly parentPid: () => number;
  readonly runner: ProcessRunner;
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
  /** True when a person types at this terminal, so a command may ask a question. */
  readonly interactive: boolean;
  /** Lends a prompt on the console to the work, and closes it after. */
  readonly withPrompt: (work: (ask: (question: string) => Promise<string>) => Promise<void>) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  /** True for the single executable that `bun build --compile` makes. */
  readonly standalone: boolean;
  /** The program of this process: the executable, or bun for a source checkout. */
  readonly execPath: string;
  /** `src/main.ts` of a source checkout. */
  readonly mainScript: string;
  /** The folder of a source checkout, which a source update fast-forwards. */
  readonly sourceFolder: string;
  readonly isProcessAlive: (pid: number) => boolean;
  /** The boot id of a Linux machine, so a lock from before a reboot counts as free. */
  readonly bootId: string | null;
  /** Calls the handler once at the first SIGINT or SIGTERM. */
  readonly onStopSignal: (handler: () => void) => void;
}

/** The part of a `node:readline/promises` interface that a prompt uses. */
export interface LinePrompt {
  question(query: string): Promise<string>;
  on(event: "SIGINT", listener: () => void): unknown;
  close(): void;
}

/**
 * Lends the prompt to the work, and closes it after. Ctrl+C at any moment, or the end of the
 * input, stops the work with `prompt_stopped`, so the command prints one line and no stack (#407).
 */
export async function withLinePrompt(
  prompt: LinePrompt,
  work: (ask: (question: string) => Promise<string>) => Promise<void>,
): Promise<void> {
  const stoppedError = (): EvaError => new EvaError("prompt_stopped", "Stopped with Ctrl+C.");
  let stop: (error: EvaError) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  // With a listener, readline no longer closes itself at Ctrl+C, so a long step stops at once too.
  prompt.on("SIGINT", () => {
    stop(stoppedError());
  });
  const ask = async (question: string): Promise<string> => {
    try {
      return await prompt.question(question);
    } catch (error) {
      throw isClosedPrompt(error) ? stoppedError() : error;
    }
  };
  try {
    await Promise.race([work(ask), stopped]);
  } finally {
    prompt.close();
  }
}

/** readline rejects a question with AbortError when it closes, and a closed one with ERR_USE_AFTER_CLOSE. */
function isClosedPrompt(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || (error as { readonly code?: unknown }).code === "ERR_USE_AFTER_CLOSE")
  );
}

export function writeLine(host: CliHost, text: string): void {
  host.write(`${text}\n`);
}

/** The environment of a child process that needs no secret. */
export function childEnvironment(host: CliHost): Record<string, string> {
  return buildChildEnvironment(host.environment, baseEnvironmentAllowlist);
}

/** The environment of an engine installer, which downloads through the person's proxy. */
export function installEnvironment(host: CliHost): Record<string, string> {
  return buildChildEnvironment(host.environment, [...baseEnvironmentAllowlist, ...proxyEnvironmentAllowlist]);
}

/**
 * The command that runs this Eva: `[eva]`, or `[bun, main.ts]` for a source checkout. The single
 * executable runs itself: its code lives in Bun's embedded file system, which only it can read.
 */
export function evaCommand(host: CliHost): string[] {
  return host.standalone ? [host.execPath] : [host.execPath, host.mainScript];
}

/** The people's accounts on this machine's tailnet, the owner first, or none without Tailscale. */
export function tailnetAccounts(host: CliHost): Promise<string[]> {
  const environment = childEnvironment(host);
  const program = findTailscale({
    platform: host.platform,
    homeFolder: host.userHome,
    environment,
    exists: existsSync,
    which: (name) => Bun.which(name),
  });
  return readTailnetAccounts({ runner: host.runner, environment, program });
}

/** Phone access through Tailscale on this machine, for the running Eva and for `eva setup`. */
export function remoteAccessWatcher(
  host: CliHost,
  port: number,
  onChange?: (access: RemoteAccess) => void,
): RemoteAccessWatcher {
  const environment = childEnvironment(host);
  return new RemoteAccessWatcher({
    runner: host.runner,
    environment,
    port,
    program: () =>
      findTailscale({
        platform: host.platform,
        homeFolder: host.userHome,
        environment,
        exists: existsSync,
        which: (name) => Bun.which(name),
      }),
    install: canInstallTailscale(host.platform)
      ? () =>
          installTailscale({
            runner: host.runner,
            environment,
            platform: host.platform,
            arch: host.arch,
            homeFolder: host.userHome,
          })
      : null,
    ...(onChange === undefined ? {} : { onChange }),
  });
}

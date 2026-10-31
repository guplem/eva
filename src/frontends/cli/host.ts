/**
 * The facts of the process that runs a CLI command. `src/main.ts` reads them from the
 * real process; a test passes its own, so each command runs in a test.
 */
import { existsSync } from "node:fs";
import { Writable } from "node:stream";
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
  /** True when the output goes to a terminal, not to a file or a pipe. */
  readonly outputIsTerminal: boolean;
  /** Lends a prompt on the console to the work, and closes it after. */
  readonly withPrompt: (work: (ask: Ask) => Promise<void>) => Promise<void>;
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

/** `hidden`: the typed answer does not show, such as for the vault password. */
export interface AskOptions {
  readonly hidden?: boolean;
}

export type Ask = (question: string, options?: AskOptions) => Promise<string>;

/**
 * Lends the prompt to the work, and closes it after. Ctrl+C at any moment, or the end of the
 * input, stops the work with `prompt_stopped`, so the command prints one line and no stack (#407).
 * `mute` stops the echo of the prompt's output while the person types a hidden answer.
 */
export async function withLinePrompt(
  prompt: LinePrompt,
  work: (ask: Ask) => Promise<void>,
  mute: (muted: boolean) => void = () => undefined,
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
  const ask: Ask = async (question, options = {}) => {
    try {
      // readline writes the question at once, so the mute after it hides only the typed answer.
      const answer = prompt.question(question);
      if (options.hidden === true) mute(true);
      try {
        return await answer;
      } finally {
        if (options.hidden === true) mute(false);
      }
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

/** True when the output may have colors. NO_COLOR (no-color.org) and TERM=dumb turn them off. */
export function wantsColor(host: CliHost): boolean {
  const noColor = host.environment["NO_COLOR"];
  return host.outputIsTerminal && (noColor === undefined || noColor === "") && host.environment["TERM"] !== "dumb";
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

/** The part of a terminal stream that a prompt's output needs. */
export interface TerminalOutput {
  write(text: string): unknown;
  readonly columns?: number;
  readonly isTTY?: boolean;
}

/**
 * An output for readline that can stop its echo, so a hidden answer never shows on the screen or in
 * the scrollback, where an agent could read it. It keeps the size of the terminal, as readline needs.
 */
export function mutableOutput(target: TerminalOutput): {
  readonly output: Writable;
  readonly mute: (muted: boolean) => void;
} {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      if (!muted) target.write(chunk.toString());
      done();
    },
  });
  Object.defineProperties(output, {
    columns: { get: () => target.columns },
    isTTY: { get: () => target.isTTY },
  });
  const mute = (next: boolean): void => {
    // readline wrote the Enter of the hidden answer while muted, so the line ends here.
    if (muted && !next) target.write("\n");
    muted = next;
  };
  return { output, mute };
}

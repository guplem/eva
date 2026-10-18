/**
 * The facts of the process that runs a CLI command. Only `src/main.ts` reads them from the
 * real process; a test passes its own, so each command runs in a test.
 */
import { resolveHomeFolder } from "../../core/settings/home.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../../shared/environment.ts";
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

export function writeLine(host: CliHost, text: string): void {
  host.write(`${text}\n`);
}

/** The environment of a child process that needs no secret. */
export function childEnvironment(host: CliHost): Record<string, string> {
  return buildChildEnvironment(host.environment, baseEnvironmentAllowlist);
}

/**
 * The command that runs this Eva: `[eva]`, or `[bun, main.ts]` for a source checkout. The single
 * executable runs itself: its code lives in Bun's embedded file system, which only it can read.
 */
export function evaCommand(host: CliHost): string[] {
  return host.standalone ? [host.execPath] : [host.execPath, host.mainScript];
}

/** The home folder that Eva uses when no `--home` or `EVA_HOME` names one. */
export function defaultHomeFolder(host: CliHost): string {
  // Only EVA_HOME is left out: APPDATA and XDG_CONFIG_HOME still move the default folder.
  const environment = { APPDATA: host.environment["APPDATA"], XDG_CONFIG_HOME: host.environment["XDG_CONFIG_HOME"] };
  return resolveHomeFolder({ environment, platform: host.platform, userHome: host.userHome });
}

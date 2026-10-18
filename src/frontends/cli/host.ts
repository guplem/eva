/**
 * The facts of the process that runs a CLI command. Only `src/main.ts` reads them from the
 * real process; a test passes its own, so each command runs in a test.
 */
import type { EvaSecrets, HomePaths } from "../../core/settings/home.ts";
import { loadConfig, loadSecrets, resolveHomeFolder } from "../../core/settings/home.ts";
import { gitEnvironmentWithToken } from "../../core/instance/child-environments.ts";
import { runningInstancePid } from "../../core/instance/instance-lock.ts";
import { executableUpdateChannel } from "../../core/updates/self-update.ts";
import { sourceUpdateChannel } from "../../core/updates/source-update.ts";
import type { UpdateChannel } from "../../core/updates/updater.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../../shared/environment.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { evaVersion } from "../../shared/version.ts";
import type { ClientOptions } from "./client.ts";

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
  readonly parentPid: number;
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

/** The environment of Eva's own git commands, with the GitHub token. */
export function gitEnvironment(host: CliHost, secrets: EvaSecrets): Record<string, string> {
  return gitEnvironmentWithToken(host.environment, secrets);
}

/** The command that runs this Eva: `[eva]`, or `[bun, main.ts]` for a source checkout. */
export function evaCommand(host: CliHost): string[] {
  return host.standalone ? [host.execPath] : [host.execPath, host.mainScript];
}

/** The home folder that Eva uses when no `--home` or `EVA_HOME` names one. */
export function defaultHomeFolder(host: CliHost): string {
  // Only EVA_HOME is left out: APPDATA and XDG_CONFIG_HOME still move the default folder.
  const environment = { APPDATA: host.environment["APPDATA"], XDG_CONFIG_HOME: host.environment["XDG_CONFIG_HOME"] };
  return resolveHomeFolder({ environment, platform: host.platform, userHome: host.userHome });
}

/** The API of the Eva that runs with this home, or null when none runs. */
export function runningClient(host: CliHost, paths: HomePaths): ClientOptions | null {
  const token = loadSecrets(paths).localApiToken;
  const probe = { bootId: host.bootId, isProcessAlive: host.isProcessAlive };
  if (token === undefined || runningInstancePid(paths.lock, probe) === null) return null;
  return { baseUrl: `http://127.0.0.1:${String(loadConfig(paths).port)}`, token };
}

/** Signed releases for the single executable; git for a source checkout. */
export function updateChannel(host: CliHost, secrets: EvaSecrets): UpdateChannel {
  if (host.standalone) {
    return executableUpdateChannel({
      currentVersion: evaVersion,
      executablePath: host.execPath,
      platform: host.platform,
      arch: host.arch,
      runner: host.runner,
      environment: childEnvironment(host),
    });
  }
  return sourceUpdateChannel({
    folder: host.sourceFolder,
    runner: host.runner,
    environment: gitEnvironment(host, secrets),
    bunExecutable: host.execPath,
  });
}

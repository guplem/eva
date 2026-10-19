/**
 * After an update without a supervisor, the new copy of Eva starts first. The lock is free only
 * when the old copy has gone, so the new copy waits for it.
 */
import type { EnvironmentMap } from "../../shared/environment.ts";
import { instanceVariable } from "../settings/home.ts";
import { supervisedVariable } from "./supervisor.ts";

const oldCopyVariable = "EVA_WAIT_FOR_PID";
const oldCopyWaitMs = 60_000;
const oldCopyPollMs = 200;

export interface NewCopyLaunch {
  readonly command: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

/** The command and environment of the new copy, which gets the same arguments as this one. */
export function newCopyLaunch(input: {
  /** The command that starts this Eva, such as `[bun, main.ts]` or `[eva]`. */
  readonly evaCommand: readonly string[];
  readonly arguments: readonly string[];
  readonly environment: EnvironmentMap;
  /** The name of this Eva. The copy has no terminal, so it cannot ask which Eva to run. */
  readonly instance: string;
  readonly pid: number;
}): NewCopyLaunch {
  // The new copy is Eva herself, not an agent, so it gets Eva's whole environment (lesson 96 covers agents).
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.environment)) {
    // The copy runs outside any supervisor, so it must not carry a supervisor's pid.
    if (value !== undefined && name !== supervisedVariable) environment[name] = value;
  }
  environment[instanceVariable] = input.instance;
  environment[oldCopyVariable] = String(input.pid);
  return { command: [...input.evaCommand, ...input.arguments], environment };
}

/** Waits until the old copy named in the environment has gone, or for a minute at most. */
export async function waitForOldCopy(options: {
  readonly environment: EnvironmentMap;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  const pid = Number(options.environment[oldCopyVariable]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const started = options.now();
  while (options.isProcessAlive(pid) && options.now() - started < oldCopyWaitMs) await options.sleep(oldCopyPollMs);
}

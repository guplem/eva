/**
 * The Eva supervisor: it runs Eva as a child and starts her again after a crash. On Linux,
 * systemd does this job. On Windows, the logon task runs `eva supervise` (lesson 89).
 */
import { exitCodes } from "../../shared/exit-codes.ts";
import type { LongProcess, LongProcessStarter } from "../../shared/long-process.ts";

/**
 * The supervisor's pid, set for a supervised Eva, as systemd sets INVOCATION_ID: an update then
 * exits 4 for the supervisor, instead of starting a copy of Eva that nobody supervises. A pid,
 * not a flag, so an Eva whose supervisor has ended knows that nobody would restart her.
 */
export const supervisedVariable = "EVA_SUPERVISED";

export type RestartDecision =
  | { readonly kind: "stop"; readonly exitCode: number }
  | { readonly kind: "restart"; readonly afterMs: number; readonly crash: boolean };

const firstCrashDelayMs = 5_000;
/** The longest wait, so that Eva always starts again within a minute of a crash. */
const longestCrashDelayMs = 30_000;
/** A run this long shows that Eva works again, so the next crash waits the shortest time. */
const healthyRunMs = 10 * 60_000;

/**
 * What to do when Eva exits, after `crashes` crashes in a row. It matches the systemd unit:
 * 2 and 3 never restart, because a restart cannot fix them.
 */
export function restartDecision(exitCode: number, crashes: number): RestartDecision {
  if (exitCode === exitCodes.clean || exitCode === exitCodes.badConfig || exitCode === exitCodes.secondInstance)
    return { kind: "stop", exitCode };
  if (exitCode === exitCodes.update) return { kind: "restart", afterMs: 0, crash: false };
  const afterMs = Math.min(firstCrashDelayMs * 2 ** Math.min(crashes, 10), longestCrashDelayMs);
  return { kind: "restart", afterMs, crash: true };
}

export interface SupervisorOptions {
  /** The command that runs Eva herself. */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly start: LongProcessStarter;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
  /** How long Eva gets to stop by herself before a hard stop. */
  readonly stopTimeoutMs: number;
  /** The supervisor's own pid. */
  readonly pid: number;
}

export interface Supervisor {
  /** The supervisor's exit code: Eva's own when she stops for good, 0 after a stop. */
  readonly done: Promise<number>;
  /** Stops Eva and the supervisor. Eva does not start again. */
  stop(): void;
}

/**
 * Runs Eva, and starts her again after a crash or an update. It never gives up after many
 * crashes: the phone is often the only way in, and each new Eva reports the crash there.
 */
export function superviseEva(options: SupervisorOptions): Supervisor {
  const state: { stopping: boolean; child: LongProcess | null } = { stopping: false, child: null };
  // A function, so the loop reads a stop that happens while it awaits.
  const isStopping = (): boolean => state.stopping;
  const stopAsked = Promise.withResolvers<undefined>();
  // The child's stop is bounded, but its exit may never come: this ends the wait for it.
  const stopEnded = Promise.withResolvers<number>();
  const environment = { ...options.environment, [supervisedVariable]: String(options.pid) };

  const done = (async () => {
    let crashes = 0;
    for (;;) {
      const startedAt = options.now();
      let exitCode: number;
      try {
        state.child = options.start(options.command, { cwd: options.cwd, environment });
        exitCode = await Promise.race([state.child.exited, stopEnded.promise]);
      } catch (error) {
        options.log(`Eva could not start: ${error instanceof Error ? error.message : String(error)}`);
        exitCode = exitCodes.crash;
      }
      state.child = null;
      if (isStopping()) return exitCodes.clean;
      if (options.now() - startedAt >= healthyRunMs) crashes = 0;
      const decision = restartDecision(exitCode, crashes);
      if (decision.kind === "stop") return decision.exitCode;
      if (decision.crash) crashes += 1;
      options.log(
        `Eva stopped with exit code ${String(exitCode)}. She starts again in ${String(decision.afterMs / 1000)} s.`,
      );
      await Promise.race([options.sleep(decision.afterMs), stopAsked.promise]);
      if (isStopping()) return exitCodes.clean;
    }
  })();

  return {
    done,
    stop: () => {
      if (state.stopping) return;
      state.stopping = true;
      stopAsked.resolve(undefined);
      void (state.child?.stop(options.stopTimeoutMs) ?? Promise.resolve())
        .catch((error: unknown) => {
          options.log(`Eva could not be stopped: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          stopEnded.resolve(exitCodes.clean);
        });
    },
  };
}

/**
 * The Eva supervisor: it runs Eva as a child and starts her again after a crash. On Linux,
 * systemd does this job. On Windows, the start at logon runs `eva supervise` (lesson 89).
 */
import { exitCodes } from "../../shared/exit-codes.ts";
import type { LongProcess, LongProcessStarter } from "../../shared/long-process.ts";

/**
 * The supervisor sets its pid in this variable for Eva, as systemd sets INVOCATION_ID.
 * An update then exits 4 for the supervisor, and Eva starts no copy that nobody supervises.
 * With a pid, an Eva whose supervisor has ended can see that nobody would restart her.
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
  /**
   * Asks the running Eva to stop by herself, before the bounded stop. Windows has no gentle
   * signal for another process, so there the supervisor asks through her local API.
   */
  readonly askStop?: () => Promise<void>;
  /** Hears each start of Eva, and each wait after a crash, such as for the Windows tray icon. */
  readonly onPhase?: (phase: SupervisorPhase) => void;
}

export type SupervisorPhase =
  { readonly kind: "running" } | { readonly kind: "waiting"; readonly afterMs: number; readonly exitCode: number };

export interface Supervisor {
  /** The supervisor's exit code: Eva's own when she stops for good, 0 after a stop. */
  readonly done: Promise<number>;
  /** Stops Eva and the supervisor. Eva does not start again. */
  stop(): void;
  /** Stops Eva and starts her again at once, also during the wait after a crash. */
  restart(): void;
}

/**
 * Runs Eva, and starts her again after a crash or an update. It restarts her after any number
 * of crashes. The phone is often the only way in, and each new Eva reports the crash there.
 */
export function superviseEva(options: SupervisorOptions): Supervisor {
  const state: {
    stopping: boolean;
    restarting: boolean;
    child: LongProcess | null;
    // The child's stop is bounded, but its exit may never come: this ends the wait for it.
    runEnded: PromiseWithResolvers<number> | null;
    // Ends the wait after a crash.
    wake: PromiseWithResolvers<undefined> | null;
  } = { stopping: false, restarting: false, child: null, runEnded: null, wake: null };
  // Functions, so the loop reads a stop or a restart that happens while it awaits.
  const isStopping = (): boolean => state.stopping;
  const isRestarting = (): boolean => state.restarting;
  const environment = { ...options.environment, [supervisedVariable]: String(options.pid) };

  const stopChild = (): void => {
    const { child, runEnded } = state;
    if (child === null) return;
    void options.askStop?.().catch(() => undefined);
    void child
      .stop(options.stopTimeoutMs)
      .catch((error: unknown) => {
        options.log(`Eva could not be stopped: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        runEnded?.resolve(exitCodes.clean);
      });
  };

  const done = (async () => {
    let crashes = 0;
    for (;;) {
      const startedAt = options.now();
      const runEnded = Promise.withResolvers<number>();
      state.runEnded = runEnded;
      let exitCode: number;
      try {
        state.child = options.start(options.command, { cwd: options.cwd, environment });
        options.onPhase?.({ kind: "running" });
        exitCode = await Promise.race([state.child.exited, runEnded.promise]);
      } catch (error) {
        options.log(`Eva could not start: ${error instanceof Error ? error.message : String(error)}`);
        exitCode = exitCodes.crash;
      }
      state.child = null;
      if (isStopping()) return exitCodes.clean;
      if (isRestarting()) {
        state.restarting = false;
        crashes = 0;
        options.log("Eva restarts on request.");
        continue;
      }
      if (options.now() - startedAt >= healthyRunMs) crashes = 0;
      const decision = restartDecision(exitCode, crashes);
      if (decision.kind === "stop") return decision.exitCode;
      if (decision.crash) {
        crashes += 1;
        options.onPhase?.({ kind: "waiting", afterMs: decision.afterMs, exitCode });
      }
      options.log(
        decision.crash
          ? `Eva stopped with exit code ${String(exitCode)}. She starts again in ${String(decision.afterMs / 1000)} s.`
          : "Eva stopped for an update. She starts again now.",
      );
      const wake = Promise.withResolvers<undefined>();
      state.wake = wake;
      await Promise.race([options.sleep(decision.afterMs), wake.promise]);
      state.wake = null;
      if (isStopping()) return exitCodes.clean;
      if (isRestarting()) {
        state.restarting = false;
        crashes = 0;
      }
    }
  })();

  return {
    done,
    stop: () => {
      if (state.stopping) return;
      state.stopping = true;
      state.wake?.resolve(undefined);
      stopChild();
    },
    restart: () => {
      if (state.stopping || state.restarting) return;
      state.restarting = true;
      state.wake?.resolve(undefined);
      stopChild();
    },
  };
}

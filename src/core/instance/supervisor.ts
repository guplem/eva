/**
 * The Eva supervisor: it runs Eva as a child and starts her again after a crash. On Linux,
 * systemd does this job. On Windows, the logon task runs `eva supervise` (lesson 89).
 */
import { exitCodes } from "../../shared/exit-codes.ts";

export type RestartDecision =
  | { readonly kind: "stop"; readonly exitCode: number }
  | { readonly kind: "restart"; readonly afterMs: number; readonly crash: boolean };

const firstCrashDelayMs = 5_000;
/** The longest wait, so that Eva always starts again within a minute of a crash. */
const longestCrashDelayMs = 30_000;

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

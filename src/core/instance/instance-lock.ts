/**
 * One core process for each instance home (lesson 20). The lock is a
 * file that holds the owner's pid, the boot id on Linux, and a `heartbeat` line. It is created
 * exclusively, and a lock whose owner no longer runs is taken over, so a crash never blocks the
 * next start. The live core touches the file at each beat, so a start can tell her from a reused pid.
 */
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { EvaError } from "../../shared/errors.ts";

export interface InstanceLock {
  release(): void;
}

/** What tells whether the holder of a lock still runs. */
export interface LockProbe {
  /** This boot's id, or null where the platform gives none. */
  readonly bootId: string | null;
  readonly isProcessAlive: (pid: number) => boolean;
}

export interface LockOwner extends LockProbe {
  readonly pid: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** How often the live core touches its lock. */
  readonly heartbeatMs?: number;
  /** How long a lock with no touch must stay still before a start takes it over. */
  readonly staleAfterMs?: number;
  /** The timer seam; the default is the global `setInterval`. */
  readonly setInterval?: (tick: () => void, ms: number) => { stop(): void };
}

interface LockHolder {
  readonly pid: number;
  readonly bootId: string | null;
  /** False for a lock of an Eva from before the heartbeat, which never touches her lock. */
  readonly beats: boolean;
}

const linuxBootIdPath = "/proc/sys/kernel/random/boot_id";
const heartbeatLine = "heartbeat";
const defaultHeartbeatMs = 5_000;
const defaultStaleAfterMs = 60_000;

export async function acquireInstanceLock(lockPath: string, owner: LockOwner): Promise<InstanceLock> {
  const heartbeatMs = owner.heartbeatMs ?? defaultHeartbeatMs;
  if (!tryCreate(lockPath, owner)) {
    const before = lockState(lockPath);
    const holder = readHolder(lockPath);
    if (holder !== null && holder.pid !== owner.pid && isHolderRunning(holder, owner)) {
      if (!holder.beats || bootIdDecides(holder, owner) || (await holderBeats(lockPath, before, owner, heartbeatMs))) {
        throw new EvaError(
          "instance_locked",
          `Another Eva (pid ${String(holder.pid)}) already runs with this home folder.`,
        );
      }
    }
    // Two starts can watch the same stale lock. The one that comes second must not delete the new lock of the first.
    const after = lockState(lockPath);
    if (after !== null && after !== before) {
      throw new EvaError("instance_locked", "Another Eva started with this home folder at the same moment.");
    }
    rmSync(lockPath, { force: true });
    if (!tryCreate(lockPath, owner)) {
      throw new EvaError("instance_locked", "Another Eva started with this home folder at the same moment.");
    }
  }

  const heartbeat = (owner.setInterval ?? unrefInterval)(() => {
    // A touch on the lock of another core would make that lock look live after its core ends.
    if (readHolder(lockPath)?.pid !== owner.pid) return;
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      // A missing lock is no reason to stop Eva: the next start simply finds no holder.
    }
  }, heartbeatMs);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      heartbeat.stop();
      // A core that lost its lock to a takeover must not delete the lock of the new core.
      if (readHolder(lockPath)?.pid === owner.pid) rmSync(lockPath, { force: true });
    },
  };
}

function unrefInterval(tick: () => void, ms: number): { stop(): void } {
  const handle = setInterval(tick, ms);
  // The heartbeat alone must not keep Eva running after her work ends.
  handle.unref();
  return {
    stop() {
      clearInterval(handle);
    },
  };
}

/** True when a process with this pid exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The id of this boot on Linux, or null elsewhere and when the file cannot be read. */
export function readBootId(platform: NodeJS.Platform, bootIdPath: string = linuxBootIdPath): string | null {
  if (platform !== "linux") return null;
  try {
    const bootId = readFileSync(bootIdPath, "utf-8").trim();
    return bootId.length > 0 ? bootId : null;
  } catch {
    return null;
  }
}

/** The pid of the Eva that holds the lock now, or null when none runs. */
export function runningInstancePid(lockPath: string, probe: LockProbe): number | null {
  const holder = readHolder(lockPath);
  return holder !== null && isHolderRunning(holder, probe) ? holder.pid : null;
}

/**
 * After a reboot, an unrelated process can have the old pid. The boot id tells such a lock
 * apart: without this check, Eva exits with code 3 and systemd never starts her again.
 */
function isHolderRunning(holder: LockHolder, probe: LockProbe): boolean {
  if (holder.bootId !== null && probe.bootId !== null && holder.bootId !== probe.bootId) return false;
  return probe.isProcessAlive(holder.pid);
}

function bootIdDecides(holder: LockHolder, probe: LockProbe): boolean {
  return holder.bootId !== null && probe.bootId !== null;
}

/**
 * Windows gives no boot id, so after a power loss another process can have the old pid (#528).
 * Only a live Eva touches her lock. The watch compares one file time with the next, never with
 * the clock: a clock step cannot make a live lock look stale (#509).
 */
async function holderBeats(
  lockPath: string,
  first: string | null,
  owner: LockOwner,
  heartbeatMs: number,
): Promise<boolean> {
  const beats = Math.ceil((owner.staleAfterMs ?? defaultStaleAfterMs) / heartbeatMs);
  for (let beat = 0; beat < beats; beat += 1) {
    await owner.sleep(heartbeatMs);
    const now = lockState(lockPath);
    if (now === null) return false;
    if (now !== first) return true;
  }
  return false;
}

/** The lock's content and file time, or null when the lock is gone. */
function lockState(lockPath: string): string | null {
  try {
    return `${String(statSync(lockPath).mtimeMs)}\n${readFileSync(lockPath, "utf-8")}`;
  } catch {
    return null;
  }
}

function tryCreate(lockPath: string, owner: LockOwner): boolean {
  try {
    writeFileSync(lockPath, `${String(owner.pid)}\n${owner.bootId ?? ""}\n${heartbeatLine}\n`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const [pidLine = "", bootIdLine = "", heartbeat = ""] = readFileSync(lockPath, "utf-8").split("\n");
    const pid = Number.parseInt(pidLine.trim(), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const bootId = bootIdLine.trim();
    return { pid, bootId: bootId.length > 0 ? bootId : null, beats: heartbeat.trim() === heartbeatLine };
  } catch {
    return null;
  }
}

/**
 * One core process for each instance home (lesson 20). The lock is a
 * file that holds the owner's pid and, on Linux, the boot id. It is created exclusively,
 * and a lock whose owner no longer runs is taken over, so a crash never blocks the next start.
 */
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { EvaError } from "../../shared/errors.ts";

export interface InstanceLock {
  release(): void;
}

/** What tells whether the holder of a lock still runs. */
export interface LockProbe {
  /** This boot's id, or null where the platform gives none. */
  readonly bootId: string | null;
  /** When this boot started, in milliseconds. By default, Eva reads it from the system uptime. */
  readonly bootTimeMs?: number;
  readonly isProcessAlive: (pid: number) => boolean;
}

export interface LockOwner extends LockProbe {
  readonly pid: number;
}

interface LockHolder {
  readonly pid: number;
  readonly bootId: string | null;
  /** When the lock file was written. */
  readonly writtenAtMs: number;
}

const linuxBootIdPath = "/proc/sys/kernel/random/boot_id";
/** A clock correction after the boot can move the boot time later; this margin keeps a live lock. */
const clockChangeMarginMs = 2 * 60_000;

export function acquireInstanceLock(lockPath: string, owner: LockOwner): InstanceLock {
  if (!tryCreate(lockPath, owner)) {
    const holder = readHolder(lockPath);
    if (holder !== null && holder.pid !== owner.pid && isHolderRunning(holder, owner)) {
      throw new EvaError(
        "instance_locked",
        `Another Eva (pid ${String(holder.pid)}) already runs with this home folder.`,
      );
    }
    rmSync(lockPath, { force: true });
    if (!tryCreate(lockPath, owner)) {
      throw new EvaError("instance_locked", "Another Eva started with this home folder at the same moment.");
    }
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
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
 * Where a side has no boot id, such as on Windows, a lock file older than this boot is stale.
 */
function isHolderRunning(holder: LockHolder, probe: LockProbe): boolean {
  if (holder.bootId !== null && probe.bootId !== null) {
    if (holder.bootId !== probe.bootId) return false;
  } else if (holder.writtenAtMs < (probe.bootTimeMs ?? bootTimeMs()) - clockChangeMarginMs) {
    return false;
  }
  return probe.isProcessAlive(holder.pid);
}

function bootTimeMs(): number {
  return Date.now() - uptime() * 1000;
}

function tryCreate(lockPath: string, owner: LockOwner): boolean {
  try {
    const content = owner.bootId === null ? String(owner.pid) : `${String(owner.pid)}\n${owner.bootId}\n`;
    writeFileSync(lockPath, content, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const [pidLine = "", bootIdLine = ""] = readFileSync(lockPath, "utf-8").split("\n");
    const pid = Number.parseInt(pidLine.trim(), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const bootId = bootIdLine.trim();
    return { pid, bootId: bootId.length > 0 ? bootId : null, writtenAtMs: statSync(lockPath).mtimeMs };
  } catch {
    return null;
  }
}

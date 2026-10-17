/**
 * One core process for each instance home (docs/plan.md §4.3, lesson 20). The lock is a
 * file that holds the owner's pid. It is created exclusively, and a lock whose owner no
 * longer runs is taken over, so a crash never blocks the next start.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { EvaError } from "../../shared/errors.ts";

export interface InstanceLock {
  release(): void;
}

export interface LockOwner {
  readonly pid: number;
  readonly isProcessAlive: (pid: number) => boolean;
}

export function acquireInstanceLock(lockPath: string, owner: LockOwner): InstanceLock {
  if (!tryCreate(lockPath, owner.pid)) {
    const holder = readHolderPid(lockPath);
    if (holder !== null && holder !== owner.pid && owner.isProcessAlive(holder)) {
      throw new EvaError("instance_locked", `Another Eva (pid ${String(holder)}) already runs with this home folder.`);
    }
    rmSync(lockPath, { force: true });
    if (!tryCreate(lockPath, owner.pid)) {
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

/** The pid of the Eva that holds the lock now, or null when none runs. */
export function runningInstancePid(lockPath: string, isAlive: (pid: number) => boolean): number | null {
  const holder = readHolderPid(lockPath);
  return holder !== null && isAlive(holder) ? holder : null;
}

function tryCreate(lockPath: string, pid: number): boolean {
  try {
    writeFileSync(lockPath, String(pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function readHolderPid(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

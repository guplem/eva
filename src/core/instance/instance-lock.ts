/**
 * One core process for each instance home (lesson 20). The lock is a file that holds the
 * owner's pid, the boot id on Linux, and the uptime on Windows. It is created exclusively,
 * and a lock whose owner no longer runs is taken over, so a crash never blocks the next start.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { EvaError } from "../../shared/errors.ts";

export interface InstanceLock {
  release(): void;
}

/** What tells whether the holder of a lock still runs. */
export interface LockProbe {
  /** This boot's id, or null where the platform gives none. */
  readonly bootId: string | null;
  /** The seconds since this boot, or null to ignore them. By default, `readUptime` on this platform. */
  readonly uptimeSeconds?: number | null;
  readonly isProcessAlive: (pid: number) => boolean;
}

export interface LockOwner extends LockProbe {
  readonly pid: number;
}

interface LockHolder {
  readonly pid: number;
  readonly bootId: string | null;
  readonly uptimeSeconds: number | null;
}

const linuxBootIdPath = "/proc/sys/kernel/random/boot_id";

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

/**
 * The seconds since this boot on Windows, which gives no boot id; null elsewhere. The uptime
 * does not follow the wall clock, so a clock change never makes a live lock look stale.
 */
export function readUptime(platform: NodeJS.Platform, read: () => number = uptime): number | null {
  return platform === "win32" ? read() : null;
}

/** The pid of the Eva that holds the lock now, or null when none runs. */
export function runningInstancePid(lockPath: string, probe: LockProbe): number | null {
  const holder = readHolder(lockPath);
  return holder !== null && isHolderRunning(holder, probe) ? holder.pid : null;
}

/**
 * After a reboot, an unrelated process can have the old pid. The boot id tells such a lock
 * apart: without this check, Eva exits with code 3 and systemd never starts her again.
 * Without a boot id, an uptime lower than the lock's own is possible only after a reboot.
 */
function isHolderRunning(holder: LockHolder, probe: LockProbe): boolean {
  if (holder.bootId !== null && probe.bootId !== null) return holder.bootId === probe.bootId && alive(holder, probe);
  const now = probeUptime(probe);
  if (holder.uptimeSeconds !== null && now !== null && now < holder.uptimeSeconds) return false;
  return alive(holder, probe);
}

function alive(holder: LockHolder, probe: LockProbe): boolean {
  return probe.isProcessAlive(holder.pid);
}

function probeUptime(probe: LockProbe): number | null {
  return probe.uptimeSeconds === undefined ? readUptime(process.platform) : probe.uptimeSeconds;
}

function tryCreate(lockPath: string, owner: LockOwner): boolean {
  try {
    const uptimeSeconds = probeUptime(owner);
    // The boot id stays on the second line, where an older Eva reads it.
    const content =
      owner.bootId === null && uptimeSeconds === null
        ? String(owner.pid)
        : `${String(owner.pid)}\n${owner.bootId ?? ""}\n${uptimeSeconds === null ? "" : String(uptimeSeconds)}\n`;
    writeFileSync(lockPath, content, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const [pidLine = "", bootIdLine = "", uptimeLine = ""] = readFileSync(lockPath, "utf-8").split("\n");
    const pid = Number.parseInt(pidLine.trim(), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const bootId = bootIdLine.trim();
    // An older lock has no uptime, and counts as live while its pid runs.
    const uptimeSeconds = Number.parseFloat(uptimeLine.trim());
    return {
      pid,
      bootId: bootId.length > 0 ? bootId : null,
      uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : null,
    };
  } catch {
    return null;
  }
}

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock, readBootId, runningInstancePid } from "../../../../src/core/instance/instance-lock.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-lock-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function lockError(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (caught) {
    return caught;
  }
}

describe("acquireInstanceLock", () => {
  test("takes the lock, refuses a second holder, and frees it on release", () => {
    const lockPath = join(home, "eva.lock");
    const lock = acquireInstanceLock(lockPath, { pid: process.pid, bootId: null, isProcessAlive: () => true });
    expect(existsSync(lockPath)).toBe(true);

    const error = lockError(() => {
      acquireInstanceLock(lockPath, { pid: 99_999, bootId: null, isProcessAlive: () => true });
    });
    expect(isEvaError(error, "instance_locked")).toBe(true);

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
    acquireInstanceLock(lockPath, { pid: process.pid, bootId: null, isProcessAlive: () => true }).release();
  });

  test("takes over a lock left by a process that no longer runs", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "424242");
    const lock = acquireInstanceLock(lockPath, {
      pid: process.pid,
      bootId: null,
      isProcessAlive: (pid) => pid !== 424242,
    });
    expect(Bun.file(lockPath).size).toBeGreaterThan(0);
    lock.release();
  });

  test("takes over a lock file with no readable pid", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "garbage");
    acquireInstanceLock(lockPath, { pid: process.pid, bootId: null, isProcessAlive: () => true }).release();
  });

  test("takes over a lock from an earlier boot, even when another process now has its pid", () => {
    const lockPath = join(home, "eva.lock");
    acquireInstanceLock(lockPath, { pid: 4242, bootId: "boot-before", isProcessAlive: () => true });
    const lock = acquireInstanceLock(lockPath, { pid: 5151, bootId: "boot-now", isProcessAlive: () => true });
    expect(runningInstancePid(lockPath, { bootId: "boot-now", isProcessAlive: () => true })).toBe(5151);
    lock.release();
  });

  test("refuses a lock from the same boot whose holder runs", () => {
    const lockPath = join(home, "eva.lock");
    acquireInstanceLock(lockPath, { pid: 4242, bootId: "boot-now", isProcessAlive: () => true });
    const error = lockError(() => {
      acquireInstanceLock(lockPath, { pid: 5151, bootId: "boot-now", isProcessAlive: () => true });
    });
    expect(isEvaError(error, "instance_locked")).toBe(true);
  });

  test("trusts the pid alone when either side has no boot id", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242");
    const error = lockError(() => {
      acquireInstanceLock(lockPath, { pid: 5151, bootId: "boot-now", isProcessAlive: () => true });
    });
    expect(isEvaError(error, "instance_locked")).toBe(true);
  });

  test("release twice is harmless", () => {
    const lock = acquireInstanceLock(join(home, "eva.lock"), {
      pid: process.pid,
      bootId: null,
      isProcessAlive: () => true,
    });
    lock.release();
    lock.release();
  });
});

describe("runningInstancePid", () => {
  test("names the Eva that holds the lock only while she runs", () => {
    const lockPath = join(home, "eva.lock");
    expect(runningInstancePid(lockPath, { bootId: null, isProcessAlive: () => true })).toBeNull();
    writeFileSync(lockPath, "4242");
    expect(runningInstancePid(lockPath, { bootId: null, isProcessAlive: () => true })).toBe(4242);
    expect(runningInstancePid(lockPath, { bootId: null, isProcessAlive: () => false })).toBeNull();
  });

  test("names no Eva when the lock comes from an earlier boot", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\nboot-before\n");
    expect(runningInstancePid(lockPath, { bootId: "boot-now", isProcessAlive: () => true })).toBeNull();
  });
});

describe("readBootId", () => {
  test("reads the boot id on Linux", () => {
    const bootIdPath = join(home, "boot_id");
    writeFileSync(bootIdPath, "0f3c-boot\n");
    expect(readBootId("linux", bootIdPath)).toBe("0f3c-boot");
  });

  test("is null on another platform, and when the file cannot be read", () => {
    const bootIdPath = join(home, "boot_id");
    writeFileSync(bootIdPath, "0f3c-boot\n");
    expect(readBootId("win32", bootIdPath)).toBeNull();
    expect(readBootId("linux", join(home, "missing"))).toBeNull();
  });
});

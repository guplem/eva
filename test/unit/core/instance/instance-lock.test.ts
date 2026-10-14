import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "../../../../src/core/instance/instance-lock.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-lock-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("acquireInstanceLock", () => {
  test("takes the lock, refuses a second holder, and frees it on release", () => {
    const lockPath = join(home, "eva.lock");
    const lock = acquireInstanceLock(lockPath, { pid: process.pid, isProcessAlive: () => true });
    expect(existsSync(lockPath)).toBe(true);

    const error: unknown = (() => {
      try {
        acquireInstanceLock(lockPath, { pid: 99_999, isProcessAlive: () => true });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(isEvaError(error, "instance_locked")).toBe(true);

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
    acquireInstanceLock(lockPath, { pid: process.pid, isProcessAlive: () => true }).release();
  });

  test("takes over a lock left by a process that no longer runs", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "424242");
    const lock = acquireInstanceLock(lockPath, { pid: process.pid, isProcessAlive: (pid) => pid !== 424242 });
    expect(Bun.file(lockPath).size).toBeGreaterThan(0);
    lock.release();
  });

  test("takes over a lock file with no readable pid", () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "garbage");
    acquireInstanceLock(lockPath, { pid: process.pid, isProcessAlive: () => true }).release();
  });

  test("release twice is harmless", () => {
    const lock = acquireInstanceLock(join(home, "eva.lock"), { pid: process.pid, isProcessAlive: () => true });
    lock.release();
    lock.release();
  });
});

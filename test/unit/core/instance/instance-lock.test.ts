import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireInstanceLock,
  type LockOwner,
  readBootId,
  runningInstancePid,
} from "../../../../src/core/instance/instance-lock.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-lock-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

async function lockError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (caught) {
    return caught;
  }
}

/** A sleep that returns at once and counts its calls. */
function countedSleep(onSleep: () => void = () => undefined): { sleep: LockOwner["sleep"]; calls: () => number } {
  let calls = 0;
  return {
    sleep: () => {
      calls += 1;
      onSleep();
      return Promise.resolve();
    },
    calls: () => calls,
  };
}

function owner(fields: Partial<LockOwner> & Pick<LockOwner, "pid">): LockOwner {
  return { bootId: null, isProcessAlive: () => true, sleep: () => Promise.resolve(), ...fields };
}

/** Moves the file time, as the heartbeat of a live core does. */
function touch(path: string, at: Date): void {
  utimesSync(path, at, at);
}

describe("acquireInstanceLock", () => {
  test("takes the lock, refuses a second holder, and frees it on release", async () => {
    const lockPath = join(home, "eva.lock");
    const lock = await acquireInstanceLock(lockPath, owner({ pid: process.pid }));
    expect(existsSync(lockPath)).toBe(true);

    let beat = 0;
    const { sleep } = countedSleep(() => {
      beat += 1;
      touch(lockPath, new Date(Date.UTC(2026, 0, 1, 0, 0, beat)));
    });
    const error = await lockError(() => acquireInstanceLock(lockPath, owner({ pid: 99_999, sleep })));
    expect(isEvaError(error, "instance_locked")).toBe(true);

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
    (await acquireInstanceLock(lockPath, owner({ pid: process.pid }))).release();
  });

  test("takes over a lock left by a process that no longer runs", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "424242");
    const lock = await acquireInstanceLock(
      lockPath,
      owner({ pid: process.pid, isProcessAlive: (pid) => pid !== 424242 }),
    );
    expect(Bun.file(lockPath).size).toBeGreaterThan(0);
    lock.release();
  });

  test("takes over a lock file with no readable pid", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "garbage");
    (await acquireInstanceLock(lockPath, owner({ pid: process.pid }))).release();
  });

  test("takes over a lock from an earlier boot, even when another process now has its pid", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\nboot-before\nheartbeat\n");
    const lock = await acquireInstanceLock(lockPath, owner({ pid: 5151, bootId: "boot-now" }));
    expect(runningInstancePid(lockPath, { bootId: "boot-now", isProcessAlive: () => true })).toBe(5151);
    lock.release();
  });

  test("refuses a lock from the same boot whose holder runs, without a wait", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\nboot-now\nheartbeat\n");
    const { sleep, calls } = countedSleep();
    const error = await lockError(() => acquireInstanceLock(lockPath, owner({ pid: 5151, bootId: "boot-now", sleep })));
    expect(isEvaError(error, "instance_locked")).toBe(true);
    expect(calls()).toBe(0);
  });

  test("trusts the pid alone for a lock of an older Eva, which has no heartbeat", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242");
    const { sleep, calls } = countedSleep();
    const error = await lockError(() => acquireInstanceLock(lockPath, owner({ pid: 5151, bootId: "boot-now", sleep })));
    expect(isEvaError(error, "instance_locked")).toBe(true);
    expect(calls()).toBe(0);
  });

  test("on Windows, takes over a lock whose file never changes, when another process has its pid (#528)", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\n\nheartbeat\n");
    const { sleep, calls } = countedSleep();
    const lock = await acquireInstanceLock(
      lockPath,
      owner({ pid: 5151, sleep, heartbeatMs: 5_000, staleAfterMs: 60_000 }),
    );
    expect(calls()).toBe(12);
    expect(readFileSync(lockPath, "utf-8").split("\n")[0]).toBe("5151");
    lock.release();
  });

  test("on Windows, refuses a lock whose holder beats, whatever the clock says (#528)", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\n\nheartbeat\n");
    // A clock that stepped back a year: the file time is far older than the boot, yet the holder lives.
    touch(lockPath, new Date(Date.UTC(2025, 0, 1)));
    const { sleep, calls } = countedSleep(() => {
      touch(lockPath, new Date(Date.UTC(2025, 0, 1, 0, 0, 5)));
    });
    const error = await lockError(() => acquireInstanceLock(lockPath, owner({ pid: 5151, sleep })));
    expect(isEvaError(error, "instance_locked")).toBe(true);
    expect(calls()).toBe(1);
    expect(readFileSync(lockPath, "utf-8").split("\n")[0]).toBe("4242");
  });

  test("takes the lock when the holder releases it during the wait", async () => {
    const lockPath = join(home, "eva.lock");
    writeFileSync(lockPath, "4242\n\nheartbeat\n");
    const { sleep } = countedSleep(() => {
      rmSync(lockPath, { force: true });
    });
    const lock = await acquireInstanceLock(lockPath, owner({ pid: 5151, sleep }));
    expect(readFileSync(lockPath, "utf-8").split("\n")[0]).toBe("5151");
    lock.release();
  });

  test("the live core touches its own lock at each beat, and learns when another core took it over", async () => {
    const lockPath = join(home, "eva.lock");
    let tick: () => void = () => undefined;
    let stopped = false;
    let lost = 0;
    const lock = await acquireInstanceLock(
      lockPath,
      owner({
        pid: 4242,
        onLost: () => {
          lost += 1;
        },
        setInterval: (beat) => {
          tick = beat;
          return {
            stop: () => {
              stopped = true;
            },
          };
        },
      }),
    );
    const old = new Date(Date.UTC(2020, 0, 1));
    touch(lockPath, old);
    tick();
    expect(statSync(lockPath).mtimeMs).not.toBe(old.getTime());

    // A missing lock is no takeover: the core goes on.
    rmSync(lockPath);
    tick();
    expect(lost).toBe(0);

    // After a takeover, the lock names another core: its file time stays, and this core learns it lost.
    writeFileSync(lockPath, "5151\n\nheartbeat\n");
    touch(lockPath, old);
    tick();
    expect(statSync(lockPath).mtimeMs).toBe(old.getTime());
    expect(lost).toBe(1);
    expect(stopped).toBe(true);
    lock.release();
    expect(readFileSync(lockPath, "utf-8").split("\n")[0]).toBe("5151");
  });

  test("release leaves the lock of another core in place", async () => {
    const lockPath = join(home, "eva.lock");
    const lock = await acquireInstanceLock(lockPath, owner({ pid: 4242 }));
    writeFileSync(lockPath, "5151\n\nheartbeat\n");
    lock.release();
    expect(readFileSync(lockPath, "utf-8").split("\n")[0]).toBe("5151");
  });

  test("release twice is harmless", async () => {
    const lock = await acquireInstanceLock(join(home, "eva.lock"), owner({ pid: process.pid }));
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

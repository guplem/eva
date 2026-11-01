import { describe, expect, test } from "bun:test";
import { nestedSandboxWorks, shellWallGap, type ShellWallMachine } from "../../../src/core/shell-wall.ts";
import { EvaError } from "../../../src/shared/errors.ts";
import type { ProcessResult } from "../../../src/shared/process-runner.ts";

const found =
  (names: readonly string[]) =>
  (name: string): string | null =>
    names.includes(name) ? `/usr/bin/${name}` : null;

/** A machine whose trial run of bubblewrap gives `reply`. */
function machine(
  platform: NodeJS.Platform,
  names: readonly string[],
  reply: () => ProcessResult = () => ({ exitCode: 0, stdout: "", stderr: "" }),
): ShellWallMachine & { readonly runs: (readonly string[])[] } {
  const runs: (readonly string[])[] = [];
  return {
    platform,
    which: found(names),
    environment: {},
    root: false,
    runs,
    runner: {
      run: (command) => {
        runs.push(command);
        return Promise.resolve().then(reply);
      },
    },
  };
}

describe("shellWallGap (#711)", () => {
  test("Linux with bubblewrap and socat, where a trial run works, has a shell wall", async () => {
    const linux = machine("linux", ["bwrap", "socat"]);
    expect(await shellWallGap(linux)).toBeNull();
    expect(linux.runs[0]?.[0]).toBe("bwrap");
  });

  test("Linux without one of them says which to install, and runs nothing", async () => {
    const linux = machine("linux", ["socat"]);
    const gap = (await shellWallGap(linux)) ?? "";
    expect(gap).toContain("bubblewrap");
    expect(gap).toContain("apt install bubblewrap socat");
    // The install command adds them, also for an Eva from before (#757).
    expect(gap).toContain("Run the install command of Eva again");
    expect(linux.runs).toEqual([]);
  });

  test("an installed bubblewrap that cannot start, or that hangs, says why", async () => {
    const denied = machine("linux", ["bwrap", "socat"], () => ({
      exitCode: 1,
      stdout: "",
      stderr: "bwrap: setting up uid map: Permission denied",
    }));
    expect(await shellWallGap(denied)).toContain("cannot start on this computer: bwrap: setting up uid map");
    const hangs = machine("linux", ["bwrap", "socat"], () => {
      throw new EvaError("process_timeout", "bwrap did not end in time.");
    });
    expect(await shellWallGap(hangs)).toContain("bwrap did not end in time.");
  });

  test("macOS has its own sandbox, and native Windows has none that Eva can turn on", async () => {
    expect(await shellWallGap(machine("darwin", []))).toBeNull();
    expect(await shellWallGap(machine("win32", []))).toContain("Windows");
    expect(await shellWallGap(machine("freebsd", []))).toContain("freebsd");
  });
});

describe("nestedSandboxWorks (#760)", () => {
  test("Linux that lets a sandbox start inside a sandbox keeps the socket filter", async () => {
    const linux = machine("linux", ["bwrap", "socat"]);
    expect(await nestedSandboxWorks(linux)).toBe(true);
    // The socket filter makes a second user namespace inside bubblewrap's, so the trial does too.
    expect(linux.runs[0]).toContain("unshare");
  });

  test("Linux that blocks it, such as a recent Ubuntu, or a trial that hangs, turns the filter off", async () => {
    const blocked = machine("linux", ["bwrap", "socat"], () => ({
      exitCode: 1,
      stdout: "",
      stderr: "unshare: write failed /proc/self/uid_map: Operation not permitted",
    }));
    expect(await nestedSandboxWorks(blocked)).toBe(false);
    const hangs = machine("linux", ["bwrap", "socat"], () => {
      throw new EvaError("process_timeout", "bwrap did not end in time.");
    });
    expect(await nestedSandboxWorks(hangs)).toBe(false);
    expect(await nestedSandboxWorks(machine("linux", ["socat"]))).toBe(false);
  });

  test("macOS needs no trial: its sandbox makes no namespace", async () => {
    const mac = machine("darwin", []);
    expect(await nestedSandboxWorks(mac)).toBe(true);
    expect(mac.runs).toEqual([]);
  });
});

describe("nestedSandboxWorks, as Claude Code builds its sandbox (review of #760)", () => {
  test("the trial drops every right, as Claude Code does, so a root Eva sees what its commands see", async () => {
    const user = machine("linux", ["bwrap", "socat"]);
    await nestedSandboxWorks(user);
    expect(user.runs[0]).toContain("--cap-drop");
    expect(user.runs[0]).not.toContain("--cap-add");
    // As root, Claude Code keeps the one right that a nested namespace needs.
    const root = { ...machine("linux", ["bwrap", "socat"]), root: true };
    await nestedSandboxWorks(root);
    expect(root.runs[0]).toContain("CAP_SETFCAP");
  });
});

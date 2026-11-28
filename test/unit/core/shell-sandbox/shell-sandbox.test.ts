import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  runShellSandbox,
  sandboxFailedMessage,
  type SandboxLibrary,
  type ShellSandboxRun,
} from "../../../../src/core/shell-sandbox/shell-sandbox.ts";
import type { SandboxedCommandStarter } from "../../../../src/shared/sandboxed-command.ts";

const wallConfig = {
  network: { allowedDomains: ["github.com"], deniedDomains: ["localhost"] },
  filesystem: { denyRead: ["/srv/vault"], allowRead: ["/srv/vault/Projects/p"], allowWrite: [], denyWrite: [] },
};

interface Recorded {
  readonly steps: string[];
  readonly started: { command: readonly string[]; cwd: string; environment: Readonly<Record<string, string>> }[];
  readonly errors: string[];
  readonly temporaryFolders: string[];
  readonly temporaryFolderExisted: boolean[];
}

function fakeRun(
  overrides: { library?: Partial<SandboxLibrary>; start?: SandboxedCommandStarter; wallText?: string | null } = {},
): { run: ShellSandboxRun; recorded: Recorded } {
  const recorded: Recorded = { steps: [], started: [], errors: [], temporaryFolders: [], temporaryFolderExisted: [] };
  const library: SandboxLibrary = {
    initialize: (config) => {
      recorded.steps.push(`initialize ${JSON.stringify(config)}`);
      return Promise.resolve();
    },
    wrap: (command, temporaryFolder) => {
      recorded.temporaryFolders.push(temporaryFolder);
      recorded.temporaryFolderExisted.push(existsSync(temporaryFolder));
      recorded.steps.push(`wrap ${command}`);
      return Promise.resolve(["/bin/bash", "-c", `boxed ${command}`]);
    },
    cleanup: () => {
      recorded.steps.push("cleanup");
    },
    reset: () => {
      recorded.steps.push("reset");
      return Promise.resolve();
    },
    ...overrides.library,
  };
  const start: SandboxedCommandStarter =
    overrides.start ??
    ((command, options) => {
      recorded.steps.push("start");
      recorded.started.push({ command, ...options });
      return Promise.resolve(7);
    });
  const wallText = overrides.wallText === undefined ? JSON.stringify(wallConfig) : overrides.wallText;
  return {
    recorded,
    run: {
      wallFile: "/srv/eva/engines/pi/shell-walls/turn.json",
      command: "cat notes.md",
      cwd: "/srv/vault/Projects/p",
      environment: { PATH: "/usr/bin" },
      library,
      start,
      readText: (path) => (path === "/srv/eva/engines/pi/shell-walls/turn.json" ? wallText : null),
      enterFolder: (folder) => {
        recorded.steps.push(`enter ${folder}`);
      },
      temporaryRoot: tmpdir(),
      writeError: (text) => {
        recorded.errors.push(text);
      },
    },
  };
}

describe("eva shell-sandbox, the wrapper of a pi Project chat's shell (#759)", () => {
  test("runs the model's command in the sandbox of the wall file, in its folder, and gives its exit code", async () => {
    const { run, recorded } = fakeRun();
    expect(await runShellSandbox(run)).toBe(7);
    expect(recorded.steps).toEqual([
      "enter /srv/vault/Projects/p",
      `initialize ${JSON.stringify(wallConfig)}`,
      "wrap cat notes.md",
      "start",
      "cleanup",
      "reset",
    ]);
    expect(recorded.started).toEqual([
      {
        command: ["/bin/bash", "-c", "boxed cat notes.md"],
        cwd: "/srv/vault/Projects/p",
        environment: { PATH: "/usr/bin" },
      },
    ]);
    expect(recorded.errors).toEqual([]);
  });

  test("a missing or broken wall file runs nothing: the wall fails closed", async () => {
    for (const wallText of [null, "not json", "[]", "null", '"text"']) {
      const { run, recorded } = fakeRun({ wallText });
      expect(await runShellSandbox(run)).toBe(126);
      expect(recorded.started).toEqual([]);
      expect(recorded.errors).toEqual([`${sandboxFailedMessage}\n`]);
    }
  });

  test("a sandbox that cannot start runs nothing, and the message names no path", async () => {
    const { run, recorded } = fakeRun({
      library: { initialize: () => Promise.reject(new Error("bwrap failed on /srv/vault/secret")) },
    });
    expect(await runShellSandbox(run)).toBe(126);
    expect(recorded.started).toEqual([]);
    expect(recorded.steps).toContain("reset");
    expect(recorded.errors.join("")).not.toContain("/srv");
    expect(sandboxFailedMessage).not.toMatch(/[/\\]/);
  });

  test("a wrap that fails runs nothing", async () => {
    const { run, recorded } = fakeRun({ library: { wrap: () => Promise.reject(new Error("no shell")) } });
    expect(await runShellSandbox(run)).toBe(126);
    expect(recorded.started).toEqual([]);
  });

  test("a command that cannot start fails, and the sandbox still cleans up", async () => {
    const { run, recorded } = fakeRun({ start: () => Promise.reject(new Error("no bash")) });
    expect(await runShellSandbox(run)).toBe(126);
    expect(recorded.steps.slice(-2)).toEqual(["cleanup", "reset"]);
    expect(recorded.errors).toEqual([`${sandboxFailedMessage}\n`]);
  });

  test("a failed cleanup does not change the command's exit code", async () => {
    const { run } = fakeRun({
      library: {
        cleanup: () => {
          throw new Error("busy");
        },
        reset: () => Promise.reject(new Error("busy")),
      },
    });
    expect(await runShellSandbox(run)).toBe(7);
  });
});

describe("the temporary folder of each sandboxed command (#759)", () => {
  test("is new for each command, in the temporary folder that the wall keeps writable, and goes after it", async () => {
    const first = fakeRun();
    const second = fakeRun();
    await runShellSandbox(first.run);
    await runShellSandbox(second.run);
    const [folder] = first.recorded.temporaryFolders;
    expect(folder?.startsWith(tmpdir())).toBe(true);
    expect(first.recorded.temporaryFolderExisted).toEqual([true]);
    expect(second.recorded.temporaryFolders[0]).not.toBe(folder);
    expect(existsSync(folder ?? "")).toBe(false);
  });

  test("goes also when the wrap or the command fails", async () => {
    const folders: string[] = [];
    const wrapFails = fakeRun({
      library: {
        wrap: (_command, temporaryFolder) => {
          folders.push(temporaryFolder);
          return Promise.reject(new Error("no shell"));
        },
      },
    });
    expect(await runShellSandbox(wrapFails.run)).toBe(126);
    const startFails = fakeRun({ start: () => Promise.reject(new Error("no bash")) });
    expect(await runShellSandbox(startFails.run)).toBe(126);
    folders.push(...startFails.recorded.temporaryFolders);
    expect(folders).toHaveLength(2);
    for (const folder of folders) expect(existsSync(folder)).toBe(false);
  });
});

describe("where the wrapper runs (#759)", () => {
  test("it goes to the chat's folder before the library starts: the library protects that folder's files", async () => {
    const { run, recorded } = fakeRun();
    await runShellSandbox(run);
    expect(recorded.steps.slice(0, 2)).toEqual([
      "enter /srv/vault/Projects/p",
      `initialize ${JSON.stringify(wallConfig)}`,
    ]);
  });

  test("a folder that it cannot enter, or no temporary folder, runs nothing", async () => {
    const noFolder = fakeRun();
    const enterFails = {
      ...noFolder.run,
      enterFolder: () => {
        throw new Error("no such folder");
      },
    };
    expect(await runShellSandbox(enterFails)).toBe(126);
    expect(noFolder.recorded.started).toEqual([]);
    const noTemporary = fakeRun();
    expect(await runShellSandbox({ ...noTemporary.run, temporaryRoot: "/no/such/temporary/folder" })).toBe(126);
    expect(noTemporary.recorded.started).toEqual([]);
    expect(noTemporary.recorded.steps).toEqual([]);
  });
});

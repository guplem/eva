import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  maxSearchRules,
  runSearchScopeSync,
  searchExclusions,
  searchIndexProblem,
  SearchIndexSync,
  syncInputName,
  syncScriptName,
  type SearchIndexResult,
} from "../../../../src/core/files/windows-search.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessResult, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { gitHookTimeoutMs, runGit } from "../../../support/git-sandbox.ts";

const gitEnvironment: Record<string, string> = {
  ...(Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => !name.startsWith("GIT_") && value !== undefined),
  ) as Record<string, string>),
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = { runner: systemProcessRunner, environment: gitEnvironment };

let root = "";

function write(path: string, content = "x"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-windows-search-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("searchExclusions", () => {
  const project = "Projects/2026-01-01-0000-example-app";
  const repository = `${project}/repos/clone-0/example-app`;

  test(
    "excludes ignored entries, .git folders and secret files, but keeps the clones",
    async () => {
      const vault = join(root, "vault");
      mkdirSync(vault);
      runGit(vault, ["init", "-q"]);
      write("vault/.gitignore", "Projects/*/repos/\n.eva/scratch/\nbuild/\n");
      write("vault/notes/note.md");
      write("vault/.env.local", "TOKEN=1");
      write("vault/build/out.txt");
      write("vault/.eva/scratch/sent/file.txt");
      write(`vault/${project}/README.md`);
      const clone = join(root, "vault", repository);
      mkdirSync(clone, { recursive: true });
      runGit(clone, ["init", "-q"]);
      write(`vault/${repository}/.gitignore`, "node_modules/\ndist/\n");
      write(`vault/${repository}/src/main.ts`);
      write(`vault/${repository}/node_modules/pkg/index.js`);
      write(`vault/${repository}/lib/sub/node_modules/deep/deep.js`);
      write(`vault/${repository}/dist/out.js`);

      const excludes = await searchExclusions(vault, git);

      expect(excludes.sort()).toEqual(
        [
          ".git/",
          ".env.local",
          ".eva/scratch/",
          "build/",
          `${repository}/.git/`,
          `${repository}/dist/`,
          `${repository}/lib/sub/node_modules/`,
          `${repository}/node_modules/`,
        ].sort(),
      );
    },
    gitHookTimeoutMs,
  );

  test("keeps only the .git folder of a vault that git cannot read", async () => {
    mkdirSync(join(root, "plain"));
    expect(await searchExclusions(join(root, "plain"), git)).toEqual([".git/"]);
  });

  test("keeps the .git folders first when the list is too long", async () => {
    const lines = Array.from({ length: maxSearchRules + 10 }, (_, index) => `!! file-${String(index)}.log`);
    const runner: ProcessRunner = {
      run: (command) =>
        Promise.resolve({
          exitCode: 0,
          stdout: command.includes("status") ? lines.join("\0") : "",
          stderr: "",
        }),
    };
    const excludes = await searchExclusions(root, { runner, environment: {} });
    expect(excludes).toHaveLength(maxSearchRules);
    expect(excludes[0]).toBe(".git/");
  });
});

describe("runSearchScopeSync", () => {
  function fakeRunner(reply: () => ProcessResult | Promise<ProcessResult>): ProcessRunner & {
    readonly commands: (readonly string[])[];
    readonly inputs: string[];
  } {
    const commands: (readonly string[])[] = [];
    const inputs: string[] = [];
    return {
      commands,
      inputs,
      run: (command) => {
        commands.push(command);
        const inputFile = command[command.indexOf("-InputFile") + 1] ?? "";
        inputs.push(readFileSync(inputFile, "utf8"));
        return Promise.resolve().then(reply);
      },
    };
  }

  function run(runner: ProcessRunner, remove = false): Promise<SearchIndexResult> {
    return runSearchScopeSync(
      { runner, environment: { SystemRoot: "C:\\Windows" }, folder: join(root, "state", "windows-search") },
      { vaultPath: "C:\\vault", excludes: [".git/", "build/"], remove },
    );
  }

  test("writes the script and its input, and runs PowerShell on them", async () => {
    const runner = fakeRunner(() => ({
      exitCode: 0,
      stdout: '{"added":["a","b"],"removed":["c"],"saved":true,"error":null}\r\n',
      stderr: "",
    }));
    expect(await run(runner)).toEqual({ kind: "synced", added: 2, removed: 1 });
    const command = runner.commands[0] ?? [];
    expect(command[0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(command).toContain("-NonInteractive");
    expect(command).toContain("Bypass");
    const script = command[command.indexOf("-File") + 1] ?? "";
    expect(existsSync(script)).toBe(true);
    expect(JSON.parse(runner.inputs[0] ?? "")).toEqual({
      vaultPath: "C:\\vault",
      excludes: [".git/", "build/"],
      remove: false,
    });
  });

  test("keeps the script ASCII, as Windows PowerShell reads it in the ANSI code page", async () => {
    await run(fakeRunner(() => ({ exitCode: 0, stdout: '{"added":[],"removed":[]}', stderr: "" })));
    const bytes = readFileSync(join(root, "state", "windows-search", "sync-search-scope.ps1"));
    expect(bytes.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126))).toBe(true);
  });

  test("tells a missing Search API apart from a failure", async () => {
    const unavailable = fakeRunner(() => ({
      exitCode: 2,
      stdout: '{"error":"Windows Search is not available: no service."}',
      stderr: "",
    }));
    expect(await run(unavailable)).toEqual({
      kind: "unavailable",
      reason: "Windows Search is not available: no service.",
    });
    const failed = fakeRunner(() => ({ exitCode: 4, stdout: "", stderr: "SaveAll failed." }));
    expect(await run(failed)).toEqual({ kind: "failed", reason: "SaveAll failed." });
  });

  test("reports a timeout, as SaveAll can hang", async () => {
    const runner = fakeRunner(() => {
      throw new EvaError("process_timeout", "powershell.exe ran past 60000 ms.");
    });
    expect(await run(runner)).toEqual({ kind: "timeout" });
  });

  test("reports a PowerShell that does not start as a failure", async () => {
    const runner = fakeRunner(() => {
      throw new EvaError("process_failed", "Could not start powershell.exe.");
    });
    expect(await run(runner)).toEqual({ kind: "failed", reason: "Could not start powershell.exe." });
  });
});

describe("searchIndexProblem", () => {
  test("warns on a timeout or a failure only", () => {
    expect(searchIndexProblem({ kind: "synced", added: 1, removed: 0 })).toBeNull();
    expect(searchIndexProblem({ kind: "unavailable", reason: "off" })).toBeNull();
    expect(searchIndexProblem({ kind: "timeout" })?.level).toBe("warn");
    expect(searchIndexProblem({ kind: "timeout" })?.message).toContain("restart this computer");
    expect(searchIndexProblem({ kind: "failed", reason: "SaveAll failed." })?.message).toContain("SaveAll failed");
  });
});

describe("SearchIndexSync", () => {
  test("runs one sync at a time, and one more after requests that came during it", async () => {
    const releases: (() => void)[] = [];
    let runs = 0;
    const sync = new SearchIndexSync(() => {
      runs += 1;
      return new Promise<undefined>((resolve) => releases.push(() => resolve(undefined)));
    });
    const first = sync.request();
    void sync.request();
    void sync.request();
    expect(runs).toBe(1);
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
    releases.shift()?.();
    await first;
    expect(runs).toBe(2);
  });

  test("stops after a sync asks to stop", async () => {
    let runs = 0;
    const sync = new SearchIndexSync(() => {
      runs += 1;
      return Promise.resolve("stop" as const);
    });
    await sync.request();
    await sync.request();
    expect(runs).toBe(1);
  });
});

describe("the uninstall", () => {
  test("runs the script that Eva writes, from the folder where she writes it", () => {
    const uninstall = readFileSync(join(import.meta.dir, "../../../../install/uninstall.ps1"), "utf8");
    expect(uninstall).toContain(String.raw`"eva-$name\state\windows-search"`);
    expect(uninstall).toContain(`'${syncScriptName}'`);
    expect(uninstall).toContain(`'${syncInputName}'`);
  });
});

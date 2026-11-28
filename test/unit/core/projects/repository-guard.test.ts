import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardedArguments, guardRepository } from "../../../../src/core/projects/repository-guard.ts";
import type { EvaError } from "../../../../src/shared/errors.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";
import { markerProgram, type MarkerProgram } from "../../../support/marker-program.ts";

let sandbox: GitSandbox;
let app: string;
let program: MarkerProgram;
let environment: Record<string, string>;

beforeEach(() => {
  sandbox = createGitSandbox();
  app = sandbox.clone(join("clone-0", "app"));
  program = markerProgram(sandbox.root);
  sandbox.write(sandbox.root, "global.gitconfig", "");
  environment = {
    ...gitEnvironment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(sandbox.root, "global.gitconfig").replaceAll("\\", "/"),
  };
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

const repository = (): { name: string; path: string } => ({ name: "app", path: app });

/** A runner that records each command, and runs none: for the cases where no git may start. */
function recordingRunner(): ProcessRunner & { readonly commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    run(command) {
      commands.push([...command]);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
  };
}

async function refusal(runner: ProcessRunner = systemProcessRunner): Promise<EvaError> {
  try {
    await guardRepository(repository(), runner, environment);
  } catch (error) {
    if (isEvaError(error, "repository_refused")) return error;
    throw error;
  }
  throw new Error("The guard let the repository through.");
}

/** The value of a forced setting in the environment that the guard gives. */
function forced(guarded: Readonly<Record<string, string>>, key: string): string | undefined {
  let value: string | undefined;
  const count = Number(guarded["GIT_CONFIG_COUNT"] ?? "0");
  for (let index = 0; index < count; index += 1)
    if (guarded[`GIT_CONFIG_KEY_${String(index)}`] === key) value = guarded[`GIT_CONFIG_VALUE_${String(index)}`];
  return value;
}

describe("guardRepository: the layout of the git folder", () => {
  test("a normal clone passes, with the forced settings and no hooks", async () => {
    const guarded = await guardRepository(repository(), systemProcessRunner, environment);
    expect(forced(guarded, "core.fsmonitor")).toBe("");
    expect(forced(guarded, "core.hooksPath")).toContain("eva-no-hooks-");
  });

  test("a git folder that points elsewhere gets no git call, and the message names only the folder", async () => {
    renameSync(join(app, ".git"), join(sandbox.root, "elsewhere.git"));
    writeFileSync(join(app, ".git"), `gitdir: ${join(sandbox.root, "elsewhere.git")}\n`);
    const runner = recordingRunner();
    const error = await refusal(runner);
    expect(runner.commands).toEqual([]);
    expect(error.message).toContain("app");
    expect(error.message).not.toContain(sandbox.root);
  });

  test("a git folder that is a link gets no git call", async () => {
    renameSync(join(app, ".git"), join(sandbox.root, "linked.git"));
    try {
      symlinkSync(join(sandbox.root, "linked.git"), join(app, ".git"), "junction");
    } catch {
      return; // A Windows account without the right to make links cannot make this case.
    }
    const runner = recordingRunner();
    await refusal(runner);
    expect(runner.commands).toEqual([]);
  });

  test("a commondir file gets no git call, and no program of the folder that it names runs", async () => {
    const other = join(sandbox.root, "other");
    sandbox.git(sandbox.root, "init", "-q", other);
    sandbox.git(other, "config", "core.fsmonitor", program.path);
    writeFileSync(join(app, ".git", "commondir"), join(other, ".git") + "\n");
    const runner = recordingRunner();
    await refusal(runner);
    expect(runner.commands).toEqual([]);
    await refusal();
    expect(program.ran()).toBe(false);
  });

  test("a config.worktree file gets no git call", async () => {
    writeFileSync(join(app, ".git", "config.worktree"), `[core]\n\tfsmonitor = ${program.path}\n`);
    const runner = recordingRunner();
    await refusal(runner);
    expect(runner.commands).toEqual([]);
  });

  test("a config that is not a file gets no git call", async () => {
    renameSync(join(app, ".git", "config"), join(app, ".git", "config.old"));
    mkdirSync(join(app, ".git", "config"));
    const runner = recordingRunner();
    await refusal(runner);
    expect(runner.commands).toEqual([]);
  });
});

describe("guardRepository: the repository's own settings", () => {
  const programSettings = [
    "filter.example.clean",
    "filter.example.smudge",
    "filter.example.process",
    "diff.example.command",
    "diff.example.textconv",
    "diff.external",
    "gc.recentObjectsHook",
    "core.askPass",
    "core.alternateRefsCommand",
    "merge.example.driver",
    "difftool.example.cmd",
    "mergetool.example.cmd",
    "guitool.example.cmd",
    "credential.helper",
    "credential.https://example.invalid.helper",
    "core.sshCommand",
    "core.gitProxy",
    "core.worktree",
    "gpg.program",
    "gpg.ssh.program",
    "gpg.ssh.defaultKeyCommand",
    "remote.origin.uploadpack",
    "remote.origin.receivepack",
    "remote.origin.vcs",
    "remote.origin.proxy",
    "url.https://example.invalid/.insteadOf",
    "url.https://example.invalid/.pushInsteadOf",
    "http.proxy",
    "http.https://github.com.proxy",
    "http.sslVerify",
    "http.sslCAInfo",
    "http.sslCAPath",
    "protocol.allow",
    "protocol.ext.allow",
    "submodule.example.update",
    "pager.log",
    "include.path",
    "includeIf.gitdir:/.path",
    "core.fsmonitor",
    "lfs.extension.example.clean",
    "lfs.extension.example.smudge",
    "lfs.customtransfer.example.path",
    "lfs.standalonetransferagent",
  ];

  // An include names a config file, not a program. A missing one is no error for git.
  const valueFor = (key: string): string => {
    if (key.startsWith("include")) return join(sandbox.root, "missing.gitconfig").replaceAll("\\", "/");
    // A submodule's update setting is a command only when it starts with `!`.
    return key.endsWith(".update") ? `!${program.path}` : program.path;
  };

  for (const key of programSettings) {
    test(`a repository whose own config sets ${key} is refused, and the check runs nothing`, async () => {
      sandbox.git(app, "config", key, valueFor(key));
      const error = await refusal();
      expect(error.message.toLowerCase()).toContain(key.toLowerCase().split(".")[0] ?? "");
      expect(error.message).toContain("global");
      expect(program.ran()).toBe(false);
    });

    test(`${key} in the person's global config is the person's own, so it passes`, async () => {
      sandbox.git(sandbox.root, "config", "--file", environment["GIT_CONFIG_GLOBAL"] ?? "", key, valueFor(key));
      await guardRepository(repository(), systemProcessRunner, environment);
    });
  }

  test("an included file that names a program is refused, and the check runs nothing", async () => {
    const included = join(sandbox.root, "included.gitconfig").replaceAll("\\", "/");
    writeFileSync(included, `[core]\n\tfsmonitor = ${program.path}\n`);
    sandbox.git(app, "config", "include.path", included);
    await refusal();
    expect(program.ran()).toBe(false);
  });

  test("the built-in file-system monitor is no program of the repository, so it passes", async () => {
    sandbox.git(app, "config", "core.fsmonitor", "true");
    await guardRepository(repository(), systemProcessRunner, environment);
  });

  test("the exact filter settings of Git LFS pass", async () => {
    sandbox.git(app, "config", "filter.lfs.clean", "git-lfs clean -- %f");
    sandbox.git(app, "config", "filter.lfs.smudge", "git-lfs smudge -- %f");
    sandbox.git(app, "config", "filter.lfs.process", "git-lfs filter-process");
    sandbox.git(app, "config", "filter.lfs.required", "true");
    await guardRepository(repository(), systemProcessRunner, environment);
  });

  test("a Git LFS filter with any other text is refused, with what the person can do", async () => {
    sandbox.git(app, "config", "filter.lfs.clean", `git-lfs clean -- %f; ${program.path}`);
    const error = await refusal();
    expect(error.message).toContain("filter.lfs.clean");
    expect(error.message).toContain("global");
  });

  test("a local hooks folder, as husky sets it, passes, and Eva's git runs no hook of it", async () => {
    sandbox.write(app, ".husky/pre-commit", `#!/bin/sh\n"${program.path}"\n`);
    sandbox.git(app, "config", "core.hooksPath", ".husky");
    const guarded = await guardRepository(repository(), systemProcessRunner, environment);
    sandbox.write(app, "new.txt", "new\n");
    await systemProcessRunner.run(["git", "add", "-A"], { cwd: app, environment: guarded, timeoutMs: 20_000 });
    const commit = await systemProcessRunner.run(["git", "commit", "-q", "-m", "new"], {
      cwd: app,
      environment: guarded,
      timeoutMs: 20_000,
    });
    expect(commit.exitCode).toBe(0);
    expect(program.ran()).toBe(false);
  });

  test("a git that cannot list the settings stops the call", async () => {
    const runner: ProcessRunner = {
      run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: bad config line 3" }),
    };
    const error = await guardRepository(repository(), runner, environment).catch((caught: unknown) => caught);
    expect(isEvaError(error, "git_failed")).toBe(true);
  });
});

describe("guardRepository: submodules and the folders above (#1131)", () => {
  test("a .gitmodules that makes git look inside a submodule is refused, and the check runs nothing", async () => {
    sandbox.write(app, ".gitmodules", '[submodule "lib"]\n\tpath = lib\n\turl = ../lib\n\tignore = none\n');
    const error = await refusal();
    expect(error.message).toContain("submodule.lib.ignore");
    expect(program.ran()).toBe(false);
  });

  test("such a .gitmodules only in the index is refused too", async () => {
    const blob = join(sandbox.root, "gitmodules.txt");
    writeFileSync(blob, '[submodule "lib"]\n\tpath = lib\n\turl = ../lib\n\tignore = untracked\n');
    const id = sandbox.git(app, "hash-object", "-w", blob);
    sandbox.git(app, "update-index", "--add", "--cacheinfo", `100644,${id},.gitmodules`);
    await refusal();
  });

  test("a submodule setting that keeps git out of the submodule passes", async () => {
    sandbox.write(app, ".gitmodules", '[submodule "lib"]\n\tpath = lib\n\turl = ../lib\n\tignore = dirty\n');
    await guardRepository(repository(), systemProcessRunner, environment);
  });

  test("a local submodule setting that makes git look inside it is refused", async () => {
    sandbox.git(app, "config", "submodule.lib.ignore", "none");
    await refusal();
  });

  test("a git folder that git does not accept never sends Eva's git to a repository above it", async () => {
    const made = join(sandbox.root, "clone-0", "made");
    mkdirSync(join(made, ".git"), { recursive: true });
    writeFileSync(join(made, ".git", "config"), "");
    // The sandbox folder holds no repository, so the clone folder becomes one, as a vault would be.
    sandbox.git(sandbox.root, "init", "-q", join(sandbox.root, "clone-0"));
    const error = await guardRepository({ name: "made", path: made }, systemProcessRunner, environment).catch(
      (caught: unknown) => caught,
    );
    expect(isEvaError(error)).toBe(true);
  });

  test("a repository folder that is a link gets no git call: the work would land in another folder", async () => {
    const linked = join(sandbox.root, "clone-0", "linked");
    try {
      symlinkSync(app, linked, "junction");
    } catch {
      return; // A Windows account without the right to make links cannot make this case.
    }
    const runner = recordingRunner();
    const error = await guardRepository({ name: "linked", path: linked }, runner, environment).catch(
      (caught: unknown) => caught,
    );
    expect(isEvaError(error, "repository_refused")).toBe(true);
    expect(runner.commands).toEqual([]);
  });

  test("a git folder that is not a whole repository gets no git call", async () => {
    writeFileSync(join(app, ".git", "HEAD"), "not a branch\n");
    const runner = recordingRunner();
    await refusal(runner);
    expect(runner.commands).toEqual([]);
  });

  test("the call arguments force the same safe settings, for a git that reads no GIT_CONFIG_COUNT", () => {
    const pairs = guardedArguments().filter((_, index) => index % 2 === 1);
    expect(pairs).toContain("core.fsmonitor=");
    expect(pairs.some((pair) => pair.startsWith("core.hooksPath="))).toBe(true);
    expect(
      guardedArguments()
        .filter((_, index) => index % 2 === 0)
        .every((flag) => flag === "-c"),
    ).toBe(true);
  });
});

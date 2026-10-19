import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkVaultRepository,
  cloneVault,
  githubCredentialArguments,
  githubTokenVariable,
  pushNewVault,
  vaultNeedsPush,
} from "../../../../src/core/vault/vault-clone.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
beforeEach(() => {
  sandbox = createGitSandbox();
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

async function failure(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("cloneVault", () => {
  test("clones the vault into a new folder, and keeps Eva's credential helper in it", async () => {
    const folder = join(sandbox.root, "eva-home", "vault");
    await cloneVault({ repository: sandbox.remote, folder, runner: systemProcessRunner, environment: gitEnvironment });
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("# Vault");
    const helpers = sandbox.git(folder, "config", "--local", "--get-all", "credential.https://github.com.helper");
    expect(helpers).toContain(githubTokenVariable);
    // The token itself is in no file.
    expect(readFileSync(join(folder, ".git", "config"), "utf8")).not.toContain("x-access-token:");
  });

  test("git gets the token from the environment through the helper, and only then", () => {
    const fill = (environment: Record<string, string>): string =>
      Bun.spawnSync(["git", ...githubCredentialArguments, "credential", "fill"], {
        cwd: sandbox.root,
        env: { ...gitEnvironment, GIT_TERMINAL_PROMPT: "0", ...environment },
        stdin: new TextEncoder().encode("protocol=https\nhost=github.com\n\n"),
      }).stdout.toString();
    const filled = fill({ [githubTokenVariable]: "token-for-the-test" });
    expect(filled).toContain("username=x-access-token");
    expect(filled).toContain("password=token-for-the-test");
  });

  test("a folder that holds files is refused, and a failed clone names the repository", async () => {
    const used = join(sandbox.root, "used");
    mkdirSync(used);
    writeFileSync(join(used, "note.md"), "mine");
    const refused = await failure(
      cloneVault({
        repository: sandbox.remote,
        folder: used,
        runner: systemProcessRunner,
        environment: gitEnvironment,
      }),
    );
    expect(isEvaError(refused, "vault_not_found")).toBe(true);
    const failing: ProcessRunner = { run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "not found" }) };
    const failed = await failure(
      cloneVault({
        repository: "https://github.com/example/vault",
        folder: join(sandbox.root, "new"),
        runner: failing,
        environment: {},
      }),
    );
    expect(String(failed)).toContain("git could not clone https://github.com/example/vault: not found");
  });
});

describe("checkVaultRepository", () => {
  test("returns null when git can read the repository, and git's reason when it cannot", async () => {
    expect(
      await checkVaultRepository({
        repository: sandbox.remote,
        runner: systemProcessRunner,
        environment: gitEnvironment,
      }),
    ).toBeNull();
    const reason = await checkVaultRepository({
      repository: join(sandbox.root, "no-such-repository"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
    });
    expect(reason).not.toBeNull();
    expect(reason).not.toBe("");
  });

  test("asks git with Eva's credential helper, so a token in the environment reaches GitHub", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 128, stdout: "", stderr: "" });
      },
    };
    const reason = await checkVaultRepository({
      repository: "https://github.com/example/vault",
      runner: recording,
      environment: {},
    });
    expect(commands[0]).toEqual([
      "git",
      ...githubCredentialArguments,
      "ls-remote",
      "-q",
      "https://github.com/example/vault",
      "HEAD",
    ]);
    expect(reason).toBe("git ended with exit code 128.");
  });
});

describe("pushNewVault", () => {
  /** A new local vault with one commit on main, and an empty bare repository, as GitHub makes it. */
  function newVault(): { folder: string; empty: string } {
    const folder = join(sandbox.root, "new-vault");
    mkdirSync(folder);
    sandbox.git(folder, "init", "-q", "-b", "main");
    writeFileSync(join(folder, "AGENTS.md"), "# Vault\n");
    sandbox.git(folder, "add", "-A");
    sandbox.git(folder, "commit", "-q", "-m", "Start the vault");
    const empty = join(sandbox.root, "empty.git");
    mkdirSync(empty);
    sandbox.git(empty, "init", "-q", "--bare", "--initial-branch=main");
    return { folder, empty };
  }

  test("pushes main to the new repository, and keeps Eva's credential helper in the vault", async () => {
    const { folder, empty } = newVault();
    await pushNewVault({ repository: empty, folder, runner: systemProcessRunner, environment: gitEnvironment });
    expect(sandbox.git(empty, "log", "--format=%s", "main")).toContain("Start the vault");
    expect(sandbox.git(folder, "remote", "get-url", "origin")).toContain("empty.git");
    // Sync pulls and pushes main with no extra argument.
    expect(sandbox.git(folder, "rev-parse", "--abbrev-ref", "main@{upstream}")).toContain("origin/main");
    const helpers = sandbox.git(folder, "config", "--local", "--get-all", "credential.https://github.com.helper");
    expect(helpers).toContain(githubTokenVariable);
  });

  test("a rerun after a failed push pushes again, with no second remote or helper", async () => {
    const { folder, empty } = newVault();
    const inputs = { repository: empty, folder, runner: systemProcessRunner, environment: gitEnvironment };
    await pushNewVault(inputs);
    await pushNewVault(inputs);
    const helpers = sandbox.git(folder, "config", "--local", "--get-all", "credential.https://github.com.helper");
    expect(helpers.split("\n").filter((line) => line.includes(githubTokenVariable))).toHaveLength(1);
  });

  test("a vault on another branch, such as master, pushes that branch", async () => {
    const { folder, empty } = newVault();
    sandbox.git(folder, "branch", "-m", "master");
    await pushNewVault({ repository: empty, folder, runner: systemProcessRunner, environment: gitEnvironment });
    expect(sandbox.git(empty, "log", "--format=%s", "master")).toContain("Start the vault");
    // Sync reads the remote's default branch here; only a clone writes it otherwise.
    expect(sandbox.git(folder, "symbolic-ref", "refs/remotes/origin/HEAD")).toContain("refs/remotes/origin/master");
  });

  test("a credential helper that the person set stays", async () => {
    const { folder, empty } = newVault();
    sandbox.git(folder, "config", "--local", "credential.https://github.com.helper", "!their-own-helper");
    await pushNewVault({ repository: empty, folder, runner: systemProcessRunner, environment: gitEnvironment });
    const helpers = sandbox.git(folder, "config", "--local", "--get-all", "credential.https://github.com.helper");
    expect(helpers).toContain("!their-own-helper");
    expect(helpers).toContain(githubTokenVariable);
  });

  test("a failed push names the repository and keeps the local vault", async () => {
    const { folder } = newVault();
    const failed = await failure(
      pushNewVault({
        repository: join(sandbox.root, "missing.git"),
        folder,
        runner: systemProcessRunner,
        environment: gitEnvironment,
      }),
    );
    expect(isEvaError(failed, "git_failed")).toBe(true);
    expect(String(failed)).toContain("missing.git");
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe("# Vault\n");
    // No remote is left behind: sync cannot push to an empty remote, and a rerun of setup offers the push again.
    expect(await vaultNeedsPush({ folder, runner: systemProcessRunner, environment: gitEnvironment })).toBe(true);
  });
});

describe("vaultNeedsPush", () => {
  test("only a git vault with a commit and no remote needs a push", async () => {
    const inputs = { runner: systemProcessRunner, environment: gitEnvironment };
    const plain = join(sandbox.root, "plain");
    mkdirSync(plain);
    expect(await vaultNeedsPush({ ...inputs, folder: plain })).toBe(false);
    sandbox.git(plain, "init", "-q", "-b", "main");
    // No commit yet: a push would fail after GitHub made the repository.
    expect(await vaultNeedsPush({ ...inputs, folder: plain })).toBe(false);
    writeFileSync(join(plain, "AGENTS.md"), "# Vault\n");
    sandbox.git(plain, "add", "-A");
    sandbox.git(plain, "commit", "-q", "-m", "Start the vault");
    expect(await vaultNeedsPush({ ...inputs, folder: plain })).toBe(true);
    // A remote that the person added, even with no fetch yet, is theirs: sync pushes to it.
    sandbox.git(plain, "remote", "add", "origin", "https://github.com/example/vault.git");
    expect(await vaultNeedsPush({ ...inputs, folder: plain })).toBe(false);
    const cloned = sandbox.clone("cloned");
    expect(await vaultNeedsPush({ ...inputs, folder: cloned })).toBe(false);
  });
});

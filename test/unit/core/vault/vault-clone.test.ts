import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkVaultRepository,
  cloneVault,
  githubCredentialArguments,
  githubTokenVariable,
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

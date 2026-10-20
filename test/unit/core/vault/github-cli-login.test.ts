import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubCliAccount } from "../../../../src/core/setup/logins.ts";
import { logInGitHubCli, logOutGitHubCli } from "../../../../src/core/vault/github-cli-login.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunOptions, ProcessRunner } from "../../../../src/shared/process-runner.ts";

interface Call {
  readonly command: readonly string[];
  readonly options: ProcessRunOptions;
}

function recordingRunner(answer: (command: readonly string[]) => Partial<ProcessResult> = () => ({})): {
  runner: ProcessRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    runner: {
      run: (command, options) => {
        calls.push({ command, options });
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", ...answer(command) });
      },
    },
  };
}

let folder: string;
beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), "eva-gh-")), "gh");
});
afterEach(() => {
  rmSync(join(folder, ".."), { recursive: true, force: true });
});

const environment = { PATH: "/usr/bin", GH_TOKEN: "gho_from-the-shell" };

describe("the gh login of the instance", () => {
  test("logs in gh with the token on stdin, in the instance's gh folder", async () => {
    const { runner, calls } = recordingRunner();
    const problem = await logInGitHubCli({ token: "gho_example\r\n", ghFolder: folder, runner, environment });
    expect(problem).toBeNull();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toEqual([
      "gh",
      "auth",
      "login",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
      "--with-token",
      "--insecure-storage",
    ]);
    expect(call?.options.stdin).toBe("gho_example\n");
    expect(call?.options.environment["GH_CONFIG_DIR"]).toBe(folder);
    expect(call?.options.environment["GH_PROMPT_DISABLED"]).toBe("1");
    // gh refuses a login while GH_TOKEN holds another token, and the token never goes into a variable.
    expect(call?.options.environment["GH_TOKEN"]).toBeUndefined();
    expect(Object.values(call?.options.environment ?? {}).join(" ")).not.toContain("gho_example");
    expect(call?.options.timeoutMs).toBeGreaterThan(0);
  });

  test("a refused token gives gh's reason, without the token", async () => {
    const { runner } = recordingRunner(() => ({
      exitCode: 1,
      stderr: "error validating token: missing required scope 'read:org'",
    }));
    const problem = await logInGitHubCli({ token: "gho_example", ghFolder: folder, runner, environment });
    expect(problem).toContain("missing required scope 'read:org'");
    expect(problem).not.toContain("gho_example");
  });

  test("no gh program, or a gh that hangs, is a problem, never a crash", async () => {
    const runner: ProcessRunner = {
      run: () => Promise.reject(new EvaError("process_timeout", "gh did not end in 30 seconds.")),
    };
    const problem = await logInGitHubCli({ token: "gho_example", ghFolder: folder, runner, environment });
    expect(problem).toContain("did not end");
  });

  test("logs out the account that the gh folder holds", async () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "hosts.yml"),
      "github.com:\n    users:\n        example-user:\n            oauth_token: gho_example\n    git_protocol: https\n    oauth_token: gho_example\n    user: example-user\n",
    );
    const { runner, calls } = recordingRunner();
    expect(await logOutGitHubCli({ ghFolder: folder, runner, environment })).toBeNull();
    expect(calls[0]?.command).toEqual(["gh", "auth", "logout", "--hostname", "github.com", "--user", "example-user"]);
    expect(calls[0]?.options.environment["GH_CONFIG_DIR"]).toBe(folder);
  });

  test("with no gh login, there is nothing to log out", async () => {
    const { runner, calls } = recordingRunner();
    expect(await logOutGitHubCli({ ghFolder: folder, runner, environment })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("the gh account of the instance, read from its file", () => {
  test("names the github.com account", () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "hosts.yml"), "github.com:\n    git_protocol: https\n    user: example-user\n");
    expect(githubCliAccount(folder)).toBe("example-user");
  });

  test("no file, a broken file, or another host only: no account", () => {
    expect(githubCliAccount(folder)).toBeNull();
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "hosts.yml"), "github.com: [unclosed");
    expect(githubCliAccount(folder)).toBeNull();
    writeFileSync(join(folder, "hosts.yml"), "github.example.com:\n    user: example-user\n");
    expect(githubCliAccount(folder)).toBeNull();
  });
});

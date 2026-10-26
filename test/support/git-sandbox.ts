/** Throwaway git repositories for tests: a bare "GitHub" remote and clones of it. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface GitSandbox {
  readonly root: string;
  readonly remote: string;
  clone(name: string): string;
  git(cwd: string, ...arguments_: string[]): string;
  write(repository: string, relativePath: string, content: string): void;
  dispose(): void;
}

const gitEnvironment: Record<string, string> = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "Eva Test",
  GIT_AUTHOR_EMAIL: "eva-test@example.invalid",
  GIT_COMMITTER_NAME: "Eva Test",
  GIT_COMMITTER_EMAIL: "eva-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

/** A git command of a sandbox takes well under a second, even on a Windows CI runner. */
const gitTimeoutMs = 20_000;

/**
 * Runs git and waits for it. The wait blocks the event loop, so Bun's test timeout cannot end it:
 * only the timeout of the spawn itself stops a git that hangs.
 */
export function runGit(cwd: string, arguments_: string[], timeoutMs = gitTimeoutMs): string {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd,
    env: gitEnvironment,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  if (result.exitedDueToTimeout === true) {
    throw new Error(`git ${arguments_.join(" ")} timed out after ${String(timeoutMs)} ms`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

let template: string | null = null;

/**
 * Builds the seeded bare remote once per test process. Each sandbox gets a copy of it, so no test
 * sees another test's commits. The copy saves about ten git processes per test: on a Windows CI
 * runner each one is slow. A bare repository stores no absolute path, so the copy stands alone.
 */
function remoteTemplate(): string {
  if (template !== null) return template;
  const root = mkdtempSync(join(tmpdir(), "eva-git-template-"));
  const remote = join(root, "remote.git");
  mkdirSync(remote);
  runGit(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  const seed = join(root, "seed");
  mkdirSync(seed);
  runGit(seed, ["init", "-q", "--initial-branch=main"]);
  runGit(seed, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(seed, "AGENTS.md"), "# Vault\n");
  runGit(seed, ["add", "-A"]);
  runGit(seed, ["commit", "-q", "-m", "seed"]);
  runGit(seed, ["push", "-q", remote, "main"]);
  runGit(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  process.once("exit", () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // The operating system empties its temporary folder later.
    }
  });
  template = remote;
  return remote;
}

export function createGitSandbox(): GitSandbox {
  const root = mkdtempSync(join(tmpdir(), "eva-git-"));
  const remote = join(root, "remote.git");
  cpSync(remoteTemplate(), remote, { recursive: true });

  function git(cwd: string, ...arguments_: string[]): string {
    return runGit(cwd, arguments_);
  }

  return {
    root,
    remote,
    clone(name) {
      const path = join(root, name);
      git(
        root,
        "clone",
        "-q",
        "-c",
        "core.autocrlf=false",
        "-c",
        "user.name=Eva Test",
        "-c",
        "user.email=eva-test@example.invalid",
        remote,
        path,
      );
      return path;
    },
    git,
    write(repository, relativePath, content) {
      const path = join(repository, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    dispose() {
      // On Windows a git or gh child process can still hold the folder after a test ends.
      // A temporary folder left behind is harmless, so a failed cleanup never fails a test.
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
      } catch {
        // The operating system empties its temporary folder later.
      }
    },
  };
}

export { gitEnvironment };

/** Bun gives a hook 5 seconds, apart from the test timeout; git on a Windows CI runner needs more. */
export const gitHookTimeoutMs = 30_000;

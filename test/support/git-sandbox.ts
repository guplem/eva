/** Throwaway git repositories for tests: a bare "GitHub" remote and clones of it. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

export function createGitSandbox(): GitSandbox {
  const root = mkdtempSync(join(tmpdir(), "eva-git-"));
  const remote = join(root, "remote.git");

  function git(cwd: string, ...arguments_: string[]): string {
    const result = Bun.spawnSync(["git", ...arguments_], { cwd, env: gitEnvironment, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString()}`);
    }
    return result.stdout.toString().trim();
  }

  mkdirSync(remote);
  git(remote, "init", "-q", "--bare", "--initial-branch=main");
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", "--initial-branch=main");
  git(seed, "config", "core.autocrlf", "false");
  writeFileSync(join(seed, "AGENTS.md"), "# Vault\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");

  return {
    root,
    remote,
    clone(name) {
      const path = join(root, name);
      git(root, "clone", "-q", "-c", "core.autocrlf=false", remote, path);
      git(path, "config", "user.name", "Eva Test");
      git(path, "config", "user.email", "eva-test@example.invalid");
      return path;
    },
    git,
    write(repository, relativePath, content) {
      const path = join(repository, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    dispose() {
      // On Windows a git process can still hold a file for a moment after a test ends.
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

export { gitEnvironment };

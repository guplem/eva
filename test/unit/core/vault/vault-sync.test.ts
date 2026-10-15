import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let other: string;

function createSync(path: string): VaultSync {
  return new VaultSync({
    vaultPath: path,
    runner: systemProcessRunner,
    environment: gitEnvironment,
    now: () => new Date(2026, 9, 14, 12, 0),
  });
}

function remoteFiles(): string {
  return sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main");
}

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  other = sandbox.clone("other");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

describe("VaultSync.save", () => {
  test("commits every change and pushes it", async () => {
    sandbox.write(vault, "Life/Diary/2026-10-14.md", "A first.\n");
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).toContain("Life/Diary/2026-10-14.md");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (2 files)");
  });

  test("a failing pre-commit hook in the vault never blocks an autosave (lesson 27)", async () => {
    sandbox.write(vault, ".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    chmodSync(join(vault, ".git", "hooks", "pre-commit"), 0o755);
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    expect((await createSync(vault).save()).status).toBe("ok");
    expect(remoteFiles()).toContain("Methods/New.md");
  });

  test("does nothing and stays quiet when nothing changed", async () => {
    const sync = createSync(vault);
    const state = await sync.save();
    expect(state.status).toBe("ok");
    expect(state.lastCommitAt).toBeNull();
    expect(sandbox.git(vault, "rev-list", "--count", "HEAD")).toBe("1");
  });

  test("rebases on a remote that moved on, then pushes", async () => {
    sandbox.write(other, "other.md", "from another machine\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");

    sandbox.write(vault, "mine.md", "from this machine\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles().split("\n").sort()).toEqual(["AGENTS.md", "mine.md", "other.md"]);
  });

  test("keeps a file with a secret out of the commit and reports it, but saves the rest", async () => {
    sandbox.write(vault, "Toolbox/keys.md", "token ghp_" + "a".repeat(36) + "\n");
    sandbox.write(vault, "Methods/Safe.md", "safe\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(state.withheldFiles).toEqual(["Toolbox/keys.md"]);
    expect(remoteFiles()).toContain("Methods/Safe.md");
    expect(remoteFiles()).not.toContain("Toolbox/keys.md");
    expect(existsSync(join(vault, "Toolbox/keys.md"))).toBe(true);
  });

  test("lets a project folder keep its own secret (the owner's vault rule)", async () => {
    sandbox.write(vault, "Projects/2025-01-01-1200-app/.env", "TOKEN=ghp_" + "b".repeat(36) + "\n");
    const state = await createSync(vault).save();
    expect(state.withheldFiles).toEqual([]);
    expect(remoteFiles()).toContain("Projects/2025-01-01-1200-app/.env");
  });

  test("reports a conflict, keeps the local commit, and never discards a change", async () => {
    sandbox.write(other, "AGENTS.md", "# Theirs\n");
    sandbox.git(other, "commit", "-q", "-am", "theirs");
    sandbox.git(other, "push", "-q", "origin", "main");

    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("conflict");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Mine\n");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (1 file)");
    expect(existsSync(join(vault, ".git", "rebase-merge"))).toBe(false);
  });

  test("reports offline when the remote cannot be reached, with the notes committed", async () => {
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("offline");
    expect(sandbox.git(vault, "status", "--porcelain")).toBe("");
  });

  test("refuses to save while a rebase is open (lesson 22)", async () => {
    const gitFolder = sandbox.git(vault, "rev-parse", "--absolute-git-dir");
    sandbox.write(gitFolder, "rebase-merge/head-name", "refs/heads/main\n");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("rebase");
    expect(sandbox.git(vault, "status", "--porcelain")).toContain("note.md");
  });

  test("stays out of a branch that is not the default branch", async () => {
    sandbox.git(vault, "switch", "-q", "-c", "feat/work");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("skipped");
    expect(sandbox.git(vault, "status", "--porcelain")).toContain("note.md");
  });

  test("never commits a cloned project repository", async () => {
    sandbox.write(vault, ".gitignore", "Projects/*/repos/\n");
    sandbox.write(vault, "Projects/2025-01-01-1200-app/repos/app-0/code.ts", "x\n");
    await createSync(vault).save();
    expect(remoteFiles()).not.toContain("code.ts");
  });

  test("runs one operation at a time", async () => {
    const sync = createSync(vault);
    sandbox.write(vault, "a.md", "a\n");
    const [first, second] = await Promise.all([sync.save(), sync.save()]);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(sandbox.git(vault, "rev-list", "--count", "HEAD")).toBe("2");
  });
});

describe("VaultSync.pull", () => {
  test("brings in commits from the remote", async () => {
    sandbox.write(other, "other.md", "news\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    const state = await createSync(vault).pull();
    expect(state.status).toBe("ok");
    expect(existsSync(join(vault, "other.md"))).toBe(true);
  });

  test("keeps local edits that are not committed yet (autostash)", async () => {
    sandbox.write(other, "other.md", "news\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    sandbox.write(vault, "draft.md", "in progress\n");
    await createSync(vault).pull();
    expect(readFileSync(join(vault, "draft.md"), "utf-8")).toBe("in progress\n");
  });
});

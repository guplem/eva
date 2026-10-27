import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitEnvironmentWithToken } from "../../../../src/core/instance/child-environments.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { Logger } from "../../../../src/shared/logger.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let other: string;

function createSync(
  path: string,
  seams: { runner?: ProcessRunner; logger?: Logger; environment?: Record<string, string> } = {},
): VaultSync {
  return new VaultSync({
    vaultPath: path,
    runner: seams.runner ?? systemProcessRunner,
    environment: seams.environment ?? gitEnvironment,
    now: () => new Date(2026, 9, 14, 12, 0),
    ...(seams.logger === undefined ? {} : { logger: seams.logger }),
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

  test("a new machine with no git name or email still saves, as Eva", async () => {
    sandbox.git(vault, "config", "--unset", "user.name");
    sandbox.git(vault, "config", "--unset", "user.email");
    // git would guess an email from the machine's name; a new server often has no such name.
    sandbox.git(vault, "config", "user.useConfigOnly", "true");
    sandbox.write(sandbox.root, "empty.gitconfig", "");
    // No name or email anywhere: not in the variables, nor in the person's own git settings.
    const noIdentity = {
      ...Object.fromEntries(Object.entries(gitEnvironment).filter(([name]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(name))),
      GIT_CONFIG_GLOBAL: join(sandbox.root, "empty.gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    };
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    const sync = createSync(vault, { environment: noIdentity });
    const state = await sync.save();
    expect(state.status).toBe("ok");
    expect(sandbox.git(vault, "log", "-1", "--format=%an <%ae>")).toBe("Eva <eva@localhost>");

    // A name that the person sets later, while Eva runs, wins from the next save on.
    sandbox.git(vault, "config", "user.name", "Alex");
    sandbox.git(vault, "config", "user.email", "alex@example.invalid");
    sandbox.write(vault, "Methods/Later.md", "More steps.\n");
    await sync.save();
    expect(sandbox.git(vault, "log", "-1", "--format=%an <%ae>")).toBe("Alex <alex@example.invalid>");
  });

  test("the person's own git name and email stay on the commits", async () => {
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    await createSync(vault).save();
    expect(sandbox.git(vault, "log", "-1", "--format=%an")).toBe("Eva Test");
  });

  test("the instance's commit identity signs the autosave, over the vault's own git settings", async () => {
    sandbox.git(vault, "config", "user.name", "Someone Else");
    sandbox.git(vault, "config", "user.email", "someone@example.invalid");
    const environment = gitEnvironmentWithToken(
      gitEnvironment,
      {},
      { name: "Example User", email: "1234+example-user@users.noreply.github.com" },
    );
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    expect((await createSync(vault, { environment }).save()).status).toBe("ok");
    expect(sandbox.git(vault, "log", "-1", "--format=%an <%ae> %cn <%ce>")).toBe(
      "Example User <1234+example-user@users.noreply.github.com> Example User <1234+example-user@users.noreply.github.com>",
    );
  });

  test("saves a folder that an agent renamed with git mv, so the rename is staged already", async () => {
    sandbox.write(vault, "Projects/2026-10-21-1924-jobseaker/AGENTS.md", "A project.\n");
    expect((await createSync(vault).save()).status).toBe("ok");
    sandbox.git(vault, "mv", "Projects/2026-10-21-1924-jobseaker", "Projects/2026-10-21-1924-jobseeker");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).toContain("Projects/2026-10-21-1924-jobseeker/AGENTS.md");
    expect(remoteFiles()).not.toContain("jobseaker");
  });

  test("saves a note that an agent deleted with git rm, so the deletion is staged already (#631)", async () => {
    sandbox.write(vault, "Notes/Next Steps.md", "Steps.\n");
    sandbox.write(vault, "Notes/Keep.md", "Kept.\n");
    expect((await createSync(vault).save()).status).toBe("ok");
    sandbox.git(vault, "rm", "-q", "Notes/Next Steps.md");
    sandbox.write(vault, "Notes/Keep.md", "Kept, with an edit.\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).not.toContain("Next Steps.md");
    expect(sandbox.git(sandbox.remote, "show", "main:Notes/Keep.md")).toBe("Kept, with an edit.");
  });

  test("saves the other notes when a new note vanishes between the status read and the add (#631)", async () => {
    sandbox.write(vault, "Notes/Draft.md", "Gone soon.\n");
    sandbox.write(vault, "Notes/Stays.md", "Stays.\n");
    // A person or an agent can rename a note while Eva saves; the status read then names a path that is gone.
    const racing: ProcessRunner = {
      run(command, options) {
        if (command[1] === "add") rmSync(join(vault, "Notes/Draft.md"), { force: true });
        return systemProcessRunner.run(command, options);
      },
    };
    const state = await createSync(vault, { runner: racing }).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).toContain("Notes/Stays.md");
    expect(remoteFiles()).not.toContain("Notes/Draft.md");
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
    expect(state.withheldFiles).toEqual([{ path: "Toolbox/keys.md", reason: "secret" }]);
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
    expect(state.lastError).toContain("The notes are committed here, but Eva could not reach the remote:");
    expect(state.lastError).toContain("missing.git");
    expect(sandbox.git(vault, "status", "--porcelain")).toBe("");
  });

  test("the redact option hides a secret that git names in its error (#447)", async () => {
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "token-value", "missing.git"));
    const sync = new VaultSync({
      vaultPath: vault,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      now: () => new Date(2026, 9, 14, 12, 0),
      redact: (text) => text.replaceAll("token-value", "[redacted]"),
    });
    const pulled = await sync.pull();
    expect(pulled.lastError).toContain("[redacted]");
    expect(pulled.lastError).not.toContain("token-value");
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    expect((await sync.pull()).lastError).toBeNull();
  });

  test("a fetch or a push that fails with no error output still gives a reason (#430)", async () => {
    const silentOn =
      (step: string): ProcessRunner["run"] =>
      (command, options) =>
        command[1] === step
          ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "" })
          : systemProcessRunner.run(command, options);
    const pulled = await createSync(vault, { runner: { run: silentOn("fetch") } }).pull();
    expect(pulled.status).toBe("offline");
    expect(pulled.lastError).toContain("git ended with exit code 128 and wrote no error.");
    sandbox.write(vault, "note.md", "kept\n");
    const committed = await createSync(vault, { runner: { run: silentOn("commit") } }).save();
    expect(committed.lastError).toBe("git commit failed: git ended with exit code 128 and wrote no error.");
    const saved = await createSync(vault, { runner: { run: silentOn("push") } }).save();
    expect(saved.lastError).toContain("git ended with exit code 128 and wrote no error.");
  });

  test("stays out of a branch that is not the default branch", async () => {
    sandbox.git(vault, "switch", "-q", "-c", "feat/work");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("skipped");
    expect(sandbox.git(vault, "status", "--porcelain")).toContain("note.md");
  });

  test("passes the paths on stdin, so many files never exceed the Windows command line (#505)", async () => {
    const commands: { command: readonly string[]; stdin: string | undefined }[] = [];
    const recording: ProcessRunner = {
      run(command, options) {
        commands.push({ command, stdin: options.stdin });
        return systemProcessRunner.run(command, options);
      },
    };
    // A held-back secret makes the commit name its files with --only.
    sandbox.write(vault, "Toolbox/keys.md", "token ghp_" + "c".repeat(36) + "\n");
    for (let index = 0; index < 40; index += 1) sandbox.write(vault, `Notes/n ${String(index)}.md`, "x\n");
    const state = await createSync(vault, { runner: recording }).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).toContain("Notes/n 39.md");
    expect(remoteFiles()).not.toContain("Toolbox/keys.md");
    for (const step of ["add", "commit"]) {
      const run = commands.find(({ command }) => command[1] === step);
      expect(run?.command.some((part) => part.includes("Notes/"))).toBe(false);
      expect(run?.stdin?.split("\0")).toContain("Notes/n 39.md");
    }
    // A status that a timeout kills must leave no index.lock (lesson 81).
    const status = commands.find(({ command }) => command.includes("status"));
    expect(status?.command.slice(1, 3)).toEqual(["--no-optional-locks", "status"]);
  });

  test("a name with accents and spaces reaches the remote through the paths on stdin (#505)", async () => {
    // A held-back secret makes the commit name its files with --only.
    sandbox.write(vault, "Toolbox/keys.md", "token ghp_" + "d".repeat(36) + "\n");
    sandbox.write(vault, "Notes/Café del mar ñ.md", "x\n");
    expect((await createSync(vault).save()).status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "main")).toContain(
      "Notes/Café del mar ñ.md",
    );
  });

  // Windows forbids "*" in a file name.
  test.skipIf(process.platform === "win32")(
    "a path on stdin matches literally: n*.md never pulls in a held-back nb.md (#505)",
    async () => {
      sandbox.write(vault, "Notes/n*.md", "x\n");
      sandbox.write(vault, "Notes/nb.md", "token ghp_" + "e".repeat(36) + "\n");
      const state = await createSync(vault).save();
      expect(state.status).toBe("ok");
      expect(state.withheldFiles).toEqual([{ path: "Notes/nb.md", reason: "secret" }]);
      expect(remoteFiles()).toContain("Notes/n*.md");
      expect(remoteFiles()).not.toContain("Notes/nb.md");
    },
  );

  test("removes an index.lock that a killed git left long ago, and keeps a fresh one (#505)", async () => {
    const lock = join(vault, ".git", "index.lock");
    sandbox.write(vault, "note.md", "kept\n");
    writeFileSync(lock, "");
    expect((await createSync(vault).save()).status).toBe("error");
    expect(existsSync(lock)).toBe(true);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(lock, hourAgo, hourAgo);
    expect((await createSync(vault).save()).status).toBe("ok");
    expect(existsSync(lock)).toBe(false);
    expect(remoteFiles()).toContain("note.md");
  });

  test("keeps an index.lock just under 30 minutes old, and removes one just over, with a warning (#505)", async () => {
    const lock = join(vault, ".git", "index.lock");
    const logged: { level: string; message: string }[] = [];
    const logger: Logger = { log: (level, message) => logged.push({ level, message }) };
    sandbox.write(vault, "note.md", "kept\n");
    writeFileSync(lock, "");
    // A person's git commit holds the lock while its editor is open.
    const underLimit = new Date(Date.now() - 29 * 60_000);
    utimesSync(lock, underLimit, underLimit);
    expect((await createSync(vault, { logger }).save()).status).toBe("error");
    expect(existsSync(lock)).toBe(true);
    expect(logged.some(({ message }) => message.includes("index.lock"))).toBe(false);
    const overLimit = new Date(Date.now() - 31 * 60_000);
    utimesSync(lock, overLimit, overLimit);
    expect((await createSync(vault, { logger }).save()).status).toBe("ok");
    expect(existsSync(lock)).toBe(false);
    expect(logged).toContainEqual({ level: "warn", message: "Eva removed a stale index.lock from the vault." });
  });

  test("syncs a vault on master with no origin/HEAD, when the remote has only master (#505)", async () => {
    sandbox.git(vault, "switch", "-q", "-c", "master");
    sandbox.git(vault, "push", "-q", "-u", "origin", "master");
    // The remote has only master, as after git init and a first push -u.
    sandbox.git(sandbox.remote, "symbolic-ref", "HEAD", "refs/heads/master");
    sandbox.git(vault, "push", "-q", "origin", "--delete", "main");
    sandbox.git(vault, "remote", "set-head", "origin", "-d");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "master")).toContain("note.md");
  });

  test("with no origin/HEAD, asks the remote for its default: master, even when main exists too (#505)", async () => {
    sandbox.git(vault, "switch", "-q", "-c", "master");
    sandbox.git(vault, "push", "-q", "-u", "origin", "master");
    sandbox.git(sandbox.remote, "symbolic-ref", "HEAD", "refs/heads/master");
    sandbox.git(vault, "remote", "set-head", "origin", "-d");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "master")).toContain("note.md");
    expect(remoteFiles()).not.toContain("note.md");
  });

  test("offline with no origin/HEAD, never takes a branch's upstream as the default (#505)", async () => {
    sandbox.git(vault, "switch", "-q", "-c", "trunk");
    sandbox.git(vault, "push", "-q", "-u", "origin", "trunk");
    sandbox.git(sandbox.remote, "symbolic-ref", "HEAD", "refs/heads/trunk");
    sandbox.git(vault, "push", "-q", "origin", "--delete", "main");
    sandbox.git(vault, "remote", "set-head", "origin", "-d");
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    sandbox.write(vault, "note.md", "kept\n");
    expect((await createSync(vault).save()).status).toBe("skipped");
  });

  test("with no origin/HEAD and an unreachable remote, falls back to the remote's main (#505)", async () => {
    sandbox.git(vault, "remote", "set-head", "origin", "-d");
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("offline");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (1 file)");
  });

  test("with no origin/HEAD, stays out of a second branch that has an upstream, while the remote has main (#505)", async () => {
    sandbox.git(vault, "remote", "set-head", "origin", "-d");
    sandbox.git(vault, "switch", "-q", "-c", "ideas");
    sandbox.git(vault, "push", "-q", "-u", "origin", "ideas");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("skipped");
    expect(state.lastError).toBe(
      "Eva syncs main, but the vault is on ideas. If main is right, ask the Assistant to switch the vault back to it.",
    );
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "ideas")).not.toContain("note.md");
  });

  test("a vault with no remote on master commits and reports no branch mismatch (#505)", async () => {
    sandbox.git(vault, "remote", "remove", "origin");
    sandbox.git(vault, "switch", "-q", "-c", "master");
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("offline");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (1 file)");
  });

  test("a vault with no remote stays out of a branch that is neither main nor master (#505)", async () => {
    sandbox.git(vault, "remote", "remove", "origin");
    sandbox.git(vault, "switch", "-q", "-c", "ideas");
    sandbox.write(vault, "note.md", "kept\n");
    expect((await createSync(vault).save()).status).toBe("skipped");
  });

  test("never commits a cloned project repository", async () => {
    sandbox.write(vault, ".gitignore", "Projects/*/repos/\n");
    sandbox.write(vault, "Projects/2025-01-01-1200-app/repos/app-0/code.ts", "x\n");
    await createSync(vault).save();
    expect(remoteFiles()).not.toContain("code.ts");
  });

  test("never commits a file in Scratch/, even when the vault's .gitignore does not list it (#415)", async () => {
    sandbox.write(vault, "Scratch/received/statement.pdf", "A bank statement.\n");
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(state.withheldFiles).toEqual([]);
    expect(remoteFiles()).toContain("Methods/New.md");
    expect(remoteFiles()).not.toContain("Scratch/");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (1 file)");
  });

  test("never commits a Scratch/ file that a person staged by hand", async () => {
    sandbox.write(vault, "Scratch/out/chart.png", "An image.\n");
    sandbox.git(vault, "add", "Scratch/out/chart.png");
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    await createSync(vault).save();
    expect(remoteFiles()).toContain("Methods/New.md");
    expect(remoteFiles()).not.toContain("Scratch/");
  });

  test("saves when a staged Scratch/ file sits beside a note that was staged and then deleted", async () => {
    sandbox.write(vault, "Scratch/out/chart.png", "An image.\n");
    sandbox.git(vault, "add", "Scratch/out/chart.png");
    sandbox.write(vault, "Methods/Gone.md", "Draft.\n");
    sandbox.git(vault, "add", "Methods/Gone.md");
    rmSync(join(vault, "Methods/Gone.md"));
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles()).toContain("Methods/New.md");
    expect(remoteFiles()).not.toContain("Scratch/");
  });

  test("keeps a lowercase scratch/ folder out too, as Windows and macOS ignore the case", async () => {
    sandbox.write(vault, "scratch/received/statement.pdf", "A bank statement.\n");
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    await createSync(vault).save();
    expect(remoteFiles().toLowerCase()).not.toContain("scratch/");
  });

  test("commits the removal of a Scratch/ file that an old commit holds", async () => {
    sandbox.write(vault, "Scratch/old.txt", "Old.\n");
    sandbox.git(vault, "add", "Scratch/old.txt");
    sandbox.git(vault, "commit", "-q", "-m", "old");
    sandbox.git(vault, "push", "-q", "origin", "main");
    // The weekly clean deletes the file without git.
    rmSync(join(vault, "Scratch/old.txt"));
    await createSync(vault).save();
    expect(remoteFiles()).not.toContain("Scratch/");
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

  test("reports a conflict when an edit that is not committed clashes with the remote, and keeps the stash", async () => {
    // git 2.55 exits 0 here: it writes conflict markers into the file and keeps the autostash.
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const state = await createSync(vault).pull();
    expect(state.status).toBe("conflict");
    expect(state.lastError).toContain("AGENTS.md");
    expect(sandbox.git(vault, "stash", "list")).toContain("autostash");
  });

  test("never commits conflict markers, but still commits the other notes and pushes nothing", async () => {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const sync = createSync(vault);
    await sync.pull();
    sandbox.write(vault, "Methods/New.md", "Steps.\n");
    const state = await sync.save();
    expect(state.status).toBe("conflict");
    expect(state.lastError).toContain("AGENTS.md");
    expect(sandbox.git(vault, "show", "HEAD:Methods/New.md")).toBe("Steps.");
    expect(sandbox.git(vault, "show", "HEAD:AGENTS.md")).not.toContain("<<<<<<<");
    expect(remoteFiles()).not.toContain("Methods/New.md");
    expect(sandbox.git(vault, "status", "--porcelain")).toContain("UU AGENTS.md");
  });

  test("reports an error when the autostash stays in the stash and cannot apply again", async () => {
    pushFromOther("other.md", "news\n");
    let rebased = false;
    const leavesStash: ProcessRunner = {
      async run(command, options) {
        const result = await systemProcessRunner.run(command, options);
        if (command[1] === "rebase") rebased = true;
        const isStashList = command[1] === "stash" && command[2] === "list";
        return isStashList && rebased ? { ...result, stdout: `${result.stdout}stash@{0}: autostash\n` } : result;
      },
    };
    const state = await createSync(vault, { runner: leavesStash }).pull();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("stash");
  });
});

describe("VaultSync safety", () => {
  test("aborts a rebase that a crash left open, logs it, then saves (lesson 22)", async () => {
    stopRebaseOnRemote();
    const logged: string[] = [];
    const logger: Logger = { log: (_level, message) => logged.push(message) };
    sandbox.write(vault, "fresh.md", "new note\n");
    const state = await createSync(vault, { logger }).save();
    expect(state.status).toBe("ok");
    expect(remoteFiles().split("\n").sort()).toEqual(["AGENTS.md", "fresh.md", "mine.md", "other.md"]);
    expect(existsSync(join(vault, ".git", "rebase-merge"))).toBe(false);
    expect(logged.join("\n")).toContain("rebase");
  });

  test("refuses to abort an open rebase while a tracked file has an edit, as the abort would lose it (lesson 22)", async () => {
    stopRebaseOnRemote();
    sandbox.write(vault, "AGENTS.md", "# Edited while the rebase was open\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("rebase");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Edited while the rebase was open\n");
  });

  test("reports a rebase that fails with no conflict as an error with its reason", async () => {
    pushFromOther("other.md", "news\n");
    const timesOut: ProcessRunner = {
      run(command, options) {
        return command[1] === "rebase" && command[2] === "-q"
          ? Promise.reject(new EvaError("process_timeout", "git rebase timed out."))
          : systemProcessRunner.run(command, options);
      },
    };
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault, { runner: timesOut }).save();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("timed out");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("eva: autosave (1 file)");
  });

  test("keeps a file over 50 MB out of the commit, in and out of a project folder", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    sandbox.write(vault, "Media/video.mp4", "");
    writeFileSync(join(vault, "Media/video.mp4"), big);
    sandbox.write(vault, "Projects/2025-01-01-1200-app/export.zip", "");
    writeFileSync(join(vault, "Projects/2025-01-01-1200-app/export.zip"), big);
    sandbox.write(vault, "Methods/Safe.md", "safe\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(state.withheldFiles).toEqual([
      { path: "Media/video.mp4", reason: "too_large" },
      { path: "Projects/2025-01-01-1200-app/export.zip", reason: "too_large" },
    ]);
    expect(remoteFiles()).toContain("Methods/Safe.md");
    expect(remoteFiles()).not.toContain("video.mp4");
  });

  test("names the remote's reason when every push fails", async () => {
    sandbox.write(sandbox.remote, "hooks/pre-receive", "#!/bin/sh\necho 'rejected by the remote policy' >&2\nexit 1\n");
    chmodSync(join(sandbox.remote, "hooks", "pre-receive"), 0o755);
    sandbox.write(vault, "note.md", "kept\n");
    const state = await createSync(vault).save();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("rejected by the remote policy");
  });
});

function pushFromOther(relativePath: string, content: string): void {
  sandbox.write(other, relativePath, content);
  sandbox.git(other, "add", "-A");
  sandbox.git(other, "commit", "-q", "-m", "other");
  sandbox.git(other, "push", "-q", "origin", "main");
}

/** Leaves the vault in an open rebase, the way a crash in the middle of a sync does. */
function stopRebaseOnRemote(): void {
  pushFromOther("other.md", "news\n");
  sandbox.write(vault, "mine.md", "mine\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "mine");
  sandbox.git(vault, "fetch", "-q", "origin");
  // An exec step that fails stops the rebase with no conflict.
  expect(() => sandbox.git(vault, "rebase", "-q", "-x", "false", "origin/main")).toThrow();
  expect(existsSync(join(vault, ".git", "rebase-merge"))).toBe(true);
}

describe("VaultSync conflicts", () => {
  /** A committed edit here and a pushed edit there, on the same line. */
  async function committedConflict(sync: VaultSync, path = "AGENTS.md"): Promise<void> {
    pushFromOther(path, "# Theirs\n");
    sandbox.write(vault, path, "# Mine\n");
    expect((await sync.save()).status).toBe("conflict");
  }

  /** An edit that is not committed here, against a pushed edit there. */
  async function uncommittedConflict(sync: VaultSync): Promise<void> {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    expect((await sync.pull()).status).toBe("conflict");
  }

  test("names every note of a committed conflict, in the state and in the list", async () => {
    const sync = createSync(vault);
    await committedConflict(sync);
    expect(sync.currentState.lastError).toContain("AGENTS.md");
    const report = await sync.conflicts();
    expect(report.conflicts).toEqual([
      { path: "AGENTS.md", kind: "committed", picked: null, mine: "# Mine\n", theirs: "# Theirs\n" },
    ]);
  });

  test("lists no conflict when the vault is in sync", async () => {
    expect((await createSync(vault).conflicts()).conflicts).toEqual([]);
  });

  test("keep mine on a committed conflict pushes this machine's version, and history keeps both", async () => {
    const sync = createSync(vault);
    await committedConflict(sync);
    const result = await sync.resolve("AGENTS.md", "mine");
    expect(result.found).toBe(true);
    expect(result.state.status).toBe("ok");
    expect(result.conflicts).toEqual([]);
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Mine");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Mine\n");
    expect(sandbox.git(sandbox.remote, "log", "--format=%s", "main")).toContain("other");
    expect(sandbox.git(sandbox.remote, "rev-list", "--merges", "--count", "main")).toBe("1");
  });

  test("keep theirs on a committed conflict takes the remote's version", async () => {
    const sync = createSync(vault);
    await committedConflict(sync);
    expect((await sync.resolve("AGENTS.md", "theirs")).state.status).toBe("ok");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Theirs\n");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Theirs");
    expect(sandbox.git(sandbox.remote, "log", "--format=%s", "main")).toContain("eva: autosave (1 file)");
  });

  test("keep both on a committed conflict keeps mine at the path and the other version beside it", async () => {
    const sync = createSync(vault);
    await committedConflict(sync, "Notes/Plan.md");
    expect((await sync.resolve("Notes/Plan.md", "both")).state.status).toBe("ok");
    expect(readFileSync(join(vault, "Notes/Plan.md"), "utf-8")).toBe("# Mine\n");
    expect(readFileSync(join(vault, "Notes/Plan (conflict copy).md"), "utf-8")).toBe("# Theirs\n");
    expect(sandbox.git(sandbox.remote, "show", "main:Notes/Plan (conflict copy).md")).toBe("# Theirs");
  });

  test("keep both picks a free name when the copy name is taken", async () => {
    pushFromOther("Notes/Plan (conflict copy).md", "an older copy\n");
    const sync = createSync(vault);
    await committedConflict(sync, "Notes/Plan.md");
    expect((await sync.resolve("Notes/Plan.md", "both")).state.status).toBe("ok");
    expect(readFileSync(join(vault, "Notes/Plan (conflict copy).md"), "utf-8")).toBe("an older copy\n");
    expect(readFileSync(join(vault, "Notes/Plan (conflict copy 2).md"), "utf-8")).toBe("# Theirs\n");
  });

  test("waits for a pick on every note, then pushes once", async () => {
    pushFromOther("b.md", "b theirs\n");
    pushFromOther("a.md", "a theirs\n");
    sandbox.write(vault, "a.md", "a mine\n");
    sandbox.write(vault, "b.md", "b mine\n");
    const sync = createSync(vault);
    await sync.save();
    const first = await sync.resolve("a.md", "theirs");
    expect(first.state.status).toBe("conflict");
    expect(first.conflicts).toEqual([
      { path: "a.md", kind: "committed", picked: "theirs" },
      { path: "b.md", kind: "committed", picked: null },
    ]);
    expect(sandbox.git(sandbox.remote, "show", "main:b.md")).toBe("b theirs");
    // A sweep commit between two picks keeps the first pick.
    sandbox.write(vault, "c.md", "c\n");
    await sync.save();
    const second = await sync.resolve("b.md", "mine");
    expect(second.state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:a.md")).toBe("a theirs");
    expect(sandbox.git(sandbox.remote, "show", "main:b.md")).toBe("b mine");
    expect(sandbox.git(sandbox.remote, "show", "main:c.md")).toBe("c");
  });

  test("keep theirs on a note the remote deleted deletes it; keep both keeps it", async () => {
    sandbox.git(other, "rm", "-q", "AGENTS.md");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const sync = createSync(vault);
    await sync.save();
    expect((await sync.conflicts()).conflicts).toMatchObject([{ path: "AGENTS.md", mine: "# Mine\n", theirs: null }]);
    expect((await sync.resolve("AGENTS.md", "theirs")).state.status).toBe("ok");
    expect(existsSync(join(vault, "AGENTS.md"))).toBe(false);
    expect(remoteFiles()).not.toContain("AGENTS.md");
  });

  test("keep both on a note the remote deleted keeps this machine's version", async () => {
    sandbox.git(other, "rm", "-q", "AGENTS.md");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const sync = createSync(vault);
    await sync.save();
    expect((await sync.resolve("AGENTS.md", "both")).state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Mine");
    expect(remoteFiles()).not.toContain("conflict copy");
  });

  test("shows no text for a version that is binary or too long to read on a phone", async () => {
    pushFromOther("photo.png", "a\0b\n");
    pushFromOther("Long.md", "theirs\n");
    sandbox.write(vault, "photo.png", "c\0d\n");
    sandbox.write(vault, "Long.md", "x".repeat(300_000));
    const sync = createSync(vault);
    await sync.save();
    expect((await sync.conflicts()).conflicts).toMatchObject([
      { path: "Long.md", mine: null, theirs: "theirs\n" },
      { path: "photo.png", mine: null, theirs: null },
    ]);
  });

  test("answers found: false for a note with no conflict, and changes nothing", async () => {
    const sync = createSync(vault);
    await committedConflict(sync);
    const result = await sync.resolve("Other.md", "mine");
    expect(result.found).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Theirs");
  });

  test("keeps the merge when the remote moves before the push, instead of a rebase that brings the conflict back", async () => {
    const sync = createSync(vault);
    await committedConflict(sync);
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    expect((await sync.resolve("AGENTS.md", "mine")).state.status).toBe("offline");
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    pushFromOther("news.md", "news\n");
    const state = await sync.save();
    expect(state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Mine");
    expect(sandbox.git(sandbox.remote, "show", "main:news.md")).toBe("news");
  });

  test("reports git that is too old for merge-tree as an error, never as no conflict", async () => {
    const sync = createSync(vault, {
      runner: {
        run(command, options) {
          return command[1] === "merge-tree"
            ? Promise.resolve({ exitCode: 129, stdout: "", stderr: "error: unknown option `write-tree'" })
            : systemProcessRunner.run(command, options);
        },
      },
    });
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    expect((await sync.save()).lastError).toContain("2.38");
    const report = await sync.conflicts();
    expect(report.state.status).toBe("error");
    expect(report.state.lastError).toContain("2.38");
  });

  test("lists an edit that is not committed as an uncommitted conflict", async () => {
    const sync = createSync(vault);
    await uncommittedConflict(sync);
    expect((await sync.conflicts()).conflicts).toEqual([
      { path: "AGENTS.md", kind: "uncommitted", picked: null, mine: "# Mine\n", theirs: "# Theirs\n" },
    ]);
  });

  test("keep mine on an uncommitted conflict takes this machine's edit, pushes it, and keeps the stash", async () => {
    const sync = createSync(vault);
    await uncommittedConflict(sync);
    const result = await sync.resolve("AGENTS.md", "mine");
    expect(result.state.status).toBe("ok");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Mine\n");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Mine");
    expect(sandbox.git(vault, "stash", "list")).toContain("autostash");
  });

  test("keep theirs on an uncommitted conflict takes the remote's version, and the stash keeps mine", async () => {
    const sync = createSync(vault);
    await uncommittedConflict(sync);
    expect((await sync.resolve("AGENTS.md", "theirs")).state.status).toBe("ok");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# Theirs\n");
    expect(sandbox.git(vault, "stash", "list")).toContain("autostash");
    expect(sandbox.git(vault, "status", "--porcelain")).toBe("");
  });

  test("keep both on an uncommitted conflict writes the copy and pushes both", async () => {
    const sync = createSync(vault);
    await uncommittedConflict(sync);
    expect((await sync.resolve("AGENTS.md", "both")).state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Mine");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS (conflict copy).md")).toBe("# Theirs");
  });

  test("applies the stash again when older git keeps the edits only there", async () => {
    pushFromOther("other.md", "news\n");
    let rebased = false;
    const commands: string[] = [];
    const leavesStash: ProcessRunner = {
      async run(command, options) {
        commands.push(command.slice(1, 3).join(" "));
        if (command[1] === "stash" && command[2] === "apply") return { exitCode: 0, stdout: "", stderr: "" };
        const result = await systemProcessRunner.run(command, options);
        if (command[1] === "rebase") rebased = true;
        const isStashList = command[1] === "stash" && command[2] === "list";
        return isStashList && rebased ? { ...result, stdout: `${result.stdout}stash@{0}: autostash\n` } : result;
      },
    };
    const state = await createSync(vault, { runner: leavesStash }).pull();
    expect(commands).toContain("stash apply");
    expect(state.status).toBe("ok");
  });
});

describe("VaultSync conflict edge cases", () => {
  test("a note name with a glob character gets its own version, not the version of a note it matches", async () => {
    pushFromOther("[ab].md", "bracket base\n");
    pushFromOther("a.md", "a base\n");
    sandbox.git(vault, "pull", "-q");
    pushFromOther("[ab].md", "bracket theirs\n");
    pushFromOther("a.md", "a theirs\n");
    sandbox.write(vault, "[ab].md", "bracket mine\n");
    sandbox.write(vault, "a.md", "a mine\n");
    const sync = createSync(vault);
    expect((await sync.pull()).status).toBe("conflict");
    await sync.resolve("[ab].md", "mine");
    expect(readFileSync(join(vault, "[ab].md"), "utf-8")).toBe("bracket mine\n");
    expect((await sync.conflicts()).conflicts.map((conflict) => conflict.path)).toEqual(["a.md"]);
    // A save must never stage a.md through the pattern: it still holds conflict markers.
    await sync.save();
    expect(sandbox.git(vault, "show", "HEAD:a.md")).not.toContain("<<<<<<<");
    expect(sandbox.git(vault, "status", "--porcelain")).toContain("UU a.md");
  });

  test("drops a pick when the remote changes that note again, so the person sees the new version first", async () => {
    pushFromOther("a.md", "a theirs\n");
    pushFromOther("b.md", "b theirs\n");
    sandbox.write(vault, "a.md", "a mine\n");
    sandbox.write(vault, "b.md", "b mine\n");
    const sync = createSync(vault);
    await sync.save();
    await sync.resolve("a.md", "mine");
    pushFromOther("a.md", "a theirs, with an important change\n");
    await sync.save();
    const result = await sync.resolve("b.md", "mine");
    expect(result.state.status).toBe("conflict");
    // A pick answers with no texts: a phone that taps through many notes must not wait for them.
    expect(result.conflicts).toEqual([
      { path: "a.md", kind: "committed", picked: null },
      { path: "b.md", kind: "committed", picked: "mine" },
    ]);
    // The list shows the remote's new version, so the person reads it before picking again.
    expect((await sync.conflicts()).conflicts[0]).toMatchObject({ theirs: "a theirs, with an important change\n" });
  });
});

describe("VaultSync conflict review fixes", () => {
  test("merges when the rebase stops on a change that a later commit undid, as the merge itself is clean", async () => {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Undone\n");
    sandbox.git(vault, "commit", "-q", "-am", "edit");
    sandbox.write(vault, "AGENTS.md", "# Vault\n");
    sandbox.git(vault, "commit", "-q", "-am", "undo");
    const state = await createSync(vault).save();
    expect(state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Theirs");
  });

  test("never deletes a note when git cannot list its versions", async () => {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const failsToList: ProcessRunner = {
      run(command, options) {
        return command[1] === "ls-files"
          ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: index file corrupt" })
          : systemProcessRunner.run(command, options);
      },
    };
    const sync = createSync(vault, { runner: failsToList });
    await sync.pull();
    const result = await sync.resolve("AGENTS.md", "mine");
    expect(result.state.status).toBe("error");
    expect(result.state.lastError).toContain("index file corrupt");
    expect(existsSync(join(vault, "AGENTS.md"))).toBe(true);
  });

  test("listing the conflicts of a clean vault never raises an error, even with git older than 2.38", async () => {
    const sync = createSync(vault, {
      runner: {
        run(command, options) {
          return command[1] === "merge-tree"
            ? Promise.resolve({ exitCode: 129, stdout: "", stderr: "error: unknown option `write-tree'" })
            : systemProcessRunner.run(command, options);
        },
      },
    });
    const report = await sync.conflicts();
    expect(report.conflicts).toEqual([]);
    expect(report.state.status).toBe("ok");
  });

  test("a pull leaves an unpushed merge to the next save, so an edit that is not committed never blocks it", async () => {
    const sync = createSync(vault);
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    await sync.save();
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    await sync.resolve("AGENTS.md", "mine");
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    pushFromOther("news.md", "news\n");
    sandbox.git(vault, "fetch", "-q", "origin");
    sandbox.write(vault, "news.md", "a draft here\n");
    const freshPulls = sync.freshPulls;
    expect((await sync.pull()).status).not.toBe("error");
    expect(readFileSync(join(vault, "news.md"), "utf-8")).toBe("a draft here\n");
    // An "ok" here is the state before the pull, so a hub claim must not trust it (#529).
    expect(sync.freshPulls).toBe(freshPulls);
  });

  test("counts each pull that fetched, and no pull that could not", async () => {
    const sync = createSync(vault);
    await sync.pull();
    expect(sync.freshPulls).toBe(1);
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    await sync.pull();
    expect(sync.freshPulls).toBe(1);
  });
});

describe("VaultSync conflict picks and the secret scan", () => {
  const token = "token ghp_" + "a".repeat(36) + "\n";

  async function secretConflict(sync: VaultSync): Promise<void> {
    pushFromOther("a.md", "base\n");
    sandbox.git(vault, "pull", "-q");
    pushFromOther("a.md", "theirs\n");
    sandbox.write(vault, "a.md", token);
    expect((await sync.pull()).status).toBe("conflict");
  }

  test("keep mine never pushes an edit that holds a secret, even when another note is committed", async () => {
    const sync = createSync(vault);
    await secretConflict(sync);
    sandbox.write(vault, "other.md", "innocent\n");
    const result = await sync.resolve("a.md", "mine");
    expect(result.state.withheldFiles).toEqual([{ path: "a.md", reason: "secret" }]);
    expect(sandbox.git(sandbox.remote, "show", "main:a.md")).toBe("theirs");
    expect(sandbox.git(sandbox.remote, "show", "main:other.md")).toBe("innocent");
    expect(readFileSync(join(vault, "a.md"), "utf-8")).toBe(token);
  });

  test("keep both pushes the copy but never the note that holds a secret", async () => {
    const sync = createSync(vault);
    await secretConflict(sync);
    await sync.resolve("a.md", "both");
    expect(sandbox.git(sandbox.remote, "show", "main:a.md")).toBe("theirs");
    expect(sandbox.git(sandbox.remote, "show", "main:a (conflict copy).md")).toBe("theirs");
  });

  test("names git's own reason for a merge-tree failure that is not an old git", async () => {
    const sync = createSync(vault, {
      runner: {
        run(command, options) {
          return command[1] === "merge-tree"
            ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: refusing to merge unrelated histories" })
            : systemProcessRunner.run(command, options);
        },
      },
    });
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const state = await sync.save();
    expect(state.lastError).toContain("unrelated histories");
    expect(state.lastError).not.toContain("2.38");
  });
});

describe("VaultSync conflict second review fixes", () => {
  test("the last pick holds when this machine edits the same note again before it", async () => {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Mine\n");
    const sync = createSync(vault);
    await sync.save();
    sandbox.write(vault, "AGENTS.md", "# Mine, edited again\n");
    const result = await sync.resolve("AGENTS.md", "theirs");
    expect(result.state.status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "show", "main:AGENTS.md")).toBe("# Theirs");
    expect(sandbox.git(sandbox.remote, "log", "--format=%s", "main")).toContain("eva: autosave (1 file)");
  });

  test("a pull never merges with an edit that is not committed, so it raises no false error", async () => {
    pushFromOther("AGENTS.md", "# Theirs\n");
    sandbox.write(vault, "AGENTS.md", "# Undone\n");
    sandbox.git(vault, "commit", "-q", "-am", "edit");
    sandbox.write(vault, "AGENTS.md", "# Vault\n");
    sandbox.git(vault, "commit", "-q", "-am", "undo");
    sandbox.write(vault, "AGENTS.md", "# A draft here\n");
    const sync = createSync(vault);
    expect((await sync.pull()).status).not.toBe("error");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe("# A draft here\n");
    // The pull left the remote's commits out of the files, so a hub claim must not trust it (#529).
    expect(sync.freshPulls).toBe(0);
  });
});

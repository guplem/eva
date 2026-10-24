import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitAndPush,
  describeChanges,
  fallbackCommitMessage,
  fetchClone,
  fetchDefaultBranch,
  hasLocalWork,
  pullClone,
  readSyncState,
  switchToBranch,
} from "../../../../src/core/projects/clone-sync.ts";
import { CloneOriginStore, createClone, type CloneRepository } from "../../../../src/core/projects/clones.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
// The one repository of a clone: the sync works on each repository apart.
let clone: CloneRepository;

beforeEach(async () => {
  sandbox = createGitSandbox();
  const project = join(sandbox.root, "vault", "Projects", "2025-03-02-1015-example-app");
  mkdirSync(project, { recursive: true });
  const created = await createClone({
    projectPath: project,
    repositoryUrls: [sandbox.remote],
    runner: systemProcessRunner,
    environment: gitEnvironment,
    origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
  });
  const [repository] = created.repositories;
  if (repository === undefined) throw new Error("The test needs one repository.");
  clone = repository;
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

/** A commit on the remote that the clone does not have yet. */
function commitElsewhere(file: string): void {
  const other = sandbox.clone(`other-${file}`);
  sandbox.write(other, file, "from elsewhere\n");
  sandbox.git(other, "add", "-A");
  sandbox.git(other, "commit", "-q", "-m", `add ${file}`);
  sandbox.git(other, "push", "-q", "origin", "main");
}

/** A local commit and a remote commit that change AGENTS.md apart, then a merge or rebase that stops on it. */
function startConflict(how: "merge" | "rebase" | "cherry-pick" = "merge"): void {
  commitElsewhere("AGENTS.md");
  sandbox.write(clone.path, "AGENTS.md", "# Local\n");
  sandbox.git(clone.path, "add", "-A");
  sandbox.git(clone.path, "commit", "-q", "-m", "local work");
  sandbox.git(clone.path, "fetch", "-q");
  // Git ends a stopped merge or rebase with a failure exit code.
  expect(() => sandbox.git(clone.path, how, "origin/main")).toThrow();
}

/** Solves the conflict in AGENTS.md, then checks that a push is refused and makes no commit. */
async function expectRefusedWithNoCommit(): Promise<void> {
  sandbox.write(clone.path, "AGENTS.md", "# Solved\n");
  sandbox.git(clone.path, "add", "-A");
  const before = sandbox.git(clone.path, "rev-parse", "HEAD");
  const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
    (error: unknown) => error,
  );
  expect(isEvaError(failure, "git_failed")).toBe(true);
  expect(sandbox.git(clone.path, "rev-parse", "HEAD")).toBe(before);
}

describe("sync state", () => {
  test("a fresh clone is level with its upstream", async () => {
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 0 });
  });

  test("a fetch shows the commits of the remote that the clone lacks", async () => {
    commitElsewhere("remote.txt");
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 0 });
    expect(await fetchClone(clone, systemProcessRunner, gitEnvironment)).toBeNull();
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 1 });
  });

  test("a branch with no upstream has no counts", async () => {
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature");
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: null, behind: null });
  });

  test("a failed fetch gives the reason", async () => {
    sandbox.git(clone.path, "remote", "set-url", "origin", join(sandbox.root, "gone.git"));
    expect(await fetchClone(clone, systemProcessRunner, gitEnvironment)).not.toBeNull();
  });
});

describe("pull", () => {
  test("a pull brings the remote commits", async () => {
    commitElsewhere("remote.txt");
    await pullClone(clone, systemProcessRunner, gitEnvironment);
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 0 });
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("add remote.txt");
  });

  test("a pull that cannot fast-forward fails with git's reason and changes nothing", async () => {
    commitElsewhere("remote.txt");
    sandbox.write(clone.path, "local.txt", "local\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "local work");
    const failure = await pullClone(clone, systemProcessRunner, gitEnvironment).catch((error: unknown) => error);
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("local work");
  });
});

describe("commit and push", () => {
  test("commits every change with the message, and pushes it", async () => {
    sandbox.write(clone.path, "new.txt", "new\n");
    writeFileSync(join(clone.path, "AGENTS.md"), "# Changed\n");
    await commitAndPush(clone, "Add the new file", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(clone.path, "status", "--porcelain")).toBe("");
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("Add the new file");
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 0 });
  });

  test("pushes commits that are already there, with no new commit", async () => {
    sandbox.write(clone.path, "new.txt", "new\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "agent commit");
    await commitAndPush(clone, "unused", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("agent commit");
  });

  test("a branch with no upstream gets one on the first push", async () => {
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature");
    sandbox.write(clone.path, "new.txt", "new\n");
    await commitAndPush(clone, "Start the feature", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "feature")).toBe("Start the feature");
    expect(await readSyncState(clone, systemProcessRunner, gitEnvironment)).toEqual({ ahead: 0, behind: 0 });
  });

  test("a branch that tracks main pushes to its own name, never to main", async () => {
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature", "--track", "origin/main");
    sandbox.write(clone.path, "new.txt", "new\n");
    await commitAndPush(clone, "Start the feature", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("seed");
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "feature")).toBe("Start the feature");
  });

  test("a machine with no git identity still commits, as Eva", async () => {
    const home = join(sandbox.root, "empty-home");
    mkdirSync(home);
    const noIdentity = Object.fromEntries(
      Object.entries({ ...gitEnvironment, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: "1" }).filter(
        ([name]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(name),
      ),
    );
    sandbox.write(clone.path, "new.txt", "new\n");
    await commitAndPush(clone, "Add the file", systemProcessRunner, noIdentity);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%an <%ae>", "main")).toBe("Eva <eva@localhost>");
  });

  test("an empty message falls back to a plain one", async () => {
    sandbox.write(clone.path, "new.txt", "new\n");
    await commitAndPush(clone, "  ", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("Update new.txt");
  });

  test("a repository with Git LFS files is refused, because its upload hook does not run", async () => {
    sandbox.write(clone.path, ".gitattributes", "*.png filter=lfs diff=lfs merge=lfs -text\n");
    const failure = await commitAndPush(clone, "Add LFS", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("seed");
  });

  test("with nothing to push, it says so", async () => {
    const failure = await commitAndPush(clone, "nothing", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
  });

  test("a clone with a conflict is refused, and gets no commit", async () => {
    startConflict();
    const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("local work");
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("add AGENTS.md");
  });

  test("a merge that is not ended yet is refused, even with each conflict solved", async () => {
    startConflict();
    sandbox.write(clone.path, "AGENTS.md", "# Solved\n");
    sandbox.git(clone.path, "add", "-A");
    const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("local work");
  });

  test("a clone in the middle of a rebase is refused, and gets no commit", async () => {
    startConflict("rebase");
    sandbox.write(clone.path, "AGENTS.md", "# Solved\n");
    sandbox.git(clone.path, "add", "-A");
    const before = sandbox.git(clone.path, "rev-parse", "HEAD");
    const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "rev-parse", "HEAD")).toBe(before);
  });

  test("a clone of an empty remote commits and pushes its first commit", async () => {
    const empty = join(sandbox.root, "empty.git");
    sandbox.git(sandbox.root, "init", "-q", "--bare", empty);
    const [first] = (
      await createClone({
        projectPath: join(sandbox.root, "vault", "Projects", "2025-03-02-1015-example-app"),
        repositoryUrls: [empty],
        runner: systemProcessRunner,
        environment: gitEnvironment,
        origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
      })
    ).repositories;
    if (first === undefined) throw new Error("The test needs one repository.");
    sandbox.write(first.path, "README.md", "# First\n");
    await commitAndPush(first, "First commit", systemProcessRunner, gitEnvironment);
    const branch = sandbox.git(first.path, "symbolic-ref", "--short", "HEAD");
    expect(sandbox.git(empty, "log", "-1", "--format=%s", branch)).toBe("First commit");
  });

  test("a cherry-pick or a revert that is not ended yet is refused, and gets no commit", async () => {
    startConflict("cherry-pick");
    expect(existsSync(join(clone.path, ".git", "CHERRY_PICK_HEAD"))).toBe(true);
    await expectRefusedWithNoCommit();
    sandbox.git(clone.path, "cherry-pick", "--abort");

    sandbox.write(clone.path, "AGENTS.md", "# Later\n");
    sandbox.git(clone.path, "commit", "-q", "-am", "later work");
    // Reverting "local work" conflicts with "later work", which changed the same line.
    expect(() => sandbox.git(clone.path, "revert", "--no-edit", "HEAD~1")).toThrow();
    expect(existsSync(join(clone.path, ".git", "REVERT_HEAD"))).toBe(true);
    await expectRefusedWithNoCommit();
  });

  test("a cherry-pick of several commits that stopped partway is refused, after a plain commit too", async () => {
    // The picks come from a local branch, so main stays a fast-forward of the remote and only the marker refuses.
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature");
    sandbox.write(clone.path, "AGENTS.md", "# Feature\n");
    sandbox.git(clone.path, "commit", "-q", "-am", "feature work");
    sandbox.write(clone.path, "second.txt", "second\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "second feature work");
    sandbox.git(clone.path, "checkout", "-q", "main");
    sandbox.write(clone.path, "AGENTS.md", "# Local\n");
    sandbox.git(clone.path, "commit", "-q", "-am", "local work");
    expect(() => sandbox.git(clone.path, "cherry-pick", "feature~1", "feature")).toThrow();
    sandbox.write(clone.path, "AGENTS.md", "# Solved\n");
    sandbox.git(clone.path, "add", "-A");
    // A plain commit ends the first pick, but the second one still waits.
    sandbox.git(clone.path, "commit", "-q", "--no-edit");
    expect(existsSync(join(clone.path, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
    const before = sandbox.git(clone.path, "rev-parse", "HEAD");
    const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "rev-parse", "HEAD")).toBe(before);
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s", "main")).toBe("seed");
  });

  test("a clone of an empty remote with no change has nothing to push", async () => {
    const empty = join(sandbox.root, "empty.git");
    sandbox.git(sandbox.root, "init", "-q", "--bare", empty);
    const [first] = (
      await createClone({
        projectPath: join(sandbox.root, "vault", "Projects", "2025-03-02-1015-example-app"),
        repositoryUrls: [empty],
        runner: systemProcessRunner,
        environment: gitEnvironment,
        origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
      })
    ).repositories;
    if (first === undefined) throw new Error("The test needs one repository.");
    const failure = await commitAndPush(first, "nothing", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(String(failure)).toContain("has nothing to push");
  });

  test("a clone on no branch is refused before the commit", async () => {
    sandbox.git(clone.path, "checkout", "-q", "--detach");
    sandbox.write(clone.path, "new.txt", "new\n");
    const failure = await commitAndPush(clone, "Push it", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("seed");
  });

  test("a push that the remote refuses keeps the commit, and gives the reason", async () => {
    commitElsewhere("remote.txt");
    sandbox.write(clone.path, "local.txt", "local\n");
    const failure = await commitAndPush(clone, "Local work", systemProcessRunner, gitEnvironment).catch(
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "git_failed")).toBe(true);
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("Local work");
  });
});

describe("commit message", () => {
  test("the description of the changes names each file and holds the diff", async () => {
    sandbox.write(clone.path, "new.txt", "brand new\n");
    writeFileSync(join(clone.path, "AGENTS.md"), "# Changed\n");
    const changes = await describeChanges(clone, systemProcessRunner, gitEnvironment);
    expect(changes.files).toEqual(["AGENTS.md", "new.txt"]);
    expect(changes.diff).toContain("+# Changed");
    expect(changes.diff).toContain("New file new.txt:\nbrand new");
    expect(changes.recentSubjects).toEqual(["seed"]);
  });

  test("the fallback message names the file, or counts the files", () => {
    expect(fallbackCommitMessage(["src/app.ts"])).toBe("Update app.ts");
    expect(fallbackCommitMessage(["a.ts", "b.ts", "c.ts"])).toBe("Update 3 files");
    expect(fallbackCommitMessage([])).toBe("Update files");
  });
});

/** The two steps of a reuse: the fetch, then the switch. */
async function resetToDefault(repository: CloneRepository): Promise<void> {
  const branch = await fetchDefaultBranch(repository, systemProcessRunner, gitEnvironment);
  await switchToBranch(repository, branch, systemProcessRunner, gitEnvironment);
}

describe("reuse (issue 521)", () => {
  test("a fresh repository has no work that only it holds", async () => {
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(false);
  });

  test("a changed or new file is local work", async () => {
    writeFileSync(join(clone.path, "new.txt"), "new\n");
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(true);
  });

  test("a commit on a branch that no remote has is local work, also after a switch away from it", async () => {
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature");
    sandbox.write(clone.path, "feature.txt", "feature\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "feature");
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(true);
    sandbox.git(clone.path, "checkout", "-q", "main");
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(true);
    sandbox.git(clone.path, "push", "-q", "origin", "feature");
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(false);
  });

  test("a commit on a detached head is local work", async () => {
    sandbox.git(clone.path, "checkout", "-q", "--detach");
    sandbox.write(clone.path, "detached.txt", "detached\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "detached");
    expect(await hasLocalWork(clone, systemProcessRunner, gitEnvironment)).toBe(true);
  });

  test("a folder that is not the top of its own repository counts as local work", async () => {
    const inner = join(clone.path, "inner");
    mkdirSync(inner);
    expect(await hasLocalWork({ name: "inner", path: inner }, systemProcessRunner, gitEnvironment)).toBe(true);
  });

  test("a reset puts a pushed branch back on the default branch, up to date, and keeps ignored files", async () => {
    sandbox.write(clone.path, ".gitignore", "node_modules/\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "ignore");
    sandbox.git(clone.path, "push", "-q", "origin", "main");
    sandbox.git(clone.path, "checkout", "-q", "-b", "feature");
    sandbox.write(clone.path, "feature.txt", "feature\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "feature");
    sandbox.git(clone.path, "push", "-q", "-u", "origin", "feature");
    mkdirSync(join(clone.path, "node_modules"));
    writeFileSync(join(clone.path, "node_modules", "kept.js"), "kept\n");
    commitElsewhere("remote.txt");
    await resetToDefault(clone);
    expect(sandbox.git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("add remote.txt");
    expect(existsSync(join(clone.path, "feature.txt"))).toBe(false);
    expect(existsSync(join(clone.path, "node_modules", "kept.js"))).toBe(true);
    // The feature branch is on the remote, so its local copy goes.
    expect(sandbox.git(clone.path, "branch", "--format=%(refname:short)")).toBe("main");
  });

  test("a reset finds the default branch when the clone does not know it", async () => {
    sandbox.git(clone.path, "remote", "set-head", "origin", "--delete");
    await resetToDefault(clone);
    expect(sandbox.git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("a reset follows a default branch that the remote renamed", async () => {
    sandbox.git(sandbox.remote, "branch", "-m", "main", "trunk");
    sandbox.git(sandbox.remote, "symbolic-ref", "HEAD", "refs/heads/trunk");
    await resetToDefault(clone);
    expect(sandbox.git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("trunk");
  });

  test("a switch keeps a local branch with a commit that no remote has", async () => {
    sandbox.git(clone.path, "checkout", "-q", "-b", "draft");
    sandbox.write(clone.path, "draft.txt", "draft\n");
    sandbox.git(clone.path, "add", "-A");
    sandbox.git(clone.path, "commit", "-q", "-m", "draft");
    await switchToBranch(clone, "main", systemProcessRunner, gitEnvironment);
    expect(sandbox.git(clone.path, "branch", "--format=%(refname:short)").split("\n").sort()).toEqual([
      "draft",
      "main",
    ]);
  });

  test("a reset that cannot reach the remote fails with git's reason", async () => {
    sandbox.git(clone.path, "remote", "set-url", "origin", join(sandbox.root, "gone.git"));
    const error: unknown = await resetToDefault(clone).catch((caught: unknown) => caught);
    expect(isEvaError(error, "git_failed")).toBe(true);
  });
});

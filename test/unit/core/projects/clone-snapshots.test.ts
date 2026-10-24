import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  copySnapshot,
  deleteSnapshots,
  restoreSnapshot,
  takeSnapshot,
} from "../../../../src/core/projects/clone-snapshots.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
/** A clone folder with one repository, `app`, as Eva makes it. */
let clone: string;
let app: string;

beforeEach(() => {
  sandbox = createGitSandbox();
  clone = join(sandbox.root, "clone-0");
  mkdirSync(clone);
  app = sandbox.clone(join("clone-0", "app"));
  sandbox.write(app, ".gitignore", "ignored.txt\n");
  sandbox.write(app, "kept.txt", "kept\n");
  sandbox.write(app, "gone.txt", "gone\n");
  sandbox.git(app, "add", "-A");
  sandbox.git(app, "commit", "-q", "-m", "files");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

const run = { runner: systemProcessRunner, environment: gitEnvironment };

function read(path: string): string | null {
  // Git on Windows can write a restored file with CRLF line ends, so the tests compare LF text.
  return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null;
}

describe("takeSnapshot and restoreSnapshot", () => {
  test("bring back changed, deleted and new files, and leave ignored files alone", async () => {
    sandbox.write(app, "kept.txt", "changed\n");
    sandbox.write(app, "new.txt", "new\n");
    sandbox.write(app, "ignored.txt", "first\n");
    sandbox.git(app, "rm", "-q", "gone.txt");
    const status = sandbox.git(app, "status", "--porcelain");
    expect(await takeSnapshot(clone, "one", run)).toBe(true);
    // A snapshot changes nothing in the folder.
    expect(sandbox.git(app, "status", "--porcelain")).toBe(status);

    // Later turns commit, add files, change ignored files and switch branches.
    sandbox.git(app, "add", "-A");
    sandbox.git(app, "commit", "-q", "-m", "later");
    sandbox.write(app, "later.txt", "later\n");
    sandbox.write(app, "kept.txt", "later\n");
    sandbox.write(app, "ignored.txt", "second\n");
    sandbox.git(app, "checkout", "-q", "-b", "other");

    await restoreSnapshot(clone, "one", run);

    expect(sandbox.git(app, "branch", "--show-current")).toBe("main");
    expect(sandbox.git(app, "log", "-1", "--format=%s")).toBe("files");
    expect(read(join(app, "kept.txt"))).toBe("changed\n");
    expect(read(join(app, "new.txt"))).toBe("new\n");
    expect(read(join(app, "gone.txt"))).toBeNull();
    expect(read(join(app, "later.txt"))).toBeNull();
    expect(read(join(app, "ignored.txt"))).toBe("second\n");
  });

  test("bring back a detached HEAD", async () => {
    const first = sandbox.git(app, "rev-parse", "HEAD~1");
    sandbox.git(app, "checkout", "-q", "--detach", first);
    expect(await takeSnapshot(clone, "detached", run)).toBe(true);
    sandbox.git(app, "checkout", "-q", "main");
    await restoreSnapshot(clone, "detached", run);
    expect(sandbox.git(app, "rev-parse", "HEAD")).toBe(first);
    expect(sandbox.git(app, "branch", "--show-current")).toBe("");
  });

  test("snapshot every repository of the clone, and leave one that lacks the snapshot", async () => {
    const web = sandbox.clone(join("clone-0", "web"));
    sandbox.write(web, "web.txt", "web\n");
    expect(await takeSnapshot(clone, "both", run)).toBe(true);
    const later = sandbox.clone(join("clone-0", "later"));
    sandbox.write(later, "later.txt", "stays\n");
    sandbox.write(web, "web.txt", "changed\n");
    await restoreSnapshot(clone, "both", run);
    expect(read(join(web, "web.txt"))).toBe("web\n");
    expect(read(join(later, "later.txt"))).toBe("stays\n");
  });

  test("snapshot a repository with no commit", async () => {
    const empty = join(clone, "empty");
    mkdirSync(empty);
    sandbox.git(empty, "init", "-q", "--initial-branch=start");
    sandbox.write(empty, "first.txt", "first\n");
    expect(await takeSnapshot(clone, "empty", run)).toBe(true);
    sandbox.write(empty, "second.txt", "second\n");
    sandbox.git(empty, "add", "-A");
    sandbox.git(empty, "commit", "-q", "-m", "later");
    await restoreSnapshot(clone, "empty", run);
    expect(read(join(empty, "first.txt"))).toBe("first\n");
    expect(read(join(empty, "second.txt"))).toBeNull();
    expect(sandbox.git(empty, "symbolic-ref", "--short", "HEAD")).toBe("start");
  });

  test("snapshot a repository with no commit and no file, and bring back its empty state", async () => {
    const bare = join(clone, "bare");
    mkdirSync(bare);
    sandbox.git(bare, "init", "-q", "--initial-branch=start");
    expect(await takeSnapshot(clone, "nothing-yet", run)).toBe(true);
    sandbox.write(bare, "later.txt", "later\n");
    await restoreSnapshot(clone, "nothing-yet", run);
    expect(read(join(bare, "later.txt"))).toBeNull();
  });

  test("a snapshot that no repository has fails with snapshot_missing", async () => {
    const error: unknown = await restoreSnapshot(clone, "nothing", run).catch((caught: unknown) => caught);
    expect(isEvaError(error, "snapshot_missing")).toBe(true);
  });

  test("a folder with no repository gives no snapshot", async () => {
    const lone = join(sandbox.root, "lone");
    mkdirSync(lone);
    expect(await takeSnapshot(lone, "none", run)).toBe(false);
  });
});

describe("copySnapshot", () => {
  test("brings a snapshot into another clone of the same repositories", async () => {
    sandbox.write(app, "work.txt", "work\n");
    sandbox.git(app, "add", "-A");
    sandbox.git(app, "commit", "-q", "-m", "local work");
    sandbox.write(app, "draft.txt", "draft\n");
    expect(await takeSnapshot(clone, "move", run)).toBe(true);

    const other = join(sandbox.root, "clone-1");
    mkdirSync(other);
    const copy = sandbox.clone(join("clone-1", "app"));
    await copySnapshot(clone, other, "move", run);
    await restoreSnapshot(other, "move", run);

    expect(read(join(copy, "work.txt"))).toBe("work\n");
    expect(read(join(copy, "draft.txt"))).toBe("draft\n");
    expect(sandbox.git(copy, "log", "-1", "--format=%s")).toBe("local work");
  });
});

describe("deleteSnapshots", () => {
  test("deletes the named snapshots, or every one", async () => {
    await takeSnapshot(clone, "a", run);
    await takeSnapshot(clone, "b", run);
    await takeSnapshot(clone, "c", run);
    await deleteSnapshots(clone, ["a"], run);
    expect(sandbox.git(app, "for-each-ref", "--format=%(refname)", "refs/eva/")).toBe(
      "refs/eva/snapshots/b\nrefs/eva/snapshots/c",
    );
    await deleteSnapshots(clone, "all", run);
    expect(sandbox.git(app, "for-each-ref", "--format=%(refname)", "refs/eva/")).toBe("");
  });
});

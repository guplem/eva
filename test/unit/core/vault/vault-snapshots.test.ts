import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import {
  changedLeftOut,
  parseDiffTree,
  parseSnapshotCommit,
  planUndo,
  snapshotMessage,
  turnSnapshotRef,
  type UndoAnswer,
} from "../../../../src/core/vault/vault-snapshots.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { Logger } from "../../../../src/shared/logger.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;

function createSync(seams: { runner?: ProcessRunner; logger?: Logger } = {}): VaultSync {
  return new VaultSync({
    vaultPath: vault,
    runner: seams.runner ?? systemProcessRunner,
    environment: gitEnvironment,
    now: () => new Date(2026, 9, 24, 12, 0),
    ...(seams.logger === undefined ? {} : { logger: seams.logger }),
  });
}

function answer(sessionId: string, turnIndex: number): UndoAnswer {
  return {
    before: turnSnapshotRef(sessionId, turnIndex, "before"),
    after: turnSnapshotRef(sessionId, turnIndex, "after"),
  };
}

/** Runs one answer: a snapshot before, the edits, a snapshot after, and the save. */
async function runAnswer(sync: VaultSync, sessionId: string, turnIndex: number, edit: () => void): Promise<void> {
  expect(await sync.snapshot(turnSnapshotRef(sessionId, turnIndex, "before"))).toBe(true);
  edit();
  expect(await sync.snapshot(turnSnapshotRef(sessionId, turnIndex, "after"))).toBe(true);
  await sync.save();
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(vault, "Notes/Plan.md", "The first plan.\n");
  sandbox.write(vault, "Notes/Old.md", "An old note.\n");
  sandbox.write(vault, ".gitignore", "Scratch/\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "notes");
  sandbox.git(vault, "push", "-q", "origin", "HEAD:main");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

describe("VaultSync undo of an answer", () => {
  test("restores the changed, added and deleted files of an answer, and commits the undo", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/Plan.md", "A bad plan.\n");
      sandbox.write(vault, "Notes/New.md", "A new note.\n");
      rmSync(join(vault, "Notes/Old.md"));
    });
    expect(await sync.undoPreview([answer("chat", 0)])).toEqual({
      restore: ["Notes/New.md", "Notes/Old.md", "Notes/Plan.md"],
      changed: [],
      notKept: [],
      answers: 1,
    });

    const result = await sync.undo([answer("chat", 0)]);
    expect(result.restore).toEqual(["Notes/New.md", "Notes/Old.md", "Notes/Plan.md"]);
    expect(read("Notes/Plan.md")).toBe("The first plan.\n");
    expect(read("Notes/Old.md")).toBe("An old note.\n");
    expect(existsSync(join(vault, "Notes/New.md"))).toBe(false);

    // The undo is a new commit on top: history never changes.
    const before = sandbox.git(vault, "rev-list", "--count", "HEAD");
    expect((await sync.save()).status).toBe("ok");
    expect(Number(sandbox.git(vault, "rev-list", "--count", "HEAD"))).toBe(Number(before) + 1);
    expect(sandbox.git(sandbox.remote, "show", "main:Notes/Plan.md")).toBe("The first plan.");
    // The snapshots stay on this machine.
    expect(sandbox.git(sandbox.remote, "for-each-ref", "refs/eva")).toBe("");
  });

  test("keeps a file that changed after the answer, and names it", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/Plan.md", "A bad plan.\n");
      sandbox.write(vault, "Notes/New.md", "A new note.\n");
    });
    sandbox.write(vault, "Notes/Plan.md", "The person's edit.\n");

    const result = await sync.undo([answer("chat", 0)]);
    expect(result).toEqual({ restore: ["Notes/New.md"], changed: ["Notes/Plan.md"], notKept: [], answers: 1 });
    expect(read("Notes/Plan.md")).toBe("The person's edit.\n");
  });

  test("an undo of several answers starts from the files before the first, and keeps edits between them", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/Plan.md", "Plan two.\n");
    });
    // The person writes a note between the answers. No answer changed it.
    sandbox.write(vault, "Notes/Mine.md", "My own note.\n");
    await runAnswer(sync, "chat", 1, () => {
      sandbox.write(vault, "Notes/Plan.md", "Plan three.\n");
      sandbox.write(vault, "Notes/Extra.md", "Extra.\n");
    });

    const result = await sync.undo([answer("chat", 0), answer("chat", 1)]);
    expect(result).toEqual({ restore: ["Notes/Extra.md", "Notes/Plan.md"], changed: [], notKept: [], answers: 2 });
    expect(read("Notes/Plan.md")).toBe("The first plan.\n");
    expect(existsSync(join(vault, "Notes/Extra.md"))).toBe(false);
    expect(read("Notes/Mine.md")).toBe("My own note.\n");
  });

  test("names a Scratch file and a withheld secret as not restored, and keeps the secret out of git", async () => {
    const sync = createSync();
    const secret = "token ghp_" + "a".repeat(36) + "\n";
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Scratch/report.pdf", "A report.\n");
      sandbox.write(vault, "Toolbox/keys.md", secret);
    });

    expect(await sync.undoPreview([answer("chat", 0)])).toEqual({
      restore: [],
      changed: [],
      notKept: ["Scratch/report.pdf", "Toolbox/keys.md"],
      answers: 1,
    });
    const tree = sandbox.git(vault, "ls-tree", "-r", "--name-only", turnSnapshotRef("chat", 0, "after"));
    expect(tree).not.toContain("Toolbox/keys.md");
    expect(tree).not.toContain("Scratch/report.pdf");
  });

  test("a left-out file that the answer changed counts, one that it did not change does not", async () => {
    sandbox.write(vault, "Scratch/old.txt", "old\n");
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Scratch/new.txt", "new\n");
    });
    expect((await sync.undoPreview([answer("chat", 0)])).notKept).toEqual(["Scratch/new.txt"]);

    await runAnswer(sync, "chat", 1, () => {
      const later = new Date(Date.now() + 60_000);
      sandbox.write(vault, "Scratch/old.txt", "changed\n");
      utimesSync(join(vault, "Scratch/old.txt"), later, later);
    });
    expect((await sync.undoPreview([answer("chat", 1)])).notKept).toEqual(["Scratch/old.txt"]);
  });

  test("never touches a withheld file, even when the answer took its secret out (review of #525)", async () => {
    const sync = createSync();
    const secret = "token ghp_" + "b".repeat(36) + "\n";
    sandbox.write(vault, "Notes/keys.md", secret);
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/keys.md", "The token is gone.\n");
    });
    expect(await sync.undo([answer("chat", 0)])).toEqual({
      restore: [],
      changed: [],
      notKept: ["Notes/keys.md"],
      answers: 1,
    });
    expect(read("Notes/keys.md")).toBe("The token is gone.\n");
  });

  test("an undo removes the folders that the answer made and that are empty now", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Trips/2027/Rome.md", "A trip.\n");
      sandbox.write(vault, "Notes/Kept/Old.md", "kept\n");
    });
    sandbox.write(vault, "Notes/Kept/Mine.md", "mine\n");
    await sync.undo([answer("chat", 0)]);
    expect(existsSync(join(vault, "Trips"))).toBe(false);
    expect(existsSync(join(vault, "Notes/Kept/Mine.md"))).toBe(true);
  });

  test("a symbolic link counts as changed, so it stays", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      symlinkSync("Plan.md", join(vault, "Notes/Link.md"));
    });
    expect((await sync.undoPreview([answer("chat", 0)])).changed).toEqual(["Notes/Link.md"]);
  });

  test("a snapshot leaves the real index as it is", async () => {
    sandbox.write(vault, "Notes/Staged.md", "staged\n");
    sandbox.git(vault, "add", "Notes/Staged.md");
    sandbox.write(vault, "Notes/Unstaged.md", "unstaged\n");
    const statusBefore = sandbox.git(vault, "status", "--porcelain");
    expect(await createSync().snapshot(turnSnapshotRef("chat", 0, "before"))).toBe(true);
    expect(sandbox.git(vault, "status", "--porcelain")).toBe(statusBefore);
    const tree = sandbox.git(vault, "ls-tree", "-r", "--name-only", turnSnapshotRef("chat", 0, "before"));
    expect(tree).toContain("Notes/Staged.md");
    expect(tree).toContain("Notes/Unstaged.md");
  });

  test("a turn with no snapshots adds nothing", async () => {
    expect(await createSync().undoPreview([answer("old-chat", 3)])).toEqual({
      restore: [],
      changed: [],
      notKept: [],
      answers: 0,
    });
  });

  test("a file that is already back as before needs nothing", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/Plan.md", "A bad plan.\n");
    });
    sandbox.write(vault, "Notes/Plan.md", "The first plan.\n");
    expect(await sync.undoPreview([answer("chat", 0)])).toEqual({ restore: [], changed: [], notKept: [], answers: 1 });
  });

  test("a failed restore throws git_failed with the reason", async () => {
    const sync = createSync();
    await runAnswer(sync, "chat", 0, () => {
      sandbox.write(vault, "Notes/Plan.md", "A bad plan.\n");
    });
    const failingRestore: ProcessRunner = {
      run: (command, options) =>
        command[1] === "restore"
          ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "error: unable to write file" })
          : systemProcessRunner.run(command, options),
    };
    const caught = await createSync({ runner: failingRestore })
      .undo([answer("chat", 0)])
      .catch((error: unknown) => error);
    expect(isEvaError(caught, "git_failed")).toBe(true);
    expect(String(caught)).toContain("unable to write file");
  });

  test("a failed snapshot logs and returns false", async () => {
    const lines: string[] = [];
    const logger: Logger = { log: (_level, message) => lines.push(message) };
    const failingTree: ProcessRunner = {
      run: (command, options) =>
        command[1] === "write-tree"
          ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: broken" })
          : systemProcessRunner.run(command, options),
    };
    expect(await createSync({ runner: failingTree, logger }).snapshot(turnSnapshotRef("chat", 0, "before"))).toBe(
      false,
    );
    expect(lines).toContain("Eva could not save a snapshot of the vault.");
  });

  test("deleteSnapshots removes the refs of one chat only", async () => {
    const sync = createSync();
    await sync.snapshot(turnSnapshotRef("gone", 0, "before"));
    await sync.snapshot(turnSnapshotRef("kept", 0, "before"));
    await sync.deleteSnapshots("gone");
    const refs = sandbox.git(vault, "for-each-ref", "--format=%(refname)", "refs/eva");
    expect(refs).toBe(turnSnapshotRef("kept", 0, "before"));
    // Nothing to delete is no failure.
    await sync.deleteSnapshots("gone");
  });

  test("deleteSnapshots keeps the refs that a moved turn still names (issue 647)", async () => {
    const sync = createSync();
    await sync.snapshot(turnSnapshotRef("gone", 0, "before"));
    await sync.snapshot(turnSnapshotRef("gone", 1, "before"));
    await sync.deleteSnapshots("gone", new Set([turnSnapshotRef("gone", 0, "before")]));
    const refs = sandbox.git(vault, "for-each-ref", "--format=%(refname)", "refs/eva");
    expect(refs).toBe(turnSnapshotRef("gone", 0, "before"));
  });
});

describe("snapshot helpers", () => {
  test("a snapshot message keeps its left-out files, and a bad one lists none", () => {
    const files = [{ path: "Scratch/a.txt", size: 3, changedAt: 1000 }];
    expect(parseSnapshotCommit(`tree abc\n\n${snapshotMessage(files)}`)).toEqual(files);
    expect(parseSnapshotCommit("tree abc\n\neva: snapshot\n\nnot json")).toEqual([]);
    expect(parseSnapshotCommit('tree abc\n\neva: snapshot\n\n{"leftOut":[{"path":1}]}')).toEqual([]);
    expect(parseSnapshotCommit('tree abc\n\neva: snapshot\n\n{"other":1}')).toEqual([]);
  });

  test("changedLeftOut finds added, removed and changed files", () => {
    const before = [
      { path: "a", size: 1, changedAt: 1 },
      { path: "b", size: 1, changedAt: 1 },
      { path: "c", size: 1, changedAt: 1 },
    ];
    const after = [
      { path: "a", size: 1, changedAt: 1 },
      { path: "b", size: 2, changedAt: 1 },
      { path: "d", size: 1, changedAt: 1 },
    ];
    expect(changedLeftOut(before, after).sort()).toEqual(["b", "c", "d"]);
  });

  test("parseDiffTree reads added, changed and deleted paths", () => {
    const zero = "0".repeat(40);
    const one = "1".repeat(40);
    const two = "2".repeat(40);
    const output = [
      `:000000 100644 ${zero} ${one} A`,
      "new.md",
      `:100644 100644 ${one} ${two} M`,
      "a name with spaces.md",
      `:100644 000000 ${two} ${zero} D`,
      "gone.md",
      "",
    ].join("\0");
    expect(parseDiffTree(output)).toEqual([
      { path: "new.md", beforeOid: null, afterOid: one },
      { path: "a name with spaces.md", beforeOid: one, afterOid: two },
      { path: "gone.md", beforeOid: two, afterOid: null },
    ]);
  });

  test("planUndo restores from the first answer that changed a file", () => {
    const plan = planUndo(
      [
        { beforeCommit: "first", changes: [{ path: "a", beforeOid: "a0", afterOid: "a1" }], leftOutChanged: ["s"] },
        {
          beforeCommit: "second",
          changes: [
            { path: "a", beforeOid: "a1", afterOid: "a2" },
            { path: "b", beforeOid: null, afterOid: "b1" },
          ],
          leftOutChanged: [],
        },
      ],
      new Map([
        ["a", "a2"],
        ["b", "b1"],
      ]),
    );
    expect(plan).toEqual({
      restore: [
        { path: "a", source: "first" },
        { path: "b", source: null },
      ],
      changed: [],
      notKept: ["s"],
      answers: 2,
    });
  });
});

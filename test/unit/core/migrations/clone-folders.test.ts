import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteOldCloneFolders } from "../../../../src/core/migrations/clone-folders.ts";
import { runMigrations } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let repos: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-clone-folders-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  repos = join(vault, "Projects", "2025-03-02-1015-example-app", "repos");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(repos, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): "done" | "later" | "failed" {
  const result = runMigrations({
    store: "machine",
    migrations: [deleteOldCloneFolders],
    paths,
    vaultPath,
    version: "0.9.0",
    now: () => new Date("2026-10-24T08:00:00.000Z"),
  });
  if (result.kind === "failed") return "failed";
  if (result.kind === "ahead") throw new Error("unexpected");
  return result.later.length > 0 ? "later" : "done";
}

/** A folder as git leaves a clone: the `.git` folder is enough for the migration. */
function gitFolder(path: string): string {
  mkdirSync(join(path, ".git"), { recursive: true });
  return path;
}

function chat(id: string, startFolder: string, parentId: string | null = null): Record<string, unknown> {
  return { id, mode: parentId === null && startFolder === "" ? "assistant" : "project", startFolder, parentId };
}

function writeSessions(sessions: readonly Record<string, unknown>[]): void {
  mkdirSync(paths.stepDetails, { recursive: true });
  writeFileSync(paths.sessions, JSON.stringify({ version: 1, sessions }));
  for (const session of sessions) writeFileSync(join(paths.stepDetails, `${String(session["id"])}.json`), "{}\n");
}

function sessionIds(): string[] {
  const stored = JSON.parse(readFileSync(paths.sessions, "utf8")) as { sessions: { id: string }[] };
  return stored.sessions.map((session) => session.id);
}

describe("deleteOldCloneFolders (machine)", () => {
  test("is a dated machine migration", () => {
    expect(deleteOldCloneFolders.store).toBe("machine");
    expect(deleteOldCloneFolders.id).toMatch(/^\d{4}-\d{2}-\d{2}-/);
  });

  test("deletes every old clone, also one named clone-<n>, and keeps the new clones", () => {
    const old = gitFolder(join(repos, "example-app-0"));
    const oldNamedClone = gitFolder(join(repos, "clone-3"));
    writeFileSync(join(old, "unpushed.txt"), "lost\n");
    const kept = join(repos, "clone-0");
    gitFolder(join(kept, "example-app"));
    mkdirSync(join(repos, "notes"));
    expect(migrate()).toBe("done");
    expect(existsSync(old)).toBe(false);
    expect(existsSync(oldNamedClone)).toBe(false);
    expect(existsSync(join(kept, "example-app", ".git"))).toBe(true);
    expect(existsSync(join(repos, "notes"))).toBe(true);
  });

  test("deletes the chats of the old clones with their forks and details, and keeps every other chat", () => {
    const old = gitFolder(join(repos, "example-app-0"));
    const kept = join(repos, "clone-0");
    gitFolder(join(kept, "example-app"));
    writeSessions([
      chat("assistant", ""),
      chat("old", old),
      chat("old-fork", old, "old"),
      chat("old-fork-of-fork", old, "old-fork"),
      // A clone that the person deleted by hand earlier: its chat points nowhere.
      chat("gone", join(repos, "example-app-1")),
      chat("new", kept),
      // A new clone that is gone may be one of the new form: only the delete above counts for it.
      chat("new-gone", join(repos, "clone-7")),
    ]);
    expect(migrate()).toBe("done");
    expect(sessionIds()).toEqual(["assistant", "new", "new-gone"]);
    expect(existsSync(join(paths.stepDetails, "old.json"))).toBe(false);
    expect(existsSync(join(paths.stepDetails, "old-fork-of-fork.json"))).toBe(false);
    expect(existsSync(join(paths.stepDetails, "new.json"))).toBe(true);
  });

  test("with no chats to delete, it leaves the session file as it is", () => {
    writeSessions([chat("assistant", "")]);
    const before = readFileSync(paths.sessions, "utf8");
    expect(migrate()).toBe("done");
    expect(readFileSync(paths.sessions, "utf8")).toBe(before);
  });

  test("waits for a vault, and needs no project or session file", () => {
    expect(migrate(null)).toBe("later");
    expect(migrate(join(root, "missing"))).toBe("later");
    rmSync(join(vault, "Projects"), { recursive: true });
    expect(migrate()).toBe("done");
  });
});

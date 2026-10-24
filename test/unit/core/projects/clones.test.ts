import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CloneOriginStore,
  cloneFolderName,
  countChanges,
  createClone,
  describeClone,
  githubSlug,
  isTrustedByDefault,
  listClones,
  repositoryName,
  TrustStore,
} from "../../../../src/core/projects/clones.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let project: string;

beforeEach(() => {
  sandbox = createGitSandbox();
  project = join(sandbox.root, "vault", "Projects", "2025-03-02-1015-example-app");
  mkdirSync(project, { recursive: true });
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

describe("repositoryName", () => {
  test("takes the last path part of a URL, without .git", () => {
    expect(repositoryName("https://github.com/owner/example-app")).toBe("example-app");
    expect(repositoryName("https://github.com/owner/example-app.git/")).toBe("example-app");
    expect(repositoryName("git@github.com:owner/Tool.git")).toBe("Tool");
    expect(repositoryName("C:\\repos\\local.git")).toBe("local");
  });
});

describe("githubSlug", () => {
  test("reads owner/name from each GitHub URL form, and nothing else", () => {
    expect(githubSlug("https://github.com/owner/app")).toBe("owner/app");
    expect(githubSlug("https://github.com/owner/app.git/")).toBe("owner/app");
    expect(githubSlug("git@github.com:Owner/app.git")).toBe("Owner/app");
    expect(githubSlug("ssh://git@github.com/owner/app.git")).toBe("owner/app");
    expect(githubSlug("https://token@github.com/owner/app.git")).toBe("owner/app");
    expect(githubSlug("https://gitlab.com/owner/app")).toBeNull();
    expect(githubSlug("https://evil.example/github.com/owner/app.git")).toBeNull();
    expect(githubSlug("https://github.com/owner")).toBeNull();
    expect(githubSlug("https://github.com/../user")).toBeNull();
    expect(githubSlug("https://github.com/:owner/:repo")).toBeNull();
    expect(githubSlug("https://github.com/owner/app?x=1")).toBeNull();
    expect(githubSlug("https://github.com/owner/app$(touch x)")).toBeNull();
    expect(githubSlug("https://github.com/owner/app;rm")).toBeNull();
    expect(githubSlug("https://github.com/owner.name/app_2.js")).toBe("owner.name/app_2.js");
  });
});

describe("clone folders", () => {
  test("the next folder takes the first free number", () => {
    expect(cloneFolderName(project, "example-app")).toBe("example-app-0");
    mkdirSync(join(project, "repos", "example-app-0"), { recursive: true });
    mkdirSync(join(project, "repos", "example-app-2"), { recursive: true });
    expect(cloneFolderName(project, "example-app")).toBe("example-app-1");
  });

  test("lists the clones of a project, in order", () => {
    expect(listClones(project)).toEqual([]);
    mkdirSync(join(project, "repos", "example-app-1"), { recursive: true });
    mkdirSync(join(project, "repos", "example-app-0"), { recursive: true });
    mkdirSync(join(project, "repos", "notes"), { recursive: true });
    expect(listClones(project).map((clone) => clone.name)).toEqual(["example-app-0", "example-app-1"]);
    expect(listClones(project)[0]).toMatchObject({ repository: "example-app", index: 0 });
  });

  test.skipIf(process.platform === "win32")("skips an entry that it cannot read, such as a broken link", () => {
    mkdirSync(join(project, "repos", "example-app-0"), { recursive: true });
    symlinkSync(join(project, "gone"), join(project, "repos", "example-app-1"));
    expect(listClones(project).map((clone) => clone.name)).toEqual(["example-app-0"]);
  });

  test("a repos file instead of a folder means no clones", () => {
    writeFileSync(join(project, "repos"), "not a folder\n");
    expect(listClones(project)).toEqual([]);
  });

  test("creates a clone in the next free folder, and records the URL it came from", async () => {
    const origins = new CloneOriginStore(join(sandbox.root, "clone-origins.json"));
    const clone = await createClone({
      projectPath: project,
      repositoryUrl: sandbox.remote,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      origins,
    });
    expect(clone.name).toBe("remote-0");
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("seed");
    expect(origins.origin(clone.path)).toEqual({ kind: "cloned", url: sandbox.remote });
  });

  test("reports a clone that fails, and records nothing", async () => {
    const origins = new CloneOriginStore(join(sandbox.root, "clone-origins.json"));
    const error: unknown = await createClone({
      projectPath: project,
      repositoryUrl: join(sandbox.root, "missing.git"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
      origins,
    }).catch((caught: unknown) => caught);
    expect(isEvaError(error, "git_failed")).toBe(true);
    expect(existsSync(join(sandbox.root, "clone-origins.json"))).toBe(false);
  });

  test("a clone that fails with no error output still gives a reason (#430)", async () => {
    const error: unknown = await createClone({
      projectPath: project,
      repositoryUrl: "https://github.com/example/example-app",
      runner: { run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "" }) },
      environment: gitEnvironment,
      origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain("git ended with exit code 128 and wrote no error.");
  });

  test("a clone that stops partway leaves no folder for the next clone to reuse", async () => {
    const path = join(project, "repos", "example-app-0");
    /** A clone that fills part of its folder, then fails or throws, as a timeout kill does. */
    const halfClone = (finish: () => ReturnType<ProcessRunner["run"]>): ProcessRunner => ({
      run: () => {
        mkdirSync(join(path, ".git"), { recursive: true });
        writeFileSync(join(path, "README.md"), "half\n");
        return finish();
      },
    });
    for (const runner of [
      halfClone(() => Promise.resolve({ exitCode: 143, stdout: "", stderr: "killed" })),
      halfClone(() => Promise.reject(new Error("timed out"))),
    ]) {
      const error: unknown = await createClone({
        projectPath: project,
        repositoryUrl: "https://github.com/example/example-app",
        runner,
        environment: gitEnvironment,
        origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(existsSync(path)).toBe(false);
    }
  });

  test("refuses a repository URL that git would read as an option, and runs nothing", async () => {
    const commands: (readonly string[])[] = [];
    const error: unknown = await createClone({
      projectPath: project,
      repositoryUrl: "--upload-pack=touch pwned",
      runner: {
        run: (command) => {
          commands.push(command);
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        },
      },
      environment: gitEnvironment,
      origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
    }).catch((caught: unknown) => caught);
    expect(isEvaError(error, "project_invalid")).toBe(true);
    expect(commands).toEqual([]);
  });

  test("ends the options before the URL and the folder", async () => {
    const commands: (readonly string[])[] = [];
    await createClone({
      projectPath: project,
      repositoryUrl: "https://github.com/owner/example-app",
      runner: {
        run: (command) => {
          commands.push(command);
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        },
      },
      environment: gitEnvironment,
      origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
    });
    expect(commands[0]?.slice(-3)).toEqual([
      "--",
      "https://github.com/owner/example-app",
      join(project, "repos", "example-app-0"),
    ]);
  });

  test("describes a clone with its branch, and counts its changed files apart", async () => {
    const clone = await createClone({
      projectPath: project,
      repositoryUrl: sandbox.remote,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      origins: new CloneOriginStore(join(sandbox.root, "clone-origins.json")),
    });
    expect(await describeClone(clone, systemProcessRunner, gitEnvironment)).toMatchObject({ branch: "main" });
    expect(await countChanges(clone, systemProcessRunner, gitEnvironment)).toBe(0);
    writeFileSync(join(clone.path, "new.txt"), "new\n");
    writeFileSync(join(clone.path, "other.txt"), "other\n");
    expect(await countChanges(clone, systemProcessRunner, gitEnvironment)).toBe(2);
  });

  test("describing a clone runs no git status, so the work report stays fast", async () => {
    mkdirSync(join(project, "repos", "example-app-0"), { recursive: true });
    const [clone] = listClones(project);
    if (clone === undefined) throw new Error("The test needs one clone.");
    const commands: (readonly string[])[] = [];
    const recording = {
      run: (command: readonly string[]) => {
        commands.push(command);
        return Promise.resolve({ exitCode: 0, stdout: "main\n", stderr: "" });
      },
    };
    await describeClone(clone, recording, gitEnvironment);
    expect(commands.some((command) => command.includes("status"))).toBe(false);
  });

  test("a clone whose git fails has no branch and no change count", async () => {
    mkdirSync(join(project, "repos", "example-app-0"), { recursive: true });
    const [clone] = listClones(project);
    if (clone === undefined) throw new Error("The test needs one clone.");
    const failing = { run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "not a git repository" }) };
    expect(await describeClone(clone, failing, gitEnvironment)).toMatchObject({ branch: null, pullRequest: null });
    expect(await countChanges(clone, failing, gitEnvironment)).toBeNull();
  });
});

describe("trust", () => {
  test("a repository whose owner is on the allowlist is trusted at once", () => {
    expect(isTrustedByDefault("https://github.com/owner/app", ["owner"])).toBe(true);
    expect(isTrustedByDefault("git@github.com:Owner/app.git", ["owner"])).toBe(true);
    expect(isTrustedByDefault("https://github.com/stranger/app", ["owner"])).toBe(false);
    expect(isTrustedByDefault("https://gitlab.com/owner/app", ["owner"])).toBe(false);
    // Only a URL whose host is github.com counts (security review).
    expect(isTrustedByDefault("https://evil.example/github.com/owner/app.git", ["owner"])).toBe(false);
    expect(isTrustedByDefault("https://token@github.com/owner/app.git", ["owner"])).toBe(true);
    expect(isTrustedByDefault("ssh://git@github.com/owner/app.git", ["owner"])).toBe(true);
  });

  test("the store remembers an answer by repository URL", () => {
    const path = join(sandbox.root, "trust.json");
    const store = new TrustStore(path);
    expect(store.decision("https://github.com/stranger/app")).toBe("unknown");
    store.remember("https://github.com/stranger/app", "trusted");
    expect(new TrustStore(path).decision("https://github.com/stranger/app")).toBe("trusted");
    store.remember("https://github.com/stranger/app", "untrusted");
    expect(new TrustStore(path).decision("https://github.com/stranger/app")).toBe("untrusted");
  });

  test("the store lists its answers by shown URL, and forgets one so that Eva asks again", () => {
    const path = join(sandbox.root, "trust.json");
    const store = new TrustStore(path);
    store.remember("https://user:secret@github.com/stranger/app.git", "trusted");
    store.remember("https://github.com/other/tool", "untrusted");
    expect(store.answers()).toEqual([
      { url: "https://github.com/other/tool", decision: "untrusted" },
      { url: "https://github.com/stranger/app.git", decision: "trusted" },
    ]);
    store.forget("https://github.com/stranger/app.git");
    expect(store.decision("https://user:secret@github.com/stranger/app.git")).toBe("unknown");
    expect(new TrustStore(path).answers()).toEqual([{ url: "https://github.com/other/tool", decision: "untrusted" }]);
  });

  test("two URLs that show alike give one row, and a denial wins", () => {
    const store = new TrustStore(join(sandbox.root, "trust.json"));
    store.remember("https://one@github.com/owner/app", "untrusted");
    store.remember("https://two@github.com/owner/app", "trusted");
    expect(store.answers()).toEqual([{ url: "https://github.com/owner/app", decision: "untrusted" }]);
    store.forget("https://github.com/nobody/app");
    expect(store.answers()).toHaveLength(1);
  });

  test("a broken trust file means no answers yet", () => {
    const path = join(sandbox.root, "trust.json");
    sandbox.write(sandbox.root, "trust.json", "{broken");
    expect(new TrustStore(path).decision("https://github.com/owner/app")).toBe("unknown");
  });
});

describe("clone origins", () => {
  const originsPath = (): string => join(sandbox.root, "clone-origins.json");
  /** A folder with a git folder, which is all that the marker needs. */
  const folder = (name: string): string => {
    const path = join(project, "repos", name);
    mkdirSync(join(path, ".git"), { recursive: true });
    return path;
  };

  test("the store keeps the URL that Eva cloned from, by clone folder", () => {
    const store = new CloneOriginStore(originsPath());
    expect(store.origin(folder("app-0"))).toBeNull();
    store.recordClone(folder("app-0"), "https://github.com/owner/app.git");
    expect(new CloneOriginStore(originsPath()).origin(folder("app-0"))).toEqual({
      kind: "cloned",
      url: "https://github.com/owner/app.git",
    });
    expect(new CloneOriginStore(originsPath()).origin(folder("app-1"))).toBeNull();
  });

  test("a person's answer about a folder stays with that folder", () => {
    new CloneOriginStore(originsPath()).recordAnswer(folder("app-0"), "https://github.com/owner/app.git", "untrusted");
    expect(new CloneOriginStore(originsPath()).origin(folder("app-0"))).toEqual({
      kind: "answered",
      url: "https://github.com/owner/app.git",
      decision: "untrusted",
    });
  });

  test("a new clone in a folder replaces its old record", () => {
    const store = new CloneOriginStore(originsPath());
    store.recordAnswer(folder("app-0"), "https://github.com/stranger/old.git", "trusted");
    store.recordClone(folder("app-0"), "https://github.com/owner/app.git");
    expect(store.origin(folder("app-0"))).toEqual({ kind: "cloned", url: "https://github.com/owner/app.git" });
  });

  test("the same folder, written another way, finds the same record", () => {
    const store = new CloneOriginStore(originsPath());
    store.recordClone(folder("app-0"), "https://github.com/owner/app.git");
    expect(store.origin(join(project, "repos", ".", "app-0"))).toEqual({
      kind: "cloned",
      url: "https://github.com/owner/app.git",
    });
  });

  test("a folder made again at the same path, or one whose marker is gone, is replaced", () => {
    const store = new CloneOriginStore(originsPath());
    store.recordClone(folder("app-0"), "https://github.com/owner/app.git");
    rmSync(join(project, "repos", "app-0"), { recursive: true });
    const replaced = { kind: "replaced", url: "https://github.com/owner/app.git" } as const;
    expect(store.origin(join(project, "repos", "app-0"))).toEqual(replaced);
    expect(store.origin(folder("app-0"))).toEqual(replaced);
    store.recordClone(folder("app-1"), "https://github.com/owner/app.git");
    rmSync(join(project, "repos", "app-1", ".git", "eva-clone-id"));
    expect(store.origin(folder("app-1"))).toEqual(replaced);
  });

  test("a clone whose .git is a file, as in a worktree, keeps its marker in the git folder it names", () => {
    const store = new CloneOriginStore(originsPath());
    const gitFolder = join(sandbox.root, "worktree-git");
    mkdirSync(gitFolder, { recursive: true });
    const path = join(project, "repos", "app-0");
    mkdirSync(path, { recursive: true });
    sandbox.write(path, ".git", `gitdir: ${gitFolder}\n`);
    store.recordClone(path, "https://github.com/owner/app.git");
    expect(existsSync(join(gitFolder, "eva-clone-id"))).toBe(true);
    expect(store.origin(path)).toEqual({ kind: "cloned", url: "https://github.com/owner/app.git" });
  });

  test("a folder with no git folder gets no record", () => {
    const store = new CloneOriginStore(originsPath());
    const path = join(project, "repos", "app-0");
    mkdirSync(path, { recursive: true });
    store.recordClone(path, "https://github.com/owner/app.git");
    sandbox.write(path, ".git", "not a pointer\n");
    store.recordClone(path, "https://github.com/owner/app.git");
    expect(store.origin(path)).toBeNull();
    expect(existsSync(originsPath())).toBe(false);
  });

  test("a broken or odd origins file means no records yet", () => {
    const path = folder("app-0");
    new CloneOriginStore(originsPath()).recordClone(path, "https://github.com/owner/app.git");
    const good = JSON.parse(readFileSync(originsPath(), "utf8")) as Record<string, Record<string, unknown>>;
    const [key, record] = Object.entries(good)[0] ?? ["", {}];
    expect(new CloneOriginStore(originsPath()).origin(path)).not.toBeNull();
    for (const content of [
      "{broken",
      "[]",
      JSON.stringify({ [key]: null }),
      JSON.stringify({ [key]: { ...record, url: 3 } }),
      JSON.stringify({ [key]: { url: record["url"] } }),
      JSON.stringify({ [key]: { ...record, decision: "maybe" } }),
    ]) {
      sandbox.write(sandbox.root, "clone-origins.json", content);
      expect(new CloneOriginStore(originsPath()).origin(path)).toBeNull();
    }
  });
});

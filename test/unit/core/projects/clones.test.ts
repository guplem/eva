import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  cloneFolderName,
  createClone,
  isTrustedByDefault,
  listClones,
  repositoryName,
  TrustStore,
} from "../../../../src/core/projects/clones.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let project: string;

beforeEach(() => {
  sandbox = createGitSandbox();
  project = join(sandbox.root, "vault", "Projects", "2025-03-02-1015-example-app");
  mkdirSync(project, { recursive: true });
});
afterEach(() => {
  sandbox.dispose();
});

describe("repositoryName", () => {
  test("takes the last path part of a URL, without .git", () => {
    expect(repositoryName("https://github.com/owner/example-app")).toBe("example-app");
    expect(repositoryName("https://github.com/owner/example-app.git/")).toBe("example-app");
    expect(repositoryName("git@github.com:owner/Tool.git")).toBe("Tool");
    expect(repositoryName("C:\\repos\\local.git")).toBe("local");
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

  test("creates a clone in the next free folder", async () => {
    const clone = await createClone({
      projectPath: project,
      repositoryUrl: sandbox.remote,
      runner: systemProcessRunner,
      environment: gitEnvironment,
    });
    expect(clone.name).toBe("remote-0");
    expect(sandbox.git(clone.path, "log", "-1", "--format=%s")).toBe("seed");
  });

  test("reports a clone that fails", async () => {
    const error: unknown = await createClone({
      projectPath: project,
      repositoryUrl: join(sandbox.root, "missing.git"),
      runner: systemProcessRunner,
      environment: gitEnvironment,
    }).catch((caught: unknown) => caught);
    expect(isEvaError(error, "git_failed")).toBe(true);
  });
});

describe("trust", () => {
  test("a repository whose owner is on the allowlist is trusted at once", () => {
    expect(isTrustedByDefault("https://github.com/owner/app", ["owner"])).toBe(true);
    expect(isTrustedByDefault("git@github.com:Owner/app.git", ["owner"])).toBe(true);
    expect(isTrustedByDefault("https://github.com/stranger/app", ["owner"])).toBe(false);
    expect(isTrustedByDefault("https://gitlab.com/owner/app", ["owner"])).toBe(false);
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

  test("a broken trust file means no answers yet", () => {
    const path = join(sandbox.root, "trust.json");
    sandbox.write(sandbox.root, "trust.json", "{broken");
    expect(new TrustStore(path).decision("https://github.com/owner/app")).toBe("unknown");
  });
});

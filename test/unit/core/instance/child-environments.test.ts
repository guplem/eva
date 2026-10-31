import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  engineEnvironment,
  gitEnvironment,
  gitEnvironmentWithToken,
  projectWallRoots,
} from "../../../../src/core/instance/child-environments.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let home: string;
let paths: HomePaths;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-environments-"));
  paths = homePaths(home);
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const identity = { name: "Example User", email: "1234+example-user@users.noreply.github.com" };
const identityVariables = {
  GIT_AUTHOR_NAME: "Example User",
  GIT_AUTHOR_EMAIL: "1234+example-user@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Example User",
  GIT_COMMITTER_EMAIL: "1234+example-user@users.noreply.github.com",
};

describe("the commit identity of an instance's git", () => {
  test("Eva's own git signs with the instance's identity", () => {
    const environment = gitEnvironment({ paths, processEnvironment: {}, commitIdentity: identity }, {});
    expect(environment).toMatchObject(identityVariables);
  });

  test("the git of a step before the core starts signs with it too", () => {
    expect(gitEnvironmentWithToken({}, {}, identity)).toMatchObject(identityVariables);
  });

  test("a part that is null leaves that part to git's own settings", () => {
    const environment = gitEnvironmentWithToken({}, {}, { name: "Example User", email: null });
    expect(environment["GIT_AUTHOR_NAME"]).toBe("Example User");
    expect(environment["GIT_AUTHOR_EMAIL"]).toBeUndefined();
    expect(environment["GIT_COMMITTER_EMAIL"]).toBeUndefined();
  });

  test("with no identity, git keeps its own, as before", () => {
    const environment = gitEnvironment({ paths, processEnvironment: {} }, {});
    expect(Object.keys(environment).filter((name) => /^GIT_(AUTHOR|COMMITTER)_/.test(name))).toEqual([]);
  });

  test("the agents' git config holds the identity, and their environment holds no variables for it", () => {
    const environment = engineEnvironment({ paths, processEnvironment: {}, commitIdentity: identity }, {});
    const config = readFileSync(environment["GIT_CONFIG_GLOBAL"] ?? "", "utf8");
    expect(config).toContain('name = "Example User"');
    expect(config).toContain('email = "1234+example-user@users.noreply.github.com"');
    // A variable would beat a name that the person sets in one clone with `git config user.name`.
    expect(environment["GIT_AUTHOR_NAME"]).toBeUndefined();
  });
});

describe("projectWallRoots (#711)", () => {
  test("closes Eva's folder, but keeps readable each file that the agent's git, gh and PATH name", () => {
    const environment = engineEnvironment({ paths, processEnvironment: { PATH: "/usr/bin" }, evaCommand: ["eva"] }, {});
    const wall = projectWallRoots(paths, "/srv/vault", ["/srv/projects"]);
    expect(wall.closed).toEqual(["/srv/vault", "/srv/projects", paths.root]);
    const readable = (path: string): boolean => wall.readable.some((folder) => path.startsWith(folder));
    expect(readable(environment["GIT_CONFIG_GLOBAL"] ?? "")).toBe(true);
    expect(readable(join(environment["GH_CONFIG_DIR"] ?? "", "hosts.yml"))).toBe(true);
    expect(readable(join((environment["PATH"] ?? "").split(delimiter)[0] ?? "", "eva"))).toBe(true);
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", "shell-snapshots", "s.sh"))).toBe(true);
    // Claude Code's login and every chat's history stay closed.
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", ".credentials.json"))).toBe(false);
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", "projects"))).toBe(false);
  });
});

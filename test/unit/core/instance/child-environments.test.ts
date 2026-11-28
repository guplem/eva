import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  engineEnvironment,
  gitEnvironment,
  gitEnvironmentWithToken,
  projectWallRoots,
} from "../../../../src/core/instance/child-environments.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { userspaceFolders } from "../../../../src/core/remote-access/tailscale.ts";
import { githubCredentialArguments } from "../../../../src/core/vault/vault-clone.ts";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import {
  createGitSandbox,
  gitEnvironment as testGitEnvironment,
  type GitSandbox,
  gitHookTimeoutMs,
} from "../../../support/git-sandbox.ts";
import { markerProgram } from "../../../support/marker-program.ts";

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

describe("the settings that Eva's own git forces (#1131)", () => {
  const configOf = (environment: Record<string, string>): Map<string, string> => {
    const entries = new Map<string, string>();
    const count = Number(environment["GIT_CONFIG_COUNT"] ?? "0");
    for (let index = 0; index < count; index += 1)
      entries.set(
        environment[`GIT_CONFIG_KEY_${String(index)}`] ?? "",
        environment[`GIT_CONFIG_VALUE_${String(index)}`] ?? "",
      );
    return entries;
  };

  test("both git environments turn off the file-system monitor and the submodule recursion", () => {
    for (const environment of [
      gitEnvironment({ paths, processEnvironment: {} }, {}),
      gitEnvironmentWithToken({}, {}),
    ]) {
      const config = configOf(environment);
      expect(config.get("core.fsmonitor")).toBe("false");
      expect(config.get("diff.ignoreSubmodules")).toBe("dirty");
      expect(config.get("submodule.recurse")).toBe("false");
      expect(environment["GIT_PAGER"]).toBe("cat");
    }
  });

  test("the person's own login, proxy, signing and address settings stay as they are", () => {
    const keys = [...configOf(gitEnvironment({ paths, processEnvironment: {} }, {})).keys()].map((key) =>
      key.toLowerCase(),
    );
    for (const key of keys) expect(key).not.toMatch(/^(credential|http|url|gpg|user)\.|sshcommand|hookspath/);
  });

  test("the shell's own GIT_CONFIG_COUNT never reaches Eva's git", () => {
    const environment = gitEnvironmentWithToken({ GIT_CONFIG_COUNT: "5", GIT_CONFIG_KEY_4: "x.y" }, {});
    expect(environment["GIT_CONFIG_KEY_4"]).not.toBe("x.y");
  });
});

describe("projectWallRoots (#711)", () => {
  test("closes Eva's folder, but keeps readable each file that the agent's git, gh and PATH name", () => {
    const environment = engineEnvironment({ paths, processEnvironment: { PATH: "/usr/bin" }, evaCommand: ["eva"] }, {});
    const wall = projectWallRoots(paths, "/srv/vault", ["/srv/projects"]);
    // Eva's own Tailscale keeps its key and its control socket in the home folder.
    expect(wall.closed).toEqual(["/srv/vault", "/srv/projects", paths.root, userspaceFolders(homedir()).state]);
    const readable = (path: string): boolean => wall.readable.some((folder) => path.startsWith(folder));
    expect(readable(environment["GIT_CONFIG_GLOBAL"] ?? "")).toBe(true);
    expect(readable(join(environment["GH_CONFIG_DIR"] ?? "", "hosts.yml"))).toBe(true);
    expect(readable(join((environment["PATH"] ?? "").split(delimiter)[0] ?? "", "eva"))).toBe(true);
    // Each engine opens its own folders: the core names none of them (#759).
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", "shell-snapshots", "s.sh"))).toBe(false);
    // Claude Code's login and every chat's history stay closed.
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", ".credentials.json"))).toBe(false);
    expect(readable(join(environment["CLAUDE_CONFIG_DIR"] ?? "", "projects"))).toBe(false);
  });
});

describe("Eva's own git in a vault with a nested repository (#1131)", () => {
  let sandbox: GitSandbox;
  beforeEach(() => {
    sandbox = createGitSandbox();
  }, gitHookTimeoutMs);
  afterEach(() => {
    sandbox.dispose();
  }, gitHookTimeoutMs);

  /** The test shell's variables, without its own git settings, as Eva's process would have them. */
  const processEnvironment = (): Record<string, string | undefined> => ({
    ...Object.fromEntries(Object.entries(testGitEnvironment).filter(([name]) => !name.startsWith("GIT_CONFIG"))),
    GIT_CONFIG_NOSYSTEM: "1",
  });

  test("a program that the nested repository's own config names never runs, and the sync still works", async () => {
    const vault = sandbox.clone("vault");
    const program = markerProgram(sandbox.root);
    const nested = join(vault, "Projects", "2026-01-01-0000-example-app", "notes");
    mkdirSync(nested, { recursive: true });
    sandbox.git(nested, "init", "-q");
    sandbox.write(nested, "a.md", "one\n");
    sandbox.git(nested, "add", "-A");
    sandbox.git(nested, "commit", "-q", "-m", "one");
    const environment = {
      ...gitEnvironmentWithToken(processEnvironment(), {}),
      ...Object.fromEntries(
        Object.entries(testGitEnvironment).filter(([name]) => /^GIT_(AUTHOR|COMMITTER)_/.test(name)),
      ),
    };
    const sync = new VaultSync({ vaultPath: vault, runner: systemProcessRunner, environment, now: () => new Date() });
    // The first save stages the nested repository as a link to its commit.
    expect((await sync.save()).status).toBe("ok");
    sandbox.git(nested, "config", "core.fsmonitor", program.path);
    sandbox.git(nested, "config", "filter.marker.clean", program.path);
    sandbox.write(nested, ".gitattributes", "* filter=marker\n");
    sandbox.write(nested, "a.md", "two\n");
    sandbox.write(vault, "Methods/New.md", "Steps.\n");

    expect((await sync.save()).status).toBe("ok");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
    expect(program.ran()).toBe(false);
  });
});

describe("Eva's GitHub login with the forced settings (#1131)", () => {
  test("Eva's own credential helper still gives git the token", async () => {
    const folder = mkdtempSync(join(tmpdir(), "eva-credential-"));
    try {
      const environment = {
        ...gitEnvironmentWithToken(
          { ...Object.fromEntries(Object.entries(testGitEnvironment).filter(([name]) => !name.startsWith("GIT_"))) },
          { githubToken: "example-token" },
        ),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(folder, "empty.gitconfig"),
        GIT_TERMINAL_PROMPT: "0",
      };
      const result = await systemProcessRunner.run(["git", ...githubCredentialArguments, "credential", "fill"], {
        cwd: folder,
        environment,
        timeoutMs: 20_000,
        stdin: "protocol=https\nhost=github.com\n\n",
      });
      expect(result.stdout).toContain("password=example-token");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

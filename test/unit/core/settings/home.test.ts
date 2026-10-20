import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  createHomeFolders,
  defaultConfig,
  engineFolders,
  engineFolderVariables,
  engineGitConfig,
  homePaths,
  instanceHome,
  instanceNameOf,
  instanceNameProblem,
  instancesFolder,
  listInstances,
  loadConfig,
  loadSecrets,
  saveConfig,
  saveSecrets,
} from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-home-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("engine folders of an instance (lesson 111)", () => {
  test("each engine has its own folder in the engines folder of the home", () => {
    const folders = engineFolders(homePaths(join(home, "eva-partner")));
    expect(folders).toEqual({
      claude: join(home, "eva-partner", "engines", "claude"),
      piAgent: join(home, "eva-partner", "engines", "pi-agent"),
      gh: join(home, "eva-partner", "engines", "gh"),
      git: join(home, "eva-partner", "engines", "git"),
    });
    expect(engineFolderVariables(folders)).toEqual({
      CLAUDE_CONFIG_DIR: folders.claude,
      PI_CODING_AGENT_DIR: folders.piAgent,
      GH_CONFIG_DIR: folders.gh,
    });
  });

  test("the instance's git config asks gh for GitHub and keeps the person's other git settings", () => {
    const userHome = join(home, "user");
    const xdg = join(home, "xdg");
    const bin = join(home, "bin");
    mkdirSync(join(xdg, "git"), { recursive: true });
    mkdirSync(userHome);
    mkdirSync(bin);
    writeFileSync(join(xdg, "git", "config"), "[user]\n\tname = Kept Name\n");
    const firstHelper = '"!f() { echo username=first; echo password=first; }; f"';
    writeFileSync(join(userHome, ".gitconfig"), `[credential]\n\thelper = ${firstHelper}\n`);
    // A stand-in for gh that shows which login folder it was given.
    writeFileSync(join(bin, "gh"), '#!/bin/sh\necho username=second\necho "password=$GH_CONFIG_DIR"\n', {
      mode: 0o755,
    });
    const gitConfig = join(home, "eva-partner", "engines", "git", "gitconfig");
    mkdirSync(join(gitConfig, ".."), { recursive: true });
    writeFileSync(gitConfig, engineGitConfig({ XDG_CONFIG_HOME: xdg }, gitConfig));
    const environment = {
      // Windows names it `Path`. A second key would hide the fake gh from git.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && name.toUpperCase() !== "PATH"),
      ),
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      HOME: userHome,
      XDG_CONFIG_HOME: xdg,
      GH_CONFIG_DIR: "partner-gh",
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_TERMINAL_PROMPT: "0",
    };
    const git = (stdin: string, ...arguments_: string[]): string =>
      Bun.spawnSync(["git", ...arguments_], {
        cwd: home,
        env: environment,
        stdin: Buffer.from(stdin),
      }).stdout.toString();
    const fill = (host: string): string => git(`protocol=https\nhost=${host}\n\n`, "credential", "fill");

    expect(fill("github.com")).toContain("password=partner-gh");
    expect(fill("gitlab.example.com")).toContain("password=first");
    expect(git("", "config", "user.name").trim()).toBe("Kept Name");
  });

  test("the instance's git config includes the person's GIT_CONFIG_GLOBAL when it is set", () => {
    const config = engineGitConfig({ GIT_CONFIG_GLOBAL: 'D:\\git\\my "global"' }, "D:\\eva\\gitconfig");
    expect(config).toContain('path = "D:\\\\git\\\\my \\"global\\""');
    expect(config).not.toContain("~/.gitconfig");
  });

  test("the instance's git config never includes itself, which would break every git command", () => {
    const gitConfig = join(home, "engines", "git", "gitconfig");
    expect(engineGitConfig({ GIT_CONFIG_GLOBAL: gitConfig }, gitConfig)).toContain('path = "~/.gitconfig"');
  });

  test("the instance's commit identity wins over the person's global one, which keeps its other settings", () => {
    const global = join(home, "global.gitconfig");
    writeFileSync(global, "[user]\n\tname = Global Name\n\temail = global@example.com\n[alias]\n\tst = status\n");
    const gitConfig = join(home, "gitconfig");
    const identity = { name: 'Example "User"', email: "1234+example-user@users.noreply.github.com" };
    writeFileSync(gitConfig, engineGitConfig({ GIT_CONFIG_GLOBAL: global }, gitConfig, identity));
    const read = (key: string): string =>
      Bun.spawnSync(["git", "config", "--global", "--includes", key], {
        cwd: home,
        env: {
          // A GIT_CONFIG_COUNT or GIT_AUTHOR_NAME of the shell that runs the tests would win over the file.
          ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
          GIT_CONFIG_GLOBAL: gitConfig,
          GIT_CONFIG_NOSYSTEM: "1",
        },
      })
        .stdout.toString()
        .trim();

    expect(read("user.name")).toBe('Example "User"');
    expect(read("user.email")).toBe("1234+example-user@users.noreply.github.com");
    expect(read("alias.st")).toBe("status");
  });

  test("a part of the identity that is null stays with the person's global settings", () => {
    const config = engineGitConfig({}, join(home, "gitconfig"), { name: "Example User", email: null });
    expect(config).toContain('name = "Example User"');
    expect(config).not.toContain("email");
  });
});

describe("instances", () => {
  test("Linux keeps the instances in XDG_CONFIG_HOME, or ~/.config", () => {
    expect(instancesFolder({ environment: { XDG_CONFIG_HOME: "/x" }, platform: "linux", userHome: "/u" })).toBe("/x");
    expect(instancesFolder({ environment: {}, platform: "linux", userHome: "/u" })).toBe(join("/u", ".config"));
  });

  test("Windows keeps the instances in APPDATA", () => {
    expect(instancesFolder({ environment: { APPDATA: "C:/AppData" }, platform: "win32", userHome: "C:/u" })).toBe(
      "C:/AppData",
    );
  });

  test("the home of an instance is eva-<name>, and the name comes back from it", () => {
    const paths = homePaths(instanceHome("/x", "ana"));
    expect(paths.root).toBe(join("/x", "eva-ana"));
    expect(instanceNameOf(paths)).toBe("ana");
  });

  test("a name has lower-case letters, digits and single dashes", () => {
    for (const name of ["eva", "ana-2", "x"]) expect(instanceNameProblem(name)).toBeNull();
    for (const name of ["", "Ana", "ana bob", "-ana", "ana-", "a--b", "a/b", "x".repeat(33)])
      expect(instanceNameProblem(name)).not.toBeNull();
  });

  test("the list holds each eva-<name> folder with a config, sorted", () => {
    for (const name of ["eva-zoe", "eva-ana"]) {
      mkdirSync(join(home, name));
      writeFileSync(join(home, name, "config.json"), "{}");
    }
    // Not an instance: no config, a bad name, another program's folder, a file.
    mkdirSync(join(home, "eva-empty"));
    mkdirSync(join(home, "eva-Bad"));
    writeFileSync(join(home, "eva-Bad", "config.json"), "{}");
    mkdirSync(join(home, "other"));
    writeFileSync(join(home, "eva-file"), "");
    expect(listInstances(home)).toEqual(["ana", "zoe"]);
  });

  test("a missing folder holds no instance", () => {
    expect(listInstances(join(home, "missing"))).toEqual([]);
  });
});

describe("config", () => {
  test("a missing config file means the defaults", () => {
    expect(loadConfig(homePaths(home))).toEqual(defaultConfig);
  });

  test("a saved config loads back, and missing keys take their defaults", () => {
    const paths = homePaths(home);
    saveConfig(paths, { ...defaultConfig, vaultPath: "/vault", port: 7421 });
    expect(loadConfig(paths)).toEqual({ ...defaultConfig, vaultPath: "/vault", port: 7421 });
    writeFileSync(paths.config, JSON.stringify({ version: 1, vaultPath: "/v" }));
    expect(loadConfig(paths)).toEqual({ ...defaultConfig, vaultPath: "/v" });
  });

  test("an invalid config is an EvaError that names the bad field", () => {
    const paths = homePaths(home);
    writeFileSync(paths.config, JSON.stringify({ version: 1, port: "high", role: "boss" }));
    const error: unknown = (() => {
      try {
        loadConfig(paths);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(isEvaError(error, "config_invalid")).toBe(true);
    expect((error as Error).message).toContain("port");
  });

  test("a config file that is not JSON is an EvaError", () => {
    const paths = homePaths(home);
    writeFileSync(paths.config, "{");
    expect(() => loadConfig(paths)).toThrow("not valid JSON");
  });
});

describe("secrets", () => {
  test("no file means no secrets", () => {
    expect(loadSecrets(homePaths(home))).toEqual({});
  });

  test("saved secrets load back", () => {
    const paths = homePaths(home);
    saveSecrets(paths, { telegramBotToken: "123:abc", localApiToken: "t" });
    expect(loadSecrets(paths)).toEqual({ telegramBotToken: "123:abc", localApiToken: "t" });
  });

  test("an invalid secrets file is an EvaError", () => {
    const paths = homePaths(home);
    writeFileSync(paths.secrets, JSON.stringify({ telegramBotToken: 5 }));
    expect(() => loadSecrets(paths)).toThrow("secrets.json");
  });
});

describe("createHomeFolders", () => {
  test("creates the home and state folders for the OS user only, also when they exist", () => {
    const paths = homePaths(join(home, "eva"));
    mkdirSync(paths.root, { mode: 0o755 });
    createHomeFolders(paths);
    expect(existsSync(paths.stateFolder)).toBe(true);
    // Windows has no POSIX modes; the call must still succeed there.
    if (process.platform === "win32") return;
    expect(statSync(paths.root).mode & 0o777).toBe(0o700);
    expect(statSync(paths.stateFolder).mode & 0o777).toBe(0o700);
  });
});

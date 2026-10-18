import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineFolders, homePaths, type EngineFolders } from "../../../../src/core/settings/home.ts";
import {
  engineLoginReport,
  engineLoginState,
  engineLoginSteps,
  quoteForShell,
  withVariable,
  type EngineLoginState,
} from "../../../../src/frontends/cli/engine-logins.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

let home: string;
let folders: EngineFolders;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-logins-"));
  folders = engineFolders(homePaths(home));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const nothing: EngineLoginState = { claudeToken: false, pi: "missing", gh: false };
const everything: EngineLoginState = { claudeToken: true, pi: "ok", gh: true };

function writePiLogin(content: string): void {
  mkdirSync(folders.piAgent, { recursive: true });
  writeFileSync(join(folders.piAgent, "auth.json"), content);
}

describe("withVariable and quoteForShell", () => {
  test("a POSIX shell sets the variable for the one command, with the folder quoted", () => {
    expect(withVariable("GH_CONFIG_DIR", "/srv/o'brien/eva/engines/gh", ["gh", "auth", "login"], "linux")).toBe(
      "GH_CONFIG_DIR='/srv/o'\\''brien/eva/engines/gh' gh auth login",
    );
  });

  test("PowerShell sets the variable, runs the command, and removes the variable again", () => {
    expect(
      withVariable("GH_CONFIG_DIR", "D:\\eva-homes\\o'brien\\eva\\engines\\gh", ["gh", "auth", "login"], "win32"),
    ).toBe(
      "$env:GH_CONFIG_DIR = 'D:\\eva-homes\\o''brien\\eva\\engines\\gh'; gh auth login; Remove-Item Env:GH_CONFIG_DIR",
    );
  });

  test("PowerShell also ends a string at a curly quote, so each one is doubled", () => {
    expect(quoteForShell("D:\\eva-homes\\O\u2019Brien", "win32")).toBe("'D:\\eva-homes\\O\u2019\u2019Brien'");
  });
});

describe("engineLoginState", () => {
  const ghRunner = (
    exitCode: number,
    calls: { command: readonly string[]; environment: Readonly<Record<string, string>> }[] = [],
  ): ProcessRunner => ({
    run: (command, options) => {
      calls.push({ command, environment: options.environment });
      return Promise.resolve({ exitCode, stdout: "", stderr: "" });
    },
  });

  test("reads the saved Claude token, pi's login file, and gh's login in this instance's folder", async () => {
    writePiLogin('{"openai-codex":{"type":"oauth"}}');
    const calls: { command: readonly string[]; environment: Readonly<Record<string, string>> }[] = [];
    const state = await engineLoginState({
      folders,
      claudeTokenSaved: true,
      runner: ghRunner(0, calls),
      environment: { PATH: "/bin" },
    });
    expect(state).toEqual(everything);
    expect(calls[0]?.command).toEqual(["gh", "auth", "status", "--hostname", "github.com"]);
    expect(calls[0]?.environment).toEqual({ PATH: "/bin", GH_CONFIG_DIR: folders.gh, GIT_TERMINAL_PROMPT: "0" });
  });

  test("an empty pi login file and a failed gh check are missing logins", async () => {
    writePiLogin("{}");
    expect(await engineLoginState({ folders, claudeTokenSaved: false, runner: ghRunner(1), environment: {} })).toEqual(
      nothing,
    );
  });

  test("a Claude login in pi is found, because Eva never uses a Claude login through pi", async () => {
    writePiLogin('{"anthropic":{"type":"oauth"}}');
    const state = await engineLoginState({ folders, claudeTokenSaved: true, runner: ghRunner(0), environment: {} });
    expect(state.pi).toBe("claude");
  });

  test("a missing gh program or a broken pi file counts as missing, and never stops setup", async () => {
    writePiLogin("{broken");
    const throwing: ProcessRunner = { run: () => Promise.reject(new Error("no gh")) };
    expect(await engineLoginState({ folders, claudeTokenSaved: false, runner: throwing, environment: {} })).toEqual(
      nothing,
    );
  });
});

describe("engineLoginSteps", () => {
  test("explains why, and gives one step for each missing login, GitHub first", () => {
    const steps = engineLoginSteps(nothing, folders, "linux");
    const text = steps.join("\n");
    expect(text).toContain("second Eva on this computer");
    expect(text).toContain("keeps going");
    expect(text.indexOf("- GitHub")).toBeLessThan(text.indexOf("- Claude"));
    expect(text).toContain(`GH_CONFIG_DIR='${folders.gh}' gh auth login --insecure-storage`);
    expect(text).toContain("claude setup-token");
    expect(text).toContain("your own Claude account");
    expect(text).toContain(`PI_CODING_AGENT_DIR='${folders.piAgent}' pi`);
    expect(text).toContain("/login inside pi");
    expect(text).toContain("answer No");
    expect(text).toContain("Never choose Anthropic");
  });

  test("a Claude login in pi gets a step to log out of it", () => {
    expect(engineLoginSteps({ ...everything, pi: "claude" }, folders, "linux").join("\n")).toContain("/logout");
  });

  test("on Windows, the steps say to use PowerShell", () => {
    expect(engineLoginSteps(nothing, folders, "win32").join("\n")).toContain("PowerShell");
  });

  test("no steps when every login is in place", () => {
    expect(engineLoginSteps(everything, folders, "linux")).toEqual([]);
  });
});

describe("engineLoginReport", () => {
  test("each login in place shows as done", () => {
    const text = engineLoginReport(everything, folders, "run setup again", "linux").join("\n");
    expect(text).toContain("- Claude: token saved.");
    expect(text).toContain("- pi: logged in.");
    expect(text).toContain("- GitHub: logged in.");
  });

  test("each missing login says what to run", () => {
    const text = engineLoginReport(nothing, folders, "run setup again", "linux").join("\n");
    expect(text).toContain("- Claude: no token yet.");
    expect(text).toContain("Then run setup again.");
    expect(text).toContain("- pi: not logged in.");
    expect(text).toContain("- GitHub: not logged in.");
    expect(text).toContain("gh auth login --insecure-storage");
  });

  test("a Claude login in pi gets a warning", () => {
    const text = engineLoginReport({ ...everything, pi: "claude" }, folders, "run setup again", "linux").join("\n");
    expect(text).toContain("pi has a Claude login");
  });
});

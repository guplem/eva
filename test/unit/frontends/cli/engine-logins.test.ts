import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineLoginReport, engineLoginSteps, withVariable } from "../../../../src/frontends/cli/engine-logins.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

let home: string;
let folders: Record<string, string>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-logins-"));
  folders = {
    CLAUDE_CONFIG_DIR: join(home, "engines", "claude"),
    PI_CODING_AGENT_DIR: join(home, "engines", "pi-agent"),
    GH_CONFIG_DIR: join(home, "engines", "gh"),
  };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("withVariable", () => {
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
});

describe("engineLoginSteps", () => {
  test("an extra instance explains why, and gives one login step for each engine", () => {
    const text = engineLoginSteps(folders, "linux").join("\n");
    expect(text).toContain("not in the default home");
    expect(text).toContain("claude setup-token");
    expect(text).toContain("your own Claude account");
    expect(text).toContain(`PI_CODING_AGENT_DIR='${folders["PI_CODING_AGENT_DIR"] ?? ""}' pi`);
    expect(text).toContain("/login");
    expect(text).toContain("Never choose Anthropic");
    expect(text).toContain(`GH_CONFIG_DIR='${folders["GH_CONFIG_DIR"] ?? ""}' gh auth login`);
  });

  test("the first instance needs no steps", () => {
    expect(engineLoginSteps({}, "linux")).toEqual([]);
  });
});

describe("engineLoginReport", () => {
  const ghRunner = (
    exitCode: number,
    calls: { environment: Readonly<Record<string, string>> }[] = [],
  ): ProcessRunner => ({
    run: (command, options) => {
      if (command.join(" ") === "gh auth status") calls.push({ environment: options.environment });
      return Promise.resolve({ exitCode, stdout: "", stderr: "" });
    },
  });

  test("each login that is in place shows as done; gh is asked with this instance's folder", async () => {
    mkdirSync(folders["PI_CODING_AGENT_DIR"] ?? "", { recursive: true });
    writeFileSync(join(folders["PI_CODING_AGENT_DIR"] ?? "", "auth.json"), '{"openai-codex":{"type":"oauth"}}');
    const calls: { environment: Readonly<Record<string, string>> }[] = [];
    const lines = await engineLoginReport({
      folders,
      claudeTokenSaved: true,
      runner: ghRunner(0, calls),
      environment: { PATH: "/bin" },
      platform: "linux",
    });
    expect(lines.join("\n")).toContain("Claude: logged in");
    expect(lines.join("\n")).toContain("pi: logged in");
    expect(lines.join("\n")).toContain("GitHub: logged in");
    expect(calls[0]?.environment).toEqual({ PATH: "/bin", ...folders, GIT_TERMINAL_PROMPT: "0" });
  });

  test("each missing login says what to run", async () => {
    mkdirSync(folders["PI_CODING_AGENT_DIR"] ?? "", { recursive: true });
    writeFileSync(join(folders["PI_CODING_AGENT_DIR"] ?? "", "auth.json"), "{}");
    const text = (
      await engineLoginReport({
        folders,
        claudeTokenSaved: false,
        runner: ghRunner(1),
        environment: {},
        platform: "linux",
      })
    ).join("\n");
    expect(text).toContain("Claude: not logged in");
    expect(text).toContain("claude setup-token");
    expect(text).toContain("pi: not logged in");
    expect(text).toContain("GitHub: not logged in");
    expect(text).toContain("gh auth login");
  });

  test("a missing gh program or a broken pi file counts as not logged in, and never stops setup", async () => {
    mkdirSync(folders["PI_CODING_AGENT_DIR"] ?? "", { recursive: true });
    writeFileSync(join(folders["PI_CODING_AGENT_DIR"] ?? "", "auth.json"), "{broken");
    const throwing: ProcessRunner = { run: () => Promise.reject(new Error("no gh")) };
    const text = (
      await engineLoginReport({ folders, claudeTokenSaved: true, runner: throwing, environment: {}, platform: "linux" })
    ).join("\n");
    expect(text).toContain("pi: not logged in");
    expect(text).toContain("GitHub: not logged in");
  });

  test("the first instance gets no report", async () => {
    expect(
      await engineLoginReport({
        folders: {},
        claudeTokenSaved: false,
        runner: ghRunner(1),
        environment: {},
        platform: "linux",
      }),
    ).toEqual([]);
  });
});

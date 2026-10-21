import { describe, expect, test } from "bun:test";
import { readToolVersions, shortVersion, tools } from "../../../src/core/tool-versions.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";

describe("shortVersion", () => {
  test("keeps only the version number of each tool's first line", () => {
    expect(shortVersion("git version 2.50.0")).toBe("2.50.0");
    expect(shortVersion("2.1.286 (Claude Code)")).toBe("2.1.286");
    expect(shortVersion("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023")).toBe("6.1.1-3ubuntu5");
    expect(shortVersion("gh version 2.40.0 (2023-12-01)")).toBe("2.40.0");
    expect(shortVersion("v1.4.2")).toBe("1.4.2");
  });

  test("a line with no version number, such as whisper-cli's help, says only that the tool is there", () => {
    expect(shortVersion("usage: whisper-cli [options] file0 file1 ...")).toBe("installed");
  });
});

describe("readToolVersions", () => {
  const places = { environment: {}, platform: "linux", userHome: "/srv/person", standalone: false } as const;

  test("gives each tool's version, or null when the tool is missing", async () => {
    const runner: ProcessRunner = {
      run: (command) => {
        const answers: Record<string, string> = { git: "git version 2.50.0", claude: "2.1.286 (Claude Code)" };
        const answer = answers[command[0] ?? ""];
        return answer === undefined
          ? Promise.reject(new Error("not found"))
          : Promise.resolve({ exitCode: 0, stdout: `${answer}\n`, stderr: "" });
      },
    };
    const versions = await readToolVersions({ ...places, runner });
    expect(versions.map((tool) => tool.program)).toEqual(tools.map((tool) => tool.program));
    expect(versions.find((tool) => tool.program === "git")).toEqual({
      program: "git",
      feature: "the vault and clones",
      version: "2.50.0",
      installable: false,
      tooOld: false,
    });
    expect(versions.find((tool) => tool.program === "claude")?.version).toBe("2.1.286");
    expect(versions.find((tool) => tool.program === "pi")?.version).toBeNull();
  });

  // The Updates page offers a button only for a tool that Eva installs herself.
  test("says which tools Eva installs, and when gh is too old for her login", async () => {
    const runner: ProcessRunner = {
      run: (command) =>
        Promise.resolve({ exitCode: 0, stdout: command[0] === "gh" ? "gh version 2.4.0\n" : "1.0.0\n", stderr: "" }),
    };
    const versions = await readToolVersions({ ...places, runner });
    const installable = versions.filter((tool) => tool.installable).map((tool) => tool.program);
    expect(installable).toEqual(["claude", "pi", "gh", "uv"]);
    expect(versions.find((tool) => tool.program === "gh")).toMatchObject({ version: "2.4.0", tooOld: true });
    expect(versions.filter((tool) => tool.tooOld).map((tool) => tool.program)).toEqual(["gh"]);
  });

  test("asks the engine program that the settings name first, and skips bun in the single executable", async () => {
    const asked: string[] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        asked.push(command[0] ?? "");
        return Promise.resolve({ exitCode: 0, stdout: "1.0.0\n", stderr: "" });
      },
    };
    const versions = await readToolVersions({
      ...places,
      runner,
      standalone: true,
      executables: { "claude-code": "/opt/claude" },
    });
    expect(asked).toContain("/opt/claude");
    expect(asked).not.toContain("claude");
    expect(versions.some((tool) => tool.program === "bun")).toBe(false);
  });
});

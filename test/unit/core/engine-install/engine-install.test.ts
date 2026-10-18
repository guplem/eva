import { describe, expect, test } from "bun:test";
import {
  engineInstallSteps,
  engineProgramCandidates,
  findEngineProgram,
  installEngine,
  locateEngineProgram,
  type EngineInstallInputs,
} from "../../../../src/core/engine-install/engine-install.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

/** Each command answers by the first matching rule; an unknown program does not exist. */
function fakeRunner(
  commands: string[][],
  answer: (command: readonly string[]) => Partial<ProcessResult> | "missing",
): ProcessRunner {
  return {
    run: (command) => {
      commands.push([...command]);
      const result = answer(command);
      if (result === "missing") return Promise.reject(new EvaError("process_failed", `Could not start ${command[0]}.`));
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", ...result });
    },
  };
}

function inputs(runner: ProcessRunner, platform: NodeJS.Platform = "linux"): EngineInstallInputs {
  return { runner, environment: { PATH: "/usr/bin" }, platform, homeFolder: "/home/example" };
}

async function caught(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return null;
}

describe("engineProgramCandidates", () => {
  test("names the PATH first, then the folder that each installer uses", () => {
    expect(engineProgramCandidates("claude-code", "linux", "/home/example", {})).toEqual([
      "claude",
      "/home/example/.local/bin/claude",
    ]);
    expect(engineProgramCandidates("claude-code", "win32", "C:\\Users\\example", {})).toEqual([
      "claude",
      "C:\\Users\\example\\.local\\bin\\claude.exe",
    ]);
    expect(engineProgramCandidates("pi", "linux", "/home/example", {})).toEqual(["pi", "/home/example/.local/bin/pi"]);
    expect(engineProgramCandidates("pi", "win32", "C:\\Users\\example", { APPDATA: "D:\\Roaming" })).toEqual([
      "pi",
      "D:\\Roaming\\npm\\pi.cmd",
    ]);
    expect(engineProgramCandidates("pi", "win32", "C:\\Users\\example", {})).toEqual([
      "pi",
      "C:\\Users\\example\\AppData\\Roaming\\npm\\pi.cmd",
    ]);
  });
});

describe("findEngineProgram", () => {
  test("finds claude on the PATH first", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    expect(await findEngineProgram("claude-code", inputs(runner))).toBe("claude");
    expect(commands).toEqual([["claude", "--version"]]);
  });

  test("finds claude in the installer's folder when the PATH lacks it", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, (command) => (command[0] === "claude" ? "missing" : {}));
    expect(await findEngineProgram("claude-code", inputs(runner))).toBe("/home/example/.local/bin/claude");
  });

  test("a configured program comes first", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    expect(await findEngineProgram("claude-code", { ...inputs(runner), configured: "/opt/claude" })).toBe(
      "/opt/claude",
    );
  });

  test("a program that fails or does not exist is missing", async () => {
    const runner = fakeRunner([], (command) => (command[0] === "pi" ? { exitCode: 1 } : "missing"));
    expect(await findEngineProgram("claude-code", inputs(runner))).toBeNull();
    expect(await findEngineProgram("pi", inputs(runner))).toBeNull();
  });

  test("finds pi in npm's folder when the PATH lacks it; cmd runs a .cmd path on Windows", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, (command) => (command[3] === "pi" || command[0] === "pi" ? "missing" : {}));
    expect(await findEngineProgram("pi", inputs(runner))).toBe("/home/example/.local/bin/pi");
    const windows = { ...inputs(runner, "win32"), homeFolder: "C:\\Users\\example", environment: {} };
    expect(await findEngineProgram("pi", windows)).toBe("C:\\Users\\example\\AppData\\Roaming\\npm\\pi.cmd");
    expect(commands.at(-1)).toEqual([
      "cmd",
      "/d",
      "/c",
      "C:\\Users\\example\\AppData\\Roaming\\npm\\pi.cmd",
      "--version",
    ]);
  });

  test("on Windows, pi is a .cmd file, so cmd runs it", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    expect(await findEngineProgram("pi", inputs(runner, "win32"))).toBe("pi");
    expect(commands).toEqual([["cmd", "/d", "/c", "pi", "--version"]]);
  });
});

describe("installEngine", () => {
  test("Linux runs the official Claude Code installer, then finds the new program", async () => {
    const commands: string[][] = [];
    let installed = false;
    const runner = fakeRunner(commands, (command) => {
      if (command[0] === "bash") {
        installed = true;
        return {};
      }
      return installed && command[0] !== "claude" ? {} : "missing";
    });
    expect(await installEngine("claude-code", inputs(runner))).toBe("/home/example/.local/bin/claude");
    expect(commands[0]).toEqual(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  });

  test("Windows runs the PowerShell installer", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    expect(await installEngine("claude-code", inputs(runner, "win32"))).toBe("claude");
    expect(commands[0]).toEqual([
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm https://claude.ai/install.ps1 | iex",
    ]);
  });

  test("a failed installer gives its last line and the steps", async () => {
    const runner = fakeRunner([], (command) =>
      command[0] === "bash" ? { exitCode: 1, stderr: "curl: could not resolve host\n" } : "missing",
    );
    const error = await caught(installEngine("claude-code", inputs(runner)));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("curl: could not resolve host");
    expect(String(error)).toContain(engineInstallSteps("claude-code", "linux"));
  });

  test("an installer that cannot start gives the steps", async () => {
    const runner = fakeRunner([], () => "missing");
    const error = await caught(installEngine("claude-code", inputs(runner)));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("curl -fsSL https://claude.ai/install.sh | bash");
  });

  test("an install that leaves no program to find fails with the steps", async () => {
    const runner = fakeRunner([], (command) => (command[0] === "bash" ? {} : "missing"));
    const error = await caught(installEngine("claude-code", inputs(runner)));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("cannot find");
  });

  test("pi installs with npm into ~/.local, which needs no root", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    expect(await installEngine("pi", inputs(runner))).toBe("pi");
    expect(commands).toContainEqual([
      "npm",
      "install",
      "-g",
      "--prefix",
      "/home/example/.local",
      "@mariozechner/pi-coding-agent",
    ]);
  });

  test("on Windows, cmd runs npm, into its own folder", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => ({}));
    await installEngine("pi", inputs(runner, "win32"));
    expect(commands).toContainEqual(["cmd", "/d", "/c", "npm", "install", "-g", "@mariozechner/pi-coding-agent"]);
  });

  test("without npm, pi installs nothing and the steps name Node.js", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, () => "missing");
    const error = await caught(installEngine("pi", inputs(runner)));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("https://nodejs.org");
    expect(commands.some((command) => command.includes("install"))).toBe(false);
  });

  test("a failed npm install gives npm's last line and the steps", async () => {
    const runner = fakeRunner([], (command) =>
      command[1] === "install" ? { exitCode: 1, stderr: "npm error EACCES: permission denied\n" } : {},
    );
    const error = await caught(installEngine("pi", inputs(runner)));
    expect(String(error)).toContain("EACCES");
    expect(String(error)).toContain("npm install -g --prefix ~/.local @mariozechner/pi-coding-agent");
  });
});

describe("engineInstallSteps", () => {
  test("says the command for each platform", () => {
    expect(engineInstallSteps("claude-code", "linux")).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(engineInstallSteps("claude-code", "win32")).toContain("irm https://claude.ai/install.ps1 | iex");
    expect(engineInstallSteps("pi", "linux")).toContain(
      "npm install -g --prefix ~/.local @mariozechner/pi-coding-agent",
    );
    expect(engineInstallSteps("pi", "win32")).toContain("npm install -g @mariozechner/pi-coding-agent");
  });
});

describe("locateEngineProgram", () => {
  const places = { platform: "linux", homeFolder: "/home/example", environment: {} } as const;

  test("finds the name on the PATH first, then the installer's folder", () => {
    expect(locateEngineProgram("claude-code", { ...places, which: () => "/usr/bin/claude", exists: () => true })).toBe(
      "/usr/bin/claude",
    );
    const onlyInstalled = { ...places, which: () => null, exists: (path: string) => path.endsWith("/.local/bin/pi") };
    expect(locateEngineProgram("pi", onlyInstalled)).toBe("/home/example/.local/bin/pi");
    expect(locateEngineProgram("claude-code", { ...places, which: () => null, exists: () => false })).toBeNull();
  });
});

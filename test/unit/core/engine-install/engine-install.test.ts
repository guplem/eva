import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  engineInstallSteps,
  engineProgramCandidates,
  findEngineProgram,
  installEngine,
  locateEngineProgram,
  piInstallFolder,
  type EngineInstallInputs,
} from "../../../../src/core/engine-install/engine-install.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

const posixHome = "/srv/example";
const windowsHome = "D:\\Homes\\example";

/** Each command answers by `answer`; "missing" means the program does not exist. */
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
  return {
    runner,
    environment: { PATH: "/usr/bin" },
    platform,
    arch: "x64",
    homeFolder: platform === "win32" ? windowsHome : posixHome,
  };
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
  test("names the PATH first, then the folder of each installer", () => {
    expect(engineProgramCandidates("claude-code", "linux", posixHome, {})).toEqual([
      "claude",
      "/srv/example/.local/bin/claude",
    ]);
    expect(engineProgramCandidates("claude-code", "win32", windowsHome, {})).toEqual([
      "claude",
      "D:\\Homes\\example\\.local\\bin\\claude.exe",
    ]);
    expect(engineProgramCandidates("pi", "linux", posixHome, {})).toEqual([
      "pi",
      "/srv/example/.local/lib/pi/pi",
      "/srv/example/.pi/agent/bin/pi",
    ]);
    expect(engineProgramCandidates("pi", "win32", windowsHome, { LOCALAPPDATA: "E:\\Local" })).toEqual([
      "pi",
      "E:\\Local\\Programs\\pi\\pi.exe",
      "D:\\Homes\\example\\.pi\\agent\\bin\\pi.cmd",
    ]);
    expect(piInstallFolder("win32", windowsHome, {})).toBe("D:\\Homes\\example\\AppData\\Local\\Programs\\pi");
  });
});

describe("findEngineProgram", () => {
  test("finds claude on the PATH first", async () => {
    const commands: string[][] = [];
    expect(await findEngineProgram("claude-code", inputs(fakeRunner(commands, () => ({}))))).toBe("claude");
    expect(commands).toEqual([["claude", "--version"]]);
  });

  test("finds claude in the installer's folder when the PATH lacks it", async () => {
    const runner = fakeRunner([], (command) => (command[0] === "claude" ? "missing" : {}));
    expect(await findEngineProgram("claude-code", inputs(runner))).toBe("/srv/example/.local/bin/claude");
  });

  test("a configured program comes first", async () => {
    const runner = fakeRunner([], () => ({}));
    expect(await findEngineProgram("claude-code", { ...inputs(runner), configured: "/opt/claude" })).toBe(
      "/opt/claude",
    );
  });

  test("a program that fails or does not exist is missing", async () => {
    const runner = fakeRunner([], (command) => (command[0] === "pi" ? { exitCode: 1 } : "missing"));
    expect(await findEngineProgram("claude-code", inputs(runner))).toBeNull();
    expect(await findEngineProgram("pi", inputs(runner))).toBeNull();
  });

  test("on Windows, cmd runs a .cmd program, and an .exe runs by itself", async () => {
    const commands: string[][] = [];
    const runner = fakeRunner(commands, (command) =>
      command.some((part) => part.endsWith("pi.cmd")) ? {} : "missing",
    );
    expect(await findEngineProgram("pi", { ...inputs(runner, "win32"), environment: {} })).toBe(
      "D:\\Homes\\example\\.pi\\agent\\bin\\pi.cmd",
    );
    expect(commands).toEqual([
      ["cmd", "/d", "/c", "pi", "--version"],
      ["D:\\Homes\\example\\AppData\\Local\\Programs\\pi\\pi.exe", "--version"],
      ["cmd", "/d", "/c", "D:\\Homes\\example\\.pi\\agent\\bin\\pi.cmd", "--version"],
    ]);
  });
});

describe("locateEngineProgram", () => {
  const places = { platform: "linux", homeFolder: posixHome, environment: {} } as const;

  test("finds the name on the PATH first, then an installer's folder", () => {
    expect(locateEngineProgram("claude-code", { ...places, which: () => "/usr/bin/claude", exists: () => true })).toBe(
      "/usr/bin/claude",
    );
    const onlyInstalled = { ...places, which: () => null, exists: (path: string) => path.endsWith("/lib/pi/pi") };
    expect(locateEngineProgram("pi", onlyInstalled)).toBe("/srv/example/.local/lib/pi/pi");
    expect(locateEngineProgram("claude-code", { ...places, which: () => null, exists: () => false })).toBeNull();
  });
});

describe("installEngine for Claude Code", () => {
  test("Linux runs the official installer, then finds the new program", async () => {
    const commands: string[][] = [];
    let installed = false;
    const runner = fakeRunner(commands, (command) => {
      if (command[0] === "bash") {
        installed = true;
        return {};
      }
      return installed && command[0] !== "claude" ? {} : "missing";
    });
    expect(await installEngine("claude-code", inputs(runner))).toBe("/srv/example/.local/bin/claude");
    expect(commands[0]).toEqual(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  });

  test("Windows runs the PowerShell installer", async () => {
    const commands: string[][] = [];
    expect(
      await installEngine(
        "claude-code",
        inputs(
          fakeRunner(commands, () => ({})),
          "win32",
        ),
      ),
    ).toBe("claude");
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
    const error = await caught(installEngine("claude-code", inputs(fakeRunner([], () => "missing"))));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("bash could not run");
  });

  test("an install that leaves no program to find fails with the steps", async () => {
    const runner = fakeRunner([], (command) => (command[0] === "bash" ? {} : "missing"));
    const error = await caught(installEngine("claude-code", inputs(runner)));
    expect(String(error)).toContain("cannot find the program");
  });
});

describe("installEngine for pi", () => {
  const archive = new TextEncoder().encode("a pretend pi archive");
  const archiveHash = createHash("sha256").update(archive).digest("hex");
  let home: string;
  let server: ReturnType<typeof Bun.serve> | null;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "eva-engine-install-"));
    server = null;
  });
  afterEach(() => {
    void server?.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  function serveRelease(hash = archiveHash): string {
    // One server at a time: a test that serves again stops the first one.
    void server?.stop(true);
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/SHA256SUMS")
          return new Response(`${hash}  pi-linux-x64.tar.gz\n${archiveHash}  pi-windows-x64.zip\n`);
        if (path === "/pi-linux-x64.tar.gz" || path === "/pi-windows-x64.zip") return new Response(archive);
        return new Response("not found", { status: 404 });
      },
    });
    return `http://127.0.0.1:${String(server.port)}`;
  }

  /** `tar` writes the program into its target folder; pi answers once it exists. */
  function piRunner(commands: string[][], program = "pi"): ProcessRunner {
    return fakeRunner(commands, (command) => {
      if (/tar(\.exe)?$/.test(command[0] ?? "")) {
        writeFileSync(join(command[command.indexOf("-C") + 1] ?? "", program), "pretend program");
        return {};
      }
      return existsSync(command[0] ?? "") ? {} : "missing";
    });
  }

  function piInputs(runner: ProcessRunner, platform: NodeJS.Platform = "linux"): EngineInstallInputs {
    return { ...inputs(runner, platform), homeFolder: home, environment: {}, piReleasesBaseUrl: serveRelease() };
  }

  test("downloads the standalone build, checks it, and puts it in ~/.local/lib/pi with a link", async () => {
    const commands: string[][] = [];
    const program = await installEngine("pi", piInputs(piRunner(commands)));
    expect(program).toBe(`${home}/.local/lib/pi/pi`);
    expect(readFileSync(program, "utf8")).toBe("pretend program");
    expect(commands[0]?.slice(0, 2)).toEqual(["tar", "-xzf"]);
    expect(commands[0]).toContain("--strip-components=1");
    // Windows lets only an administrator make a link, and Eva needs none there.
    if (process.platform !== "win32") expect(lstatSync(join(home, ".local", "bin", "pi")).isSymbolicLink()).toBe(true);
    // The staging folder is gone.
    expect(readdirSync(join(home, ".local", "lib"))).toEqual(["pi"]);
  });

  // Windows paths name real folders only on Windows, so the Windows CI job runs this test.
  test.if(process.platform === "win32")(
    "on Windows, it reads the zip with tar and keeps pi.exe in its own folder",
    async () => {
      const commands: string[][] = [];
      const settings = { ...piInputs(piRunner(commands, "pi.exe"), "win32"), environment: { LOCALAPPDATA: home } };
      const program = await installEngine("pi", settings);
      expect(program.endsWith("pi.exe")).toBe(true);
      expect(commands[0]?.slice(0, 2)).toEqual(["C:\\Windows\\System32\\tar.exe", "-xf"]);
      expect(commands[0]).not.toContain("--strip-components=1");
    },
  );

  test("a new install replaces an old folder and a link whose target is gone", async () => {
    mkdirSync(join(home, ".local", "lib", "pi"), { recursive: true });
    writeFileSync(join(home, ".local", "lib", "pi", "old-file"), "old");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const link = join(home, ".local", "bin", "pi");
    if (process.platform !== "win32") symlinkSync(join(home, "gone"), link);
    await installEngine("pi", piInputs(piRunner([])));
    expect(existsSync(join(home, ".local", "lib", "pi", "old-file"))).toBe(false);
    expect(existsSync(join(home, ".local", "lib", "pi", "pi"))).toBe(true);
    if (process.platform !== "win32") expect(readFileSync(link, "utf8")).toBe("pretend program");
  });

  test("a download that does not match its checksum installs nothing", async () => {
    const settings = { ...piInputs(piRunner([])), piReleasesBaseUrl: serveRelease("0".repeat(64)) };
    const error = await caught(installEngine("pi", settings));
    expect(isEvaError(error, "engine_install_failed")).toBe(true);
    expect(String(error)).toContain("checksum");
    expect(String(error)).toContain("curl -fsSL https://pi.dev/install.sh | sh");
    expect(existsSync(join(home, ".local", "lib", "pi"))).toBe(false);
  });

  test("an archive without the program installs nothing", async () => {
    const error = await caught(installEngine("pi", piInputs(piRunner([], "README.md"))));
    expect(String(error)).toContain("holds no pi");
    expect(existsSync(join(home, ".local", "lib", "pi"))).toBe(false);
  });

  test("a system with no standalone build, or a failed download, gives the steps", async () => {
    const unknown = await caught(installEngine("pi", { ...piInputs(piRunner([])), arch: "ia32" }));
    expect(String(unknown)).toContain("no standalone build for linux on ia32");
    const offline = await caught(
      installEngine("pi", { ...piInputs(piRunner([])), piReleasesBaseUrl: `${serveRelease()}/missing` }),
    );
    expect(String(offline)).toContain("The download failed (404)");
    expect(String(offline)).toContain("https://pi.dev");
  });
});

describe("engineInstallSteps", () => {
  test("says the official command for each system", () => {
    expect(engineInstallSteps("claude-code", "linux")).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(engineInstallSteps("claude-code", "win32")).toContain("irm https://claude.ai/install.ps1 | iex");
    expect(engineInstallSteps("pi", "linux")).toContain("curl -fsSL https://pi.dev/install.sh | sh");
    expect(engineInstallSteps("pi", "win32")).toContain("irm https://pi.dev/install.ps1 | iex");
  });
});

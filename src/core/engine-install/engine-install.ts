/**
 * Finds and installs the program of an engine, for `eva setup`. Claude Code uses its official
 * installer, which needs no administrator. pi installs with npm. When Eva cannot install, the
 * error gives the exact steps instead.
 */
import { posix, win32 } from "node:path";
import type { EngineName } from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface EngineInstallInputs {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
  readonly homeFolder: string;
  /** The program that the settings name, which comes before every other place. */
  readonly configured?: string | null;
}

/** The name that a person knows each engine's program by. */
export const engineProgramNames: Readonly<Record<EngineName, string>> = { "claude-code": "Claude Code", pi: "pi" };

/** An installer downloads a large program over a slow line. */
const installTimeoutMs = 10 * 60_000;
const versionTimeoutMs = 15_000;
const piPackage = "@mariozechner/pi-coding-agent";
const claudeInstallers = {
  posix: "curl -fsSL https://claude.ai/install.sh | bash",
  win32: "irm https://claude.ai/install.ps1 | iex",
} as const;

/**
 * Where to look for the engine's program: the name on the PATH, then the folder that its
 * installer uses. A fresh install is often not on the PATH of a running terminal or service.
 */
export function engineProgramCandidates(
  engine: EngineName,
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  if (platform === "win32") {
    if (engine === "claude-code") return ["claude", win32.join(homeFolder, ".local", "bin", "claude.exe")];
    const appData = environment["APPDATA"] ?? win32.join(homeFolder, "AppData", "Roaming");
    return ["pi", win32.join(appData, "npm", "pi.cmd")];
  }
  const program = engine === "claude-code" ? "claude" : "pi";
  return [program, posix.join(homeFolder, ".local", "bin", program)];
}

/** The program that answers `--version`, or null. */
export async function findEngineProgram(engine: EngineName, inputs: EngineInstallInputs): Promise<string | null> {
  const candidates = engineProgramCandidates(engine, inputs.platform, inputs.homeFolder, inputs.environment);
  if (inputs.configured !== undefined && inputs.configured !== null) candidates.unshift(inputs.configured);
  for (const program of candidates) {
    if (await answers([program, "--version"], inputs, versionTimeoutMs)) return program;
  }
  return null;
}

/** Installs the engine's program and returns it. Throws EvaError `engine_install_failed` with the steps. */
export async function installEngine(engine: EngineName, inputs: EngineInstallInputs): Promise<string> {
  const steps = engineInstallSteps(engine, inputs.platform);
  if (engine === "pi" && !(await answers(["npm", "--version"], inputs, versionTimeoutMs)))
    throw failure(`pi needs npm, and Eva cannot find it. ${steps}`);
  const command =
    engine === "pi"
      ? // A system Node needs root for its own global folder; ~/.local needs none.
        inputs.platform === "win32"
        ? ["npm", "install", "-g", piPackage]
        : ["npm", "install", "-g", "--prefix", posix.join(inputs.homeFolder, ".local"), piPackage]
      : inputs.platform === "win32"
        ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", claudeInstallers.win32]
        : ["bash", "-c", claudeInstallers.posix];
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await run(command, inputs, installTimeoutMs);
  } catch (error) {
    throw failure(`${command[0] ?? "The installer"} could not run (${messageOf(error)}). ${steps}`);
  }
  const name = engineProgramNames[engine];
  if (result.exitCode !== 0) throw failure(`Eva could not install ${name}: ${lastLine(result)}. ${steps}`);
  const program = await findEngineProgram(engine, inputs);
  if (program === null) throw failure(`The ${name} installer finished, but Eva cannot find the program. ${steps}`);
  return program;
}

/** What a person runs to install the engine by hand. */
export function engineInstallSteps(engine: EngineName, platform: NodeJS.Platform): string {
  if (engine === "pi") {
    const npm = platform === "win32" ? `npm install -g ${piPackage}` : `npm install -g --prefix ~/.local ${piPackage}`;
    return `Install Node.js from https://nodejs.org, then run \`${npm}\`. See https://pi.dev.`;
  }
  return platform === "win32"
    ? `In PowerShell, run \`${claudeInstallers.win32}\`. See https://code.claude.com.`
    : `Run \`${claudeInstallers.posix}\`. See https://code.claude.com.`;
}

async function answers(command: readonly string[], inputs: EngineInstallInputs, timeoutMs: number): Promise<boolean> {
  try {
    return (await run(command, inputs, timeoutMs)).exitCode === 0;
  } catch {
    return false;
  }
}

function run(
  command: readonly string[],
  inputs: EngineInstallInputs,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return inputs.runner.run(runnableCommand(command, inputs.platform), {
    cwd: inputs.homeFolder,
    environment: inputs.environment,
    timeoutMs,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lastLine(result: { stdout: string; stderr: string }): string {
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "no output";
}

function failure(message: string): EvaError {
  return new EvaError("engine_install_failed", message);
}

/** The command as a spawn can start it: npm and pi are .cmd files on Windows, which only cmd runs. */
export function runnableCommand(command: readonly string[], platform: NodeJS.Platform): readonly string[] {
  const program = command[0] ?? "";
  const isCmd = program === "npm" || program === "pi" || program.toLowerCase().endsWith(".cmd");
  return platform === "win32" && isCmd ? ["cmd", "/d", "/c", ...command] : command;
}

export interface EngineProgramPlaces {
  readonly platform: NodeJS.Platform;
  readonly homeFolder: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly which: (name: string) => string | null;
  readonly exists: (path: string) => boolean;
}

/** The engine's program, found without a run: a name on the PATH, or a file in the installer's folder. */
export function locateEngineProgram(engine: EngineName, places: EngineProgramPlaces): string | null {
  for (const candidate of engineProgramCandidates(engine, places.platform, places.homeFolder, places.environment)) {
    // A bare name lives on the PATH; a path names one file. The test reads both kinds of separator.
    const found = /[\\/]/.test(candidate) ? (places.exists(candidate) ? candidate : null) : places.which(candidate);
    if (found !== null) return found;
  }
  return null;
}

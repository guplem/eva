/**
 * Finds and installs the program of an engine, for `eva setup`. Neither install needs an
 * administrator. Claude Code uses its official installer. pi uses the standalone build of its
 * GitHub release, which needs no Node.js or npm: the Eva executable has neither. When Eva cannot
 * install, the error gives the exact steps instead.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { EngineName } from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface EngineInstallInputs {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly homeFolder: string;
  /** The program that the settings name, which comes before every other place. */
  readonly configured?: string | null;
  /** The pi release downloads; a test points it at a fake server. */
  readonly piReleasesBaseUrl?: string;
}

/** The name that a person knows each engine's program by. */
export const engineProgramNames: Readonly<Record<EngineName, string>> = { "claude-code": "Claude Code", pi: "pi" };

/** An installer downloads a large program over a slow line. */
const installTimeoutMs = 10 * 60_000;
const versionTimeoutMs = 15_000;
const commandTimeoutMs = 60_000;
const defaultPiReleasesBaseUrl = "https://github.com/earendil-works/pi/releases/latest/download";
const installers = {
  "claude-code": {
    posix: "curl -fsSL https://claude.ai/install.sh | bash",
    win32: "irm https://claude.ai/install.ps1 | iex",
  },
  pi: { posix: "curl -fsSL https://pi.dev/install.sh | sh", win32: "irm https://pi.dev/install.ps1 | iex" },
} as const;
const pages: Readonly<Record<EngineName, string>> = { "claude-code": "https://code.claude.com", pi: "https://pi.dev" };
/** The release names each system and processor in its own words. */
const piSystems: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};
const piProcessors: Readonly<Record<string, string>> = { x64: "x64", arm64: "arm64" };

/** The folder of Eva's own pi install. */
export function piInstallFolder(
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return posix.join(homeFolder, ".local", "lib", "pi");
  return win32.join(environment["LOCALAPPDATA"] ?? win32.join(homeFolder, "AppData", "Local"), "Programs", "pi");
}

/**
 * Where to look for the engine's program: the name on the PATH, then the folder of each
 * installer. A fresh install is often not on the PATH of a running terminal or service.
 */
export function engineProgramCandidates(
  engine: EngineName,
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  const path = platform === "win32" ? win32 : posix;
  if (engine === "claude-code")
    return ["claude", path.join(homeFolder, ".local", "bin", platform === "win32" ? "claude.exe" : "claude")];
  return [
    "pi",
    path.join(piInstallFolder(platform, homeFolder, environment), platform === "win32" ? "pi.exe" : "pi"),
    // The launcher of the pi.dev installer.
    path.join(homeFolder, ".pi", "agent", "bin", platform === "win32" ? "pi.cmd" : "pi"),
  ];
}

/** The program that answers `--version`, or null. */
export async function findEngineProgram(engine: EngineName, inputs: EngineInstallInputs): Promise<string | null> {
  const candidates = engineProgramCandidates(engine, inputs.platform, inputs.homeFolder, inputs.environment);
  if (inputs.configured !== undefined && inputs.configured !== null) candidates.unshift(inputs.configured);
  for (const program of candidates) {
    if (await answers([program, "--version"], inputs)) return program;
  }
  return null;
}

export interface EngineProgramPlaces {
  readonly platform: NodeJS.Platform;
  readonly homeFolder: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly which: (name: string) => string | null;
  readonly exists: (path: string) => boolean;
}

/** The engine's program, found without a run: a name on the PATH, or a file in an installer's folder. */
export function locateEngineProgram(engine: EngineName, places: EngineProgramPlaces): string | null {
  for (const candidate of engineProgramCandidates(engine, places.platform, places.homeFolder, places.environment)) {
    // A bare name lives on the PATH; a path names one file. The test reads both kinds of separator.
    const found = /[\\/]/.test(candidate) ? (places.exists(candidate) ? candidate : null) : places.which(candidate);
    if (found !== null) return found;
  }
  return null;
}

/** Installs the engine's program and returns it. Throws EvaError `engine_install_failed` with the steps. */
export async function installEngine(engine: EngineName, inputs: EngineInstallInputs): Promise<string> {
  const steps = engineInstallSteps(engine, inputs.platform);
  const name = engineProgramNames[engine];
  try {
    if (engine === "pi") await installPi(inputs);
    else await installClaudeCode(inputs);
  } catch (error) {
    throw new EvaError("engine_install_failed", `Eva could not install ${name}: ${messageOf(error)} ${steps}`, {
      cause: error,
    });
  }
  const program = await findEngineProgram(engine, inputs);
  if (program === null) throw failure(`The ${name} install finished, but Eva cannot find the program. ${steps}`);
  return program;
}

/** What a person runs to install the engine by hand. */
export function engineInstallSteps(engine: EngineName, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `In PowerShell, run \`${installers[engine].win32}\`. See ${pages[engine]}.`
    : `Run \`${installers[engine].posix}\`. See ${pages[engine]}.`;
}

/** The command as a spawn can start it: a .cmd file on Windows runs only through cmd. */
export function runnableCommand(command: readonly string[], platform: NodeJS.Platform): readonly string[] {
  const program = command[0] ?? "";
  const isCmd = program === "pi" || program.toLowerCase().endsWith(".cmd");
  return platform === "win32" && isCmd ? ["cmd", "/d", "/c", ...command] : command;
}

async function installClaudeCode(inputs: EngineInstallInputs): Promise<void> {
  const command =
    inputs.platform === "win32"
      ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", installers["claude-code"].win32]
      : ["bash", "-c", installers["claude-code"].posix];
  await run(command, inputs, installTimeoutMs);
}

async function installPi(inputs: EngineInstallInputs): Promise<void> {
  const system = piSystems[inputs.platform];
  const processor = piProcessors[inputs.arch];
  if (system === undefined || processor === undefined)
    throw new Error(`pi has no standalone build for ${inputs.platform} on ${inputs.arch}.`);
  const archive = `pi-${system}-${processor}.${inputs.platform === "win32" ? "zip" : "tar.gz"}`;
  const base = inputs.piReleasesBaseUrl ?? defaultPiReleasesBaseUrl;
  const sums = await (await download(`${base}/SHA256SUMS`)).text();
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === archive)?.[0];
  if (expected === undefined) throw new Error(`The pi release lists no ${archive}.`);
  const bytes = new Uint8Array(await (await download(`${base}/${archive}`)).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase())
    throw new Error("The pi download does not match its checksum, so Eva installed nothing.");

  const path = inputs.platform === "win32" ? win32 : posix;
  const folder = piInstallFolder(inputs.platform, inputs.homeFolder, inputs.environment);
  mkdirSync(path.dirname(folder), { recursive: true });
  // Its own staging folder: two installs at once never share a file.
  const staging = mkdtempSync(path.join(path.dirname(folder), "pi-download-"));
  try {
    const archivePath = path.join(staging, archive);
    const extracted = path.join(staging, "pi");
    writeFileSync(archivePath, bytes);
    mkdirSync(extracted);
    // The Windows zip holds the files at its top; the tarball holds them in a `pi/` folder.
    // Windows 10 and later bring a `tar` that reads a zip too.
    await run(
      inputs.platform === "win32"
        ? ["tar", "-xf", archivePath, "-C", extracted]
        : ["tar", "-xzf", archivePath, "--strip-components=1", "-C", extracted],
      inputs,
      commandTimeoutMs,
    );
    const program = path.join(extracted, inputs.platform === "win32" ? "pi.exe" : "pi");
    if (!existsSync(program)) throw new Error(`The pi archive holds no ${path.basename(program)}.`);
    rmSync(folder, { recursive: true, force: true });
    renameSync(extracted, folder);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  if (inputs.platform !== "win32") linkForTerminal(posix.join(folder, "pi"), inputs.homeFolder);
}

/** A link in ~/.local/bin lets the person's own terminal find pi. The build finds its files through the link. */
function linkForTerminal(program: string, homeFolder: string): void {
  const link = posix.join(homeFolder, ".local", "bin", "pi");
  if (existsSync(link)) return;
  try {
    mkdirSync(posix.dirname(link), { recursive: true });
    symlinkSync(program, link);
  } catch {
    // Eva finds pi in its own folder, so a missing link costs only the person's shortcut.
  }
}

async function download(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(installTimeoutMs) });
  } catch (error) {
    throw new Error(`The download failed (${messageOf(error)}).`, { cause: error });
  }
  if (!response.ok) throw new Error(`The download failed (${String(response.status)}).`);
  return response;
}

async function answers(command: readonly string[], inputs: EngineInstallInputs): Promise<boolean> {
  try {
    const result = await inputs.runner.run(runnableCommand(command, inputs.platform), {
      cwd: inputs.homeFolder,
      environment: inputs.environment,
      timeoutMs: versionTimeoutMs,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function run(command: readonly string[], inputs: EngineInstallInputs, timeoutMs: number): Promise<void> {
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await inputs.runner.run(command, { cwd: inputs.homeFolder, environment: inputs.environment, timeoutMs });
  } catch (error) {
    throw new Error(`${command[0] ?? "A command"} could not run (${messageOf(error)}).`, { cause: error });
  }
  if (result.exitCode !== 0) throw new Error(`${command[0] ?? "A command"} failed: ${lastLine(result)}.`);
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

/**
 * Finds and installs the program of an engine, uv for the Google tools, and gh for the agents'
 * pushes. No install needs an administrator. Claude Code and uv use their official installers.
 * pi and gh use the build of their GitHub release, checked against its checksums. The Eva
 * executable holds none of them. When Eva cannot install, the error gives the exact steps instead.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  /** GitHub's API answer for the latest gh release; a test points it at a fake server. */
  readonly ghReleaseUrl?: string;
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
  if (platform === "win32") return ["pi", win32.join(piInstallFolder(platform, homeFolder, environment), "pi.exe")];
  // The pi.dev launcher counts outside Windows only. On Windows it is a .cmd file, which runs only
  // through cmd, and cmd breaks a command line that holds more than one quoted path with a space.
  return [
    "pi",
    posix.join(piInstallFolder(platform, homeFolder, environment), "pi"),
    posix.join(homeFolder, ".pi", "agent", "bin", "pi"),
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

const uvInstaller = {
  posix: "curl -LsSf https://astral.sh/uv/install.sh | sh",
  win32: "irm https://astral.sh/uv/install.ps1 | iex",
} as const;

/** uv on the PATH, then in the folder of its installer, which a running terminal may not have on its PATH yet. */
export async function findUv(inputs: EngineInstallInputs): Promise<string | null> {
  const path = inputs.platform === "win32" ? win32 : posix;
  const candidates = [
    "uv",
    path.join(inputs.homeFolder, ".local", "bin", inputs.platform === "win32" ? "uv.exe" : "uv"),
  ];
  for (const program of candidates) {
    if (await answers([program, "--version"], inputs)) return program;
  }
  return null;
}

/** Installs uv with its official installer and returns it. Throws EvaError `engine_install_failed` with the steps. */
export async function installUv(inputs: EngineInstallInputs): Promise<string> {
  const steps = uvInstallSteps(inputs.platform);
  const command =
    inputs.platform === "win32"
      ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", uvInstaller.win32]
      : ["sh", "-c", uvInstaller.posix];
  try {
    await run(command, inputs, installTimeoutMs);
  } catch (error) {
    throw new EvaError("engine_install_failed", `Eva could not install uv: ${messageOf(error)} ${steps}`, {
      cause: error,
    });
  }
  const program = await findUv(inputs);
  if (program === null) throw failure(`The uv install finished, but Eva cannot find the program. ${steps}`);
  return program;
}

/** What a person runs to install uv by hand. */
export function uvInstallSteps(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `In PowerShell, run \`${uvInstaller.win32}\`. See https://docs.astral.sh/uv/.`
    : `Run \`${uvInstaller.posix}\`. See https://docs.astral.sh/uv/.`;
}

/** What a person runs to install the engine by hand. */
export function engineInstallSteps(engine: EngineName, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `In PowerShell, run \`${installers[engine].win32}\`. See ${pages[engine]}.`
    : `Run \`${installers[engine].posix}\`. See ${pages[engine]}.`;
}

/** The first gh with `auth login --insecure-storage`, which Eva's GitHub login uses (#244). */
export const minimumGhVersion = "2.40";
const defaultGhReleaseUrl = "https://api.github.com/repos/cli/cli/releases/latest";
/** The release names each system and processor in its own words. */
const ghSystems: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: "linux",
  darwin: "macOS",
  win32: "windows",
};
const ghProcessors: Readonly<Record<string, string>> = { x64: "amd64", arm64: "arm64" };

/** The folder of Eva's own gh install. Its program is in `bin/`. */
export function ghInstallFolder(
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return posix.join(homeFolder, ".local", "lib", "gh");
  return win32.join(environment["LOCALAPPDATA"] ?? win32.join(homeFolder, "AppData", "Local"), "Programs", "gh");
}

/** The folder that holds Eva's own gh program. */
export function ghProgramFolder(
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return (platform === "win32" ? win32 : posix).join(ghInstallFolder(platform, homeFolder, environment), "bin");
}

/**
 * The PATH with Eva's own gh folder first, so Eva and her agents find the gh that she installs.
 * A service keeps the PATH of its install, which may lack that folder; on Windows it always does.
 * The folder may not exist yet: setup or the page can install gh while Eva runs.
 */
export function pathWithOwnGh(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  homeFolder: string,
): string {
  const separator = platform === "win32" ? ";" : ":";
  const path = environment["PATH"] ?? environment["Path"] ?? "";
  const folder = ghProgramFolder(platform, homeFolder, environment);
  // A new copy after an update gets this PATH already.
  if (path.split(separator).includes(folder)) return path;
  return path === "" ? folder : `${folder}${separator}${path}`;
}

/** False when the version has no number: Eva cannot tell, so she does not blame gh. */
export function ghTooOld(version: string): boolean {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  for (const [index, wanted] of minimumGhVersion.split(".").map(Number).entries()) {
    const part = parts[index] ?? 0;
    if (part !== wanted) return part < wanted;
  }
  return false;
}

export interface FoundGh {
  readonly program: string;
  readonly version: string;
}

/**
 * gh on the PATH, then Eva's own. A gh new enough wins: an old one from a package manager
 * must not hide the one that Eva installed. With only old ones, the first one answers.
 */
export async function findGh(inputs: EngineInstallInputs): Promise<FoundGh | null> {
  const own = (inputs.platform === "win32" ? win32 : posix).join(
    ghProgramFolder(inputs.platform, inputs.homeFolder, inputs.environment),
    inputs.platform === "win32" ? "gh.exe" : "gh",
  );
  let oldest: FoundGh | null = null;
  for (const program of ["gh", own]) {
    const line = await firstLine([program, "--version"], inputs);
    if (line === null) continue;
    const version = /\d+(?:\.\d+)+/.exec(line)?.[0] ?? "installed";
    if (!ghTooOld(version)) return { program, version };
    oldest ??= { program, version };
  }
  return oldest;
}

/** What a person does to install gh by hand. */
export function ghInstallSteps(): string {
  return `Install gh ${minimumGhVersion} or newer from https://cli.github.com.`;
}

/** Installs the latest gh release and returns it. Throws EvaError `engine_install_failed` with the steps. */
export async function installGh(inputs: EngineInstallInputs): Promise<string> {
  try {
    await installGhRelease(inputs);
  } catch (error) {
    throw new EvaError("engine_install_failed", `Eva could not install gh: ${messageOf(error)} ${ghInstallSteps()}`, {
      cause: error,
    });
  }
  const found = await findGh(inputs);
  if (found === null || ghTooOld(found.version))
    throw failure(
      `The gh install finished, but Eva cannot find a gh ${minimumGhVersion} or newer. ${ghInstallSteps()}`,
    );
  return found.program;
}

async function installGhRelease(inputs: EngineInstallInputs): Promise<void> {
  const system = ghSystems[inputs.platform];
  const processor = ghProcessors[inputs.arch];
  if (system === undefined || processor === undefined)
    throw new Error(`gh has no build for ${inputs.platform} on ${inputs.arch}.`);
  const release = (await (await download(inputs.ghReleaseUrl ?? defaultGhReleaseUrl)).json()) as {
    tag_name?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown }[];
  };
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
  const archive = `gh_${version}_${system}_${processor}.${inputs.platform === "linux" ? "tar.gz" : "zip"}`;
  const link = (name: string): string => {
    const url = release.assets?.find((asset) => asset.name === name)?.browser_download_url;
    if (typeof url !== "string") throw new Error(`The gh release lists no ${name}.`);
    return url;
  };
  const sums = await (await download(link(`gh_${version}_checksums.txt`))).text();
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === archive)?.[0];
  if (expected === undefined) throw new Error(`The gh release lists no checksum for ${archive}.`);
  const bytes = new Uint8Array(await (await download(link(archive))).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase())
    throw new Error("The gh download does not match its checksum, so Eva installed nothing.");

  const path = inputs.platform === "win32" ? win32 : posix;
  const folder = ghInstallFolder(inputs.platform, inputs.homeFolder, inputs.environment);
  const programName = inputs.platform === "win32" ? "gh.exe" : "gh";
  mkdirSync(path.dirname(folder), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(folder), "gh-download-"));
  try {
    const archivePath = path.join(staging, archive);
    const extracted = path.join(staging, "gh");
    writeFileSync(archivePath, bytes);
    mkdirSync(extracted);
    await run(
      inputs.platform === "win32"
        ? [windowsTar(inputs.environment), "-xf", archivePath, "-C", extracted]
        : // The tar of macOS reads a zip too.
          ["tar", inputs.platform === "linux" ? "-xzf" : "-xf", archivePath, "-C", extracted],
      inputs,
      commandTimeoutMs,
    );
    // The Windows zip holds bin/ at its top; the others hold it in a folder named after the archive.
    const top = [extracted, ...readdirSync(extracted).map((name) => path.join(extracted, name))].find((candidate) =>
      existsSync(path.join(candidate, "bin", programName)),
    );
    if (top === undefined) throw new Error(`The gh archive holds no ${programName}.`);
    replaceFolder(folder, top, path.join(staging, "old"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  if (inputs.platform !== "win32") linkForTerminal(posix.join(folder, "bin", "gh"), inputs.homeFolder, "gh");
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
    // Windows 10 and later bring a `tar` that reads a zip too. Git's GNU tar reads neither a zip nor a `C:` path.
    await run(
      inputs.platform === "win32"
        ? [windowsTar(inputs.environment), "-xf", archivePath, "-C", extracted]
        : ["tar", "-xzf", archivePath, "--strip-components=1", "-C", extracted],
      inputs,
      commandTimeoutMs,
    );
    const program = path.join(extracted, inputs.platform === "win32" ? "pi.exe" : "pi");
    if (!existsSync(program)) throw new Error(`The pi archive holds no ${path.basename(program)}.`);
    replaceFolder(folder, extracted, path.join(staging, "old"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  if (inputs.platform !== "win32") linkForTerminal(posix.join(folder, "pi"), inputs.homeFolder, "pi");
}

/** A link in ~/.local/bin lets the person's own terminal find the program. The build finds its files through the link. */
function linkForTerminal(program: string, homeFolder: string, name: string): void {
  const link = posix.join(homeFolder, ".local", "bin", name);
  if (existsSync(link)) return;
  try {
    // existsSync follows a link, so a link whose target is gone reads as missing: replace it.
    rmSync(link, { force: true });
    mkdirSync(posix.dirname(link), { recursive: true });
    symlinkSync(program, link);
  } catch {
    // Eva finds pi in its own folder, so a missing link costs only the person's shortcut.
  }
}

/**
 * Puts the new folder in place of the old one. The old one moves aside first, and comes back when
 * the move fails, such as when a virus scanner on Windows still holds the new program.
 */
function replaceFolder(folder: string, replacement: string, aside: string): void {
  const hadOld = existsSync(folder);
  if (hadOld) renameSync(folder, aside);
  try {
    renameSync(replacement, folder);
  } catch (error) {
    if (hadOld) renameSync(aside, folder);
    throw error;
  }
}

/** The tar of Windows itself, in System32. */
function windowsTar(environment: Readonly<Record<string, string>>): string {
  const systemRoot = environment["SystemRoot"] ?? environment["SYSTEMROOT"] ?? "C:\\Windows";
  return win32.join(systemRoot, "System32", "tar.exe");
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

/** The first line that the command prints, or null when it fails or does not exist. */
async function firstLine(command: readonly string[], inputs: EngineInstallInputs): Promise<string | null> {
  try {
    const result = await inputs.runner.run(runnableCommand(command, inputs.platform), {
      cwd: inputs.homeFolder,
      environment: inputs.environment,
      timeoutMs: versionTimeoutMs,
    });
    if (result.exitCode !== 0) return null;
    return (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] ?? "";
  } catch {
    return null;
  }
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
  // The message adds its own period.
  return (lines.at(-1) ?? "no output").replace(/\.+$/, "");
}

function failure(message: string): EvaError {
  return new EvaError("engine_install_failed", message);
}

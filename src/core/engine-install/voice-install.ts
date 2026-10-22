/**
 * Installs what voice notes need: ffmpeg, whisper.cpp and a whisper model. So the person turns
 * voice notes on with one button, also from a phone. ffmpeg and whisper.cpp come from the builds
 * of their GitHub releases, checked against the checksum that GitHub keeps for each file. The
 * model comes from Hugging Face, checked against a fixed checksum. No install needs an administrator.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, posix, win32 } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import {
  download,
  linkForTerminal,
  messageOf,
  replaceFolder,
  run,
  windowsTar,
  type EngineInstallInputs,
} from "./engine-install.ts";

export interface VoiceInstallInputs extends EngineInstallInputs {
  /** GitHub's API answer for the ffmpeg builds; a test points it at a fake server. */
  readonly ffmpegReleaseUrl?: string;
  /** GitHub's API list of the recent whisper.cpp releases; a test points it at a fake server. */
  readonly whisperReleaseUrl?: string;
  /** The whisper model download; a test points it at a fake server. */
  readonly voiceModelUrl?: string;
  /** The checksum of the model download; a test gives the checksum of its fake model. */
  readonly voiceModelSha256?: string;
}

/** The parts of voice notes, as the Updates page names them. */
export type VoicePart = "ffmpeg" | "whisper-cli" | "speech model";

export interface VoicePrograms {
  readonly ffmpeg: string;
  readonly whisper: string;
}

const defaultFfmpegReleaseUrl = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest";
// The list, not the latest release: since v1.9.3, each whisper.cpp version holds no files, and a
// build release marked as a pre-release (such as b5454) holds the programs.
const defaultWhisperReleaseUrl = "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30";
/** `ggml-base.bin` reads Spanish and English well, and runs fast enough on a small computer. */
const defaultModelUrl =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin";
const defaultModelSha256 = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const commandTimeoutMs = 5 * 60_000;

/** The release names each system and processor in its own words. */
const ffmpegBuilds: Readonly<Record<string, string>> = {
  "linux-x64": "ffmpeg-master-latest-linux64-gpl.tar.xz",
  "linux-arm64": "ffmpeg-master-latest-linuxarm64-gpl.tar.xz",
  "win32-x64": "ffmpeg-master-latest-win64-gpl.zip",
  "win32-arm64": "ffmpeg-master-latest-winarm64-gpl.zip",
};
const whisperBuilds: Readonly<Record<string, string>> = {
  "linux-x64": "whisper-bin-ubuntu-x64.tar.gz",
  "linux-arm64": "whisper-bin-ubuntu-arm64.tar.gz",
  "win32-x64": "whisper-bin-x64.zip",
  "win32-arm64": "whisper-bin-win-cpu-arm64.zip",
};

/** The folder of Eva's own copy of a voice program. Every Eva on the computer shares it. */
function ownFolder(
  name: "ffmpeg" | "whisper.cpp",
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return posix.join(homeFolder, ".local", "lib", name);
  return win32.join(environment["LOCALAPPDATA"] ?? win32.join(homeFolder, "AppData", "Local"), "Programs", name);
}

/** Eva's own ffmpeg and whisper-cli, where her install puts them. */
export function ownVoicePrograms(
  platform: NodeJS.Platform,
  homeFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): VoicePrograms {
  const path = platform === "win32" ? win32 : posix;
  const exe = platform === "win32" ? ".exe" : "";
  return {
    ffmpeg: path.join(ownFolder("ffmpeg", platform, homeFolder, environment), "bin", `ffmpeg${exe}`),
    whisper: path.join(ownFolder("whisper.cpp", platform, homeFolder, environment), `whisper-cli${exe}`),
  };
}

export interface VoiceProgramPlaces {
  readonly which: (name: string) => string | null;
  readonly exists: (path: string) => boolean;
}

/**
 * The program to run: a path that the settings name, else the name on the PATH, else Eva's own
 * copy. A service keeps the PATH of its install, which never has Eva's own folder on Windows.
 */
export function locateVoiceProgram(configured: string, own: string, places: VoiceProgramPlaces): string {
  if (/[\\/]/.test(configured) || places.which(configured) !== null) return configured;
  return places.exists(own) ? own : configured;
}

/** What a person does to set up voice notes by hand. */
export function voiceInstallSteps(): string {
  return "To set up voice notes by hand, see https://github.com/guplem/eva/blob/main/docs/guide/reference.md#optional-features.";
}

/** Installs ffmpeg and returns Eva's own copy. Throws EvaError `engine_install_failed` with the steps. */
export async function installFfmpeg(inputs: VoiceInstallInputs): Promise<string> {
  const program = ownVoicePrograms(inputs.platform, inputs.homeFolder, inputs.environment).ffmpeg;
  await installStep("ffmpeg", async () => {
    const release = await readRelease(inputs.ffmpegReleaseUrl ?? defaultFfmpegReleaseUrl);
    const archive = buildName(ffmpegBuilds, "ffmpeg", inputs);
    const exe = inputs.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    // The archive holds bin/ffmpeg in a folder named after the archive.
    await installArchive(release, archive, "ffmpeg", inputs, (folder) =>
      existsSync(pathOf(inputs).join(folder, "bin", exe)),
    );
  });
  if (inputs.platform !== "win32") linkForTerminal(program, inputs.homeFolder, "ffmpeg");
  return program;
}

/** Installs whisper-cli and returns Eva's own copy. Throws EvaError `engine_install_failed` with the steps. */
export async function installWhisper(inputs: VoiceInstallInputs): Promise<string> {
  const program = ownVoicePrograms(inputs.platform, inputs.homeFolder, inputs.environment).whisper;
  await installStep("whisper.cpp", async () => {
    const archive = buildName(whisperBuilds, "whisper.cpp", inputs);
    const release = newestWithFile(await readReleases(inputs.whisperReleaseUrl ?? defaultWhisperReleaseUrl), archive);
    const exe = inputs.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
    // The program finds its libraries next to it, so the whole folder moves.
    await installArchive(release, archive, "whisper.cpp", inputs, (folder) =>
      existsSync(pathOf(inputs).join(folder, exe)),
    );
  });
  if (inputs.platform !== "win32") linkForTerminal(program, inputs.homeFolder, "whisper-cli");
  return program;
}

/** Downloads the whisper model to `modelPath`. Throws EvaError `engine_install_failed` with the steps. */
export async function installVoiceModel(modelPath: string, inputs: VoiceInstallInputs): Promise<void> {
  await installStep("the speech model", async () => {
    const bytes = new Uint8Array(await (await download(inputs.voiceModelUrl ?? defaultModelUrl)).arrayBuffer());
    if (sha256(bytes) !== (inputs.voiceModelSha256 ?? defaultModelSha256))
      throw new Error("The download does not match its checksum, so Eva saved nothing.");
    // The model path comes from this machine's settings, so it takes this machine's separators.
    mkdirSync(dirname(modelPath), { recursive: true });
    // A half-written model must never look ready.
    const partial = `${modelPath}.download`;
    writeFileSync(partial, bytes);
    renameSync(partial, modelPath);
  });
}

async function installStep(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    throw new EvaError(
      "engine_install_failed",
      `Eva could not install ${name}: ${messageOf(error)} ${voiceInstallSteps()}`,
      {
        cause: error,
      },
    );
  }
}

interface Release {
  readonly assets?: { name?: unknown; browser_download_url?: unknown; digest?: unknown }[];
}

async function readRelease(url: string): Promise<Release> {
  return (await (await download(url)).json()) as Release;
}

async function readReleases(url: string): Promise<readonly Release[]> {
  const list: unknown = await (await download(url)).json();
  return Array.isArray(list) ? (list as Release[]) : [];
}

/**
 * The newest release that holds the file. GitHub lists the newest first. whisper.cpp marks its
 * build releases as pre-releases at random, so the mark decides nothing. The checksum still checks
 * each file.
 */
function newestWithFile(releases: readonly Release[], file: string): Release {
  return releases.find((release) => release.assets?.some((asset) => asset.name === file) === true) ?? {};
}

function buildName(builds: Readonly<Record<string, string>>, name: string, inputs: VoiceInstallInputs): string {
  const build = builds[`${inputs.platform}-${inputs.arch}`];
  if (build === undefined) throw new Error(`${name} has no build for ${inputs.platform} on ${inputs.arch}.`);
  return build;
}

/** Downloads the archive, checks it, and puts the folder that `holdsProgram` picks in place of Eva's copy. */
async function installArchive(
  release: Release,
  archive: string,
  name: "ffmpeg" | "whisper.cpp",
  inputs: VoiceInstallInputs,
  holdsProgram: (folder: string) => boolean,
): Promise<void> {
  const asset = release.assets?.find((candidate) => candidate.name === archive);
  if (typeof asset?.browser_download_url !== "string") throw new Error(`The ${name} release lists no ${archive}.`);
  const expected = typeof asset.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1] : undefined;
  if (expected === undefined) throw new Error(`The ${name} release lists no checksum for ${archive}.`);
  const bytes = new Uint8Array(await (await download(asset.browser_download_url)).arrayBuffer());
  if (sha256(bytes) !== expected.toLowerCase())
    throw new Error(`The ${name} download does not match its checksum, so Eva installed nothing.`);

  const path = pathOf(inputs);
  const folder = ownFolder(name, inputs.platform, inputs.homeFolder, inputs.environment);
  mkdirSync(path.dirname(folder), { recursive: true });
  // Its own staging folder: two installs at once never share a file.
  const staging = mkdtempSync(path.join(path.dirname(folder), `${name}-download-`));
  try {
    const archivePath = path.join(staging, archive);
    const extracted = path.join(staging, "extracted");
    writeFileSync(archivePath, bytes);
    mkdirSync(extracted);
    await run(
      inputs.platform === "win32"
        ? [windowsTar(inputs.environment), "-xf", archivePath, "-C", extracted]
        : ["tar", archive.endsWith(".tar.xz") ? "-xJf" : "-xzf", archivePath, "-C", extracted],
      inputs,
      commandTimeoutMs,
    );
    const top = findFolder(extracted, holdsProgram, path, 3);
    if (top === null) throw new Error(`The ${name} archive holds no program.`);
    replaceFolder(folder, top, path.join(staging, "old"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The first folder, at most `depth` levels down, that `holds` picks. Each release nests its files in its own way. */
function findFolder(
  folder: string,
  holds: (folder: string) => boolean,
  path: typeof posix,
  depth: number,
): string | null {
  if (holds(folder)) return folder;
  if (depth === 0) return null;
  for (const name of readdirSync(folder)) {
    const child = path.join(folder, name);
    if (!statSync(child).isDirectory()) continue;
    const found = findFolder(child, holds, path, depth - 1);
    if (found !== null) return found;
  }
  return null;
}

function pathOf(inputs: EngineInstallInputs): typeof posix {
  return inputs.platform === "win32" ? win32 : posix;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

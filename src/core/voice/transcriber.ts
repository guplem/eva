/**
 * Voice notes become text on this machine, so audio never leaves it
 * (lessons 71, 123). ffmpeg decodes the audio of Telegram or of the web page to 16 kHz WAV, and a whisper.cpp
 * binary transcribes it. One note runs at a time.
 *
 * Lesson 123 keeps audio in memory only. whisper.cpp reads a file, so the audio lives in a
 * private temporary folder for the run and is deleted right after, even on a failure. A folder
 * that Windows still holds is deleted at the start of the next note.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { missingLibraryHelp } from "../engine-install/voice-install.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface VoiceTools {
  readonly ffmpegExecutable: string;
  readonly whisperExecutable: string;
  readonly modelPath: string;
  /** A whisper.cpp VAD model; with it, whisper skips the silence (lesson 123). */
  readonly vadModelPath: string | null;
  /** A language code such as `es`, or null to let whisper detect it. */
  readonly language: string | null;
}

export interface TranscriberOptions {
  readonly tools: VoiceTools;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  /** A folder that only this instance uses, such as the instance's state folder. */
  readonly temporaryRoot: string;
}

export type Transcribe = (audio: Uint8Array) => Promise<string>;

const decodeTimeoutMs = 60_000;
const transcribeTimeoutMs = 180_000;
/** whisper.cpp marks a span with no words, such as `[BLANK_AUDIO]` or `(silence)`. */
const nonSpeechPattern = /\[[^\]]*\]|\([^)]*\)/g;

export function createTranscriber(options: TranscriberOptions): Transcribe {
  let queue: Promise<unknown> = Promise.resolve();
  return (audio) => {
    const run = queue.then(() => transcribeOnce(options, audio));
    queue = run.catch(() => undefined);
    return run;
  };
}

async function transcribeOnce(options: TranscriberOptions, audio: Uint8Array): Promise<string> {
  const { tools, runner, environment } = options;
  // A new instance has no state folder until it saves its first file.
  mkdirSync(options.temporaryRoot, { recursive: true });
  removeLeftAudio(options.temporaryRoot);
  const folder = mkdtempSync(join(options.temporaryRoot, "voice-"));
  try {
    const input = join(folder, "note.ogg");
    const wave = join(folder, "note.wav");
    writeFileSync(input, audio, { mode: 0o600 });
    const decode = await runner.run(
      [tools.ffmpegExecutable, "-nostdin", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", wave],
      { cwd: folder, environment, timeoutMs: decodeTimeoutMs },
    );
    if (decode.exitCode !== 0) throw failure("ffmpeg", "ffmpeg could not decode the voice note", decode.stderr);
    const vad = tools.vadModelPath === null ? [] : ["--vad", "--vad-model", tools.vadModelPath];
    const result = await runner.run(
      [
        tools.whisperExecutable,
        "--model",
        tools.modelPath,
        "--file",
        wave,
        "--language",
        tools.language ?? "auto",
        "--no-timestamps",
        "--no-prints",
        ...vad,
      ],
      { cwd: folder, environment, timeoutMs: transcribeTimeoutMs },
    );
    if (result.exitCode !== 0)
      throw failure("whisper-cli", "whisper could not transcribe the voice note", result.stderr);
    return result.stdout.replace(nonSpeechPattern, " ").replace(/\s+/g, " ").trim();
  } finally {
    await removeNoteFolder(folder);
  }
}

const removeTries = 5;
const removeRetryDelayMs = 200;

/**
 * Never throws: an error here would hide the real one. On Windows, a program that a timeout
 * stopped can still hold a file for a moment, so the delete tries again. Bun ignores the
 * `maxRetries` option of `rmSync`, and a wait inside it would block the event loop.
 */
async function removeNoteFolder(folder: string): Promise<void> {
  for (let attempt = 1; attempt <= removeTries; attempt += 1) {
    if (removeFolder(folder)) return;
    if (attempt < removeTries) await Bun.sleep(removeRetryDelayMs);
  }
  // The next note deletes the folder (removeLeftAudio), so the audio does not stay for good.
}

/** One try. Returns false when the folder is still there. */
function removeFolder(folder: string): boolean {
  try {
    rmSync(folder, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * One note runs at a time, so every voice folder that exists now is left from an earlier note.
 * One try each: a folder that is still busy goes at a later note.
 */
function removeLeftAudio(root: string): void {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) if (name.startsWith("voice-")) removeFolder(join(root, name));
}

/** The program's own last line says why it failed, so the person can act without a terminal. */
function failure(program: string, summary: string, stderr: string): EvaError {
  const help = missingLibraryHelp(program, stderr);
  if (help !== null) return new EvaError("process_failed", help);
  const lastLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  return new EvaError("process_failed", lastLine === undefined ? `${summary}.` : `${summary}: ${lastLine}`);
}

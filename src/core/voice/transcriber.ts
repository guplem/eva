/**
 * Voice notes become text on this machine, so audio never leaves it
 * (lessons 71, 123). ffmpeg decodes Telegram's Opus audio to 16 kHz WAV, and a whisper.cpp
 * binary transcribes it. One note runs at a time.
 *
 * Lesson 123 keeps audio in memory only. whisper.cpp reads a file, so the audio lives in a
 * private temporary folder for the run and is deleted right after, even on a failure.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
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
  const folder = mkdtempSync(join(options.temporaryRoot, "voice-"));
  try {
    const input = join(folder, "note.ogg");
    const wave = join(folder, "note.wav");
    writeFileSync(input, audio, { mode: 0o600 });
    const decode = await runner.run(
      [tools.ffmpegExecutable, "-nostdin", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", wave],
      { cwd: folder, environment, timeoutMs: decodeTimeoutMs },
    );
    if (decode.exitCode !== 0) throw new EvaError("process_failed", "ffmpeg could not decode the voice note.");
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
    if (result.exitCode !== 0) throw new EvaError("process_failed", "whisper could not transcribe the voice note.");
    return result.stdout.replace(nonSpeechPattern, " ").replace(/\s+/g, " ").trim();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

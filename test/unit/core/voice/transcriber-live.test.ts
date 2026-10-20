/**
 * A real voice note through real ffmpeg and whisper.cpp. The `voice` CI job
 * builds whisper.cpp, records a note with espeak-ng, and sets the variables below. Without
 * them, the test is skipped, so a machine without the tools still passes `bun test`.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriber } from "../../../../src/core/voice/transcriber.ts";
import { buildChildEnvironment, baseEnvironmentAllowlist } from "../../../../src/shared/environment.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";

const whisperExecutable = process.env["EVA_VOICE_WHISPER"];
const modelPath = process.env["EVA_VOICE_MODEL"];
const samplePath = process.env["EVA_VOICE_SAMPLE"];
const expectedWord = process.env["EVA_VOICE_EXPECTED"];
const configured =
  whisperExecutable !== undefined && modelPath !== undefined && samplePath !== undefined && expectedWord !== undefined;

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-voice-live-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

test.skipIf(!configured)(
  "a recorded voice note transcribes with ffmpeg and whisper.cpp",
  async () => {
    const transcribe = createTranscriber({
      tools: {
        ffmpegExecutable: "ffmpeg",
        whisperExecutable: whisperExecutable ?? "",
        modelPath: modelPath ?? "",
        vadModelPath: null,
        language: "en",
      },
      runner: systemProcessRunner,
      environment: buildChildEnvironment(process.env, baseEnvironmentAllowlist),
      temporaryRoot: folder,
    });
    const text = await transcribe(new Uint8Array(readFileSync(samplePath ?? "")));
    expect(text.toLowerCase()).toContain((expectedWord ?? "").toLowerCase());
  },
  180_000,
);

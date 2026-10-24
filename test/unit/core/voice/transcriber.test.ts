import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriber, type VoiceTools } from "../../../../src/core/voice/transcriber.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-voice-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const tools: VoiceTools = {
  ffmpegExecutable: "ffmpeg",
  whisperExecutable: "whisper-cli",
  modelPath: "/models/ggml-base.bin",
  vadModelPath: null,
  language: null,
};

interface RecordedRun {
  readonly command: readonly string[];
  readonly inputBytes: number[] | null;
}

function fakeRunner(answer: (command: readonly string[]) => ProcessResult | Promise<ProcessResult>): {
  runner: ProcessRunner;
  runs: RecordedRun[];
} {
  const runs: RecordedRun[] = [];
  return {
    runs,
    runner: {
      run: async (command) => {
        const input = command.includes("-i") ? command[command.indexOf("-i") + 1] : undefined;
        runs.push({ command, inputBytes: input === undefined ? null : [...readFileSync(input)] });
        return answer(command);
      },
    },
  };
}

const ok = (stdout = ""): ProcessResult => ({ exitCode: 0, stdout, stderr: "" });

/** What Windows answers while a stopped program still holds a file. */
const busy = (): Error => Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });

describe("createTranscriber (lessons 71, 123)", () => {
  test("decodes with ffmpeg, transcribes with whisper, and leaves no audio behind", async () => {
    const { runner, runs } = fakeRunner((command) => ok(command[0] === "whisper-cli" ? " Buy milk.\n" : ""));
    const transcribe = createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder });
    expect(await transcribe(new Uint8Array([7, 8]))).toBe("Buy milk.");
    expect(runs[0]?.inputBytes).toEqual([7, 8]);
    expect(runs[0]?.command.slice(0, 4)).toEqual(["ffmpeg", "-nostdin", "-loglevel", "error"]);
    expect(runs[1]?.command).toEqual([
      "whisper-cli",
      "--model",
      "/models/ggml-base.bin",
      "--file",
      expect.stringMatching(/note\.wav$/) as string,
      "--language",
      "auto",
      "--no-timestamps",
      "--no-prints",
    ]);
    expect(readdirSync(folder)).toEqual([]);
  });

  test("a VAD model and a language reach whisper", async () => {
    const { runner, runs } = fakeRunner(() => ok());
    const transcribe = createTranscriber({
      tools: { ...tools, vadModelPath: "/models/vad.bin", language: "es" },
      runner,
      environment: {},
      temporaryRoot: folder,
    });
    await transcribe(new Uint8Array([1]));
    expect(runs[1]?.command.slice(-3)).toEqual(["--vad", "--vad-model", "/models/vad.bin"]);
    expect(runs[1]?.command).toContain("es");
  });

  test("whisper's marks for silence are not speech", async () => {
    const { runner } = fakeRunner((command) => ok(command[0] === "whisper-cli" ? "[BLANK_AUDIO]\n (silence) " : ""));
    const transcribe = createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder });
    expect(await transcribe(new Uint8Array([1]))).toBe("");
  });

  test("a failed decode or transcription throws, and still removes the audio", async () => {
    const decodeFails = fakeRunner(() => ({ exitCode: 1, stdout: "", stderr: "bad" }));
    const transcribe = createTranscriber({ tools, runner: decodeFails.runner, environment: {}, temporaryRoot: folder });
    let caught: unknown;
    try {
      await transcribe(new Uint8Array([1]));
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "process_failed")).toBe(true);
    const whisperFails = fakeRunner((command) =>
      command[0] === "whisper-cli" ? { exitCode: 2, stdout: "", stderr: "no model" } : ok(),
    );
    const second = createTranscriber({ tools, runner: whisperFails.runner, environment: {}, temporaryRoot: folder });
    const failure = await second(new Uint8Array([1])).then(
      () => null,
      (error: unknown) => error,
    );
    // The program's own last line says why.
    expect(String(failure)).toContain("whisper could not transcribe the voice note: no model");
    expect(readdirSync(folder)).toEqual([]);
  });

  test("a folder that Windows still holds keeps the real error, after five tries to delete it", async () => {
    const remove = spyOn(fs, "rmSync").mockImplementation(() => {
      throw busy();
    });
    try {
      const { runner } = fakeRunner((command) =>
        command[0] === "whisper-cli" ? { exitCode: 2, stdout: "", stderr: "timed out" } : ok(),
      );
      const transcribe = createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder });
      const failure = await transcribe(new Uint8Array([1])).then(
        () => null,
        (error: unknown) => error,
      );
      expect(String(failure)).toContain("whisper could not transcribe the voice note: timed out");
      expect(remove).toHaveBeenCalledTimes(5);
    } finally {
      remove.mockRestore();
    }
  });

  test("the delete tries again until a busy folder is free", async () => {
    const realRemove = fs.rmSync;
    let failures = 2;
    const remove = spyOn(fs, "rmSync").mockImplementation((path, options) => {
      if (failures > 0) {
        failures -= 1;
        throw busy();
      }
      realRemove(path, options);
    });
    try {
      const { runner } = fakeRunner(() => ok());
      await createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder })(new Uint8Array([1]));
      expect(remove).toHaveBeenCalledTimes(3);
      expect(readdirSync(folder)).toEqual([]);
    } finally {
      remove.mockRestore();
    }
  });

  test("a note removes the audio that an earlier note could not delete, and nothing else", async () => {
    fs.mkdirSync(join(folder, "voice-old"));
    fs.writeFileSync(join(folder, "voice-old", "note.ogg"), "audio");
    fs.writeFileSync(join(folder, "sessions.json"), "{}");
    const { runner } = fakeRunner(() => ok());
    await createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder })(new Uint8Array([1]));
    expect(readdirSync(folder)).toEqual(["sessions.json"]);
  });

  test("a whisper-cli that lacks a system library says which one, and how to add it", async () => {
    const { runner } = fakeRunner((command) =>
      command[0] === "whisper-cli"
        ? {
            exitCode: 127,
            stdout: "",
            stderr:
              "whisper-cli: error while loading shared libraries: libgomp.so.1: cannot open shared object file: No such file or directory\n",
          }
        : ok(),
    );
    const transcribe = createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder });
    const failure = await transcribe(new Uint8Array([1])).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isEvaError(failure, "process_failed")).toBe(true);
    expect(String(failure)).toContain("whisper-cli cannot start: this computer lacks the library libgomp.so.1.");
    expect(String(failure)).toContain("sudo apt install libgomp1");
  });

  test("one note at a time, and a failed note does not block the next", async () => {
    let running = 0;
    let most = 0;
    let calls = 0;
    const { runner } = fakeRunner(async (command) => {
      running += 1;
      most = Math.max(most, running);
      await Bun.sleep(5);
      running -= 1;
      calls += 1;
      if (calls === 1) return { exitCode: 1, stdout: "", stderr: "" };
      return ok(command[0] === "whisper-cli" ? "two" : "");
    });
    const transcribe = createTranscriber({ tools, runner, environment: {}, temporaryRoot: folder });
    const results = await Promise.allSettled([transcribe(new Uint8Array([1])), transcribe(new Uint8Array([2]))]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(most).toBe(1);
    expect(existsSync(folder) && statSync(folder).isDirectory()).toBe(true);
  });
});

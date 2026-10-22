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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installFfmpeg,
  installVoiceModel,
  installWhisper,
  locateVoiceProgram,
  ownVoicePrograms,
  voiceInstallSteps,
  type VoiceInstallInputs,
} from "../../../../src/core/engine-install/voice-install.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

const archive = new TextEncoder().encode("a pretend archive");
const archiveHash = createHash("sha256").update(archive).digest("hex");
const model = new TextEncoder().encode("a pretend whisper model");
const modelHash = createHash("sha256").update(model).digest("hex");

async function caught(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return null;
}

describe("ownVoicePrograms", () => {
  test("puts each program in the user's own folders, beside Eva's gh", () => {
    expect(ownVoicePrograms("linux", "/srv/example", {})).toEqual({
      ffmpeg: "/srv/example/.local/lib/ffmpeg/bin/ffmpeg",
      whisper: "/srv/example/.local/lib/whisper.cpp/whisper-cli",
    });
    expect(ownVoicePrograms("win32", "D:\\Homes\\example", { LOCALAPPDATA: "D:\\Local" })).toEqual({
      ffmpeg: "D:\\Local\\Programs\\ffmpeg\\bin\\ffmpeg.exe",
      whisper: "D:\\Local\\Programs\\whisper.cpp\\whisper-cli.exe",
    });
  });
});

describe("locateVoiceProgram", () => {
  const own = "/srv/example/.local/lib/ffmpeg/bin/ffmpeg";

  test("a path from the settings wins, then the name on the PATH, then Eva's own copy", () => {
    const nothing = { which: () => null, exists: () => false };
    expect(locateVoiceProgram("/opt/ffmpeg", own, nothing)).toBe("/opt/ffmpeg");
    expect(locateVoiceProgram("ffmpeg", own, { which: () => "/usr/bin/ffmpeg", exists: () => true })).toBe("ffmpeg");
    expect(locateVoiceProgram("ffmpeg", own, { which: () => null, exists: (path) => path === own })).toBe(own);
    // With nothing found, the name stays, so the error names the program.
    expect(locateVoiceProgram("ffmpeg", own, nothing)).toBe("ffmpeg");
  });
});

describe("the voice installs", () => {
  let home: string;
  let server: ReturnType<typeof Bun.serve> | null;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "eva-voice-install-"));
    server = null;
  });
  afterEach(() => {
    void server?.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  /** Each release as GitHub's API describes it, and the model, on one fake server. */
  function serve(digest: string | null = `sha256:${archiveHash}`): string {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const base = `http://127.0.0.1:${String(server?.port)}`;
        const path = new URL(request.url).pathname;
        const release = (names: string[]): Response =>
          Response.json({
            assets: names.map((name) => ({
              name,
              browser_download_url: `${base}/files/${name}`,
              ...(digest === null ? {} : { digest }),
            })),
          });
        if (path === "/ffmpeg")
          return release(["ffmpeg-master-latest-linux64-gpl.tar.xz", "ffmpeg-master-latest-win64-gpl.zip"]);
        // As GitHub lists whisper.cpp today: the newest version holds no files, and a build release
        // marked as a pre-release holds them.
        if (path === "/whisper")
          return Response.json([
            { tag_name: "v1.9.5", prerelease: false, assets: [] },
            {
              tag_name: "b5454",
              prerelease: true,
              assets: ["whisper-bin-ubuntu-x64.tar.gz", "whisper-bin-x64.zip"].map((name) => ({
                name,
                browser_download_url: `${base}/files/${name}`,
                ...(digest === null ? {} : { digest }),
              })),
            },
          ]);
        // Two releases that hold the files: the newer one comes first, as GitHub lists them.
        if (path === "/whisper-two")
          return Response.json([
            {
              tag_name: "b5454",
              prerelease: true,
              assets: [
                {
                  name: "whisper-bin-ubuntu-x64.tar.gz",
                  browser_download_url: `${base}/files/whisper-bin-ubuntu-x64.tar.gz`,
                  digest,
                },
              ],
            },
            {
              tag_name: "b4938",
              prerelease: false,
              assets: [{ name: "whisper-bin-ubuntu-x64.tar.gz", browser_download_url: `${base}/old`, digest }],
            },
          ]);
        if (path === "/model") return new Response(model);
        if (path.startsWith("/files/")) return new Response(archive);
        return new Response("not found", { status: 404 });
      },
    });
    return `http://127.0.0.1:${String(server.port)}`;
  }

  /** `tar` writes each file where the release keeps it. */
  function tarRunner(commands: string[][], files: readonly string[]): ProcessRunner {
    return {
      run: (command) => {
        commands.push([...command]);
        const target = command[command.indexOf("-C") + 1] ?? "";
        for (const file of files) {
          mkdirSync(join(target, file, ".."), { recursive: true });
          writeFileSync(join(target, file), `pretend ${file}`);
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
  }

  function inputs(runner: ProcessRunner, base: string): VoiceInstallInputs {
    return {
      runner,
      environment: {},
      platform: "linux",
      arch: "x64",
      homeFolder: home,
      ffmpegReleaseUrl: `${base}/ffmpeg`,
      whisperReleaseUrl: `${base}/whisper`,
      voiceModelUrl: `${base}/model`,
      voiceModelSha256: modelHash,
    };
  }

  test("ffmpeg comes from its release build, checked, in ~/.local/lib/ffmpeg with a link", async () => {
    const commands: string[][] = [];
    const runner = tarRunner(commands, ["ffmpeg-master-latest-linux64-gpl/bin/ffmpeg"]);
    const program = await installFfmpeg(inputs(runner, serve()));
    // The install builds a Linux path, also when the tests run on Windows.
    expect(program).toBe(`${home}/.local/lib/ffmpeg/bin/ffmpeg`);
    expect(readFileSync(program, "utf8")).toBe("pretend ffmpeg-master-latest-linux64-gpl/bin/ffmpeg");
    expect(commands[0]?.slice(0, 2)).toEqual(["tar", "-xJf"]);
    if (process.platform !== "win32")
      expect(lstatSync(join(home, ".local", "bin", "ffmpeg")).isSymbolicLink()).toBe(true);
    // The staging folder is gone.
    expect(readdirSync(join(home, ".local", "lib"))).toEqual(["ffmpeg"]);
  });

  test("whisper-cli moves with the libraries beside it", async () => {
    const commands: string[][] = [];
    const runner = tarRunner(commands, ["whisper-bin-ubuntu-x64/whisper-cli", "whisper-bin-ubuntu-x64/libwhisper.so"]);
    const program = await installWhisper(inputs(runner, serve()));
    expect(program).toBe(`${home}/.local/lib/whisper.cpp/whisper-cli`);
    expect(existsSync(join(home, ".local", "lib", "whisper.cpp", "libwhisper.so"))).toBe(true);
    expect(commands[0]?.slice(0, 2)).toEqual(["tar", "-xzf"]);
    if (process.platform !== "win32")
      expect(lstatSync(join(home, ".local", "bin", "whisper-cli")).isSymbolicLink()).toBe(true);
  });

  test("whisper-cli comes from the newest release that holds the build, whatever its pre-release mark", async () => {
    const runner = tarRunner([], ["whisper-bin-ubuntu-x64/whisper-cli"]);
    const base = serve();
    // Today's list: the newest version holds no files, and a pre-release holds them.
    await installWhisper(inputs(runner, base));
    // The newer of two releases wins: the older one's /old would fail the download.
    const program = await installWhisper({ ...inputs(runner, base), whisperReleaseUrl: `${base}/whisper-two` });
    expect(readFileSync(program, "utf8")).toBe("pretend whisper-bin-ubuntu-x64/whisper-cli");
  });

  test("a new install replaces an old copy", async () => {
    const base = serve();
    await installWhisper(inputs(tarRunner([], ["whisper-bin-ubuntu-x64/whisper-cli", "old.so"]), base));
    await installWhisper(inputs(tarRunner([], ["whisper-bin-ubuntu-x64/whisper-cli"]), base));
    expect(readdirSync(join(home, ".local", "lib", "whisper.cpp"))).toEqual(["whisper-cli"]);
  });

  test("a download that does not match its checksum, or that has none, installs nothing", async () => {
    const runner = tarRunner([], ["ffmpeg-master-latest-linux64-gpl/bin/ffmpeg"]);
    const wrong = await caught(installFfmpeg(inputs(runner, serve(`sha256:${"0".repeat(64)}`))));
    expect(isEvaError(wrong, "engine_install_failed")).toBe(true);
    expect(String(wrong)).toContain("does not match its checksum");
    expect(String(wrong)).toContain(voiceInstallSteps());
    void server?.stop(true);
    expect(String(await caught(installFfmpeg(inputs(runner, serve(null)))))).toContain("lists no checksum");
    expect(existsSync(join(home, ".local", "lib", "ffmpeg"))).toBe(false);
  });

  test("an archive without the program, a system with no build, or a failed download gives the steps", async () => {
    const base = serve();
    expect(String(await caught(installWhisper(inputs(tarRunner([], ["README.md"]), base))))).toContain(
      "holds no program",
    );
    const arm = await caught(installWhisper({ ...inputs(tarRunner([], []), base), platform: "darwin", arch: "arm64" }));
    expect(String(arm)).toContain("no build for darwin on arm64");
    const offline = await caught(
      installFfmpeg({ ...inputs(tarRunner([], []), base), ffmpegReleaseUrl: `${base}/gone` }),
    );
    expect(String(offline)).toContain("The download failed (404)");
    expect(String(offline)).toContain("reference.md#optional-features");
  });

  test("the model lands at its path whole, and a wrong download saves nothing", async () => {
    const base = serve();
    const modelPath = join(home, "eva-ana", "voice", "ggml-base.bin");
    await installVoiceModel(modelPath, inputs(tarRunner([], []), base));
    expect(readFileSync(modelPath, "utf8")).toBe("a pretend whisper model");
    rmSync(modelPath);
    const wrong = await caught(
      installVoiceModel(modelPath, { ...inputs(tarRunner([], []), base), voiceModelSha256: "0".repeat(64) }),
    );
    expect(String(wrong)).toContain("Eva could not install the speech model");
    expect(readdirSync(join(home, "eva-ana", "voice"))).toEqual([]);
  });
});

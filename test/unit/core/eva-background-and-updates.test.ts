/** Tests of Eva's background work and updates. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Eva, type EvaOptions } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { ghInstallRunner, serveGhRelease } from "../../support/fake-gh-release.ts";
import { gitEnvironment } from "../../support/git-sandbox.ts";
import {
  useEvaTestbed,
  clock,
  config,
  home,
  sandbox,
  setClock,
  setEva,
  start,
  syncOff,
  syncOn,
  vault,
  waitFor,
} from "../../support/eva-testbed.ts";

useEvaTestbed();

describe("Eva", () => {
  test("the idle sweep saves a change made outside a turn", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/Diary/2026-10-14.md", "Written by hand.\n");
    await instance.sweep();
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Life/Diary/2026-10-14.md");
  });

  test("each turn end goes to the log, with the cache counts of a finished turn (lesson 120)", async () => {
    const lines: string[] = [];
    const instance = start(
      new FakeEngine((request, turnNumber) => {
        if (turnNumber === 1) return FakeEngine.answer(request, "done");
        throw new Error("the engine broke");
      }),
      {},
      { logger: { log: (level, message, details) => lines.push(`${level} ${message} ${JSON.stringify(details)}`) } },
    );
    const session = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(session.id, "hi");
    await instance.sessions.send(session.id, "again");
    const turnLines = lines.filter((line) => line.includes("A turn"));
    expect(turnLines[0]).toStartWith(`info A turn finished. {"sessionId":"${session.id}"`);
    expect(turnLines[0]).toContain("cacheReadTokens");
    expect(turnLines[1]).toStartWith(`warn A turn failed. {"sessionId":"${session.id}","reason":`);
  });
  test("a sync failure and a held-back secret file go to the log (lessons 16, 26)", async () => {
    const lines: string[] = [];
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        logger: { log: (level, message, details) => lines.push(`${level} ${message} ${JSON.stringify(details)}`) },
      }),
    );
    sandbox.write(vault, "Notes/keys.md", "token ghp_" + "a".repeat(36) + "\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain("held back files");
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    sandbox.write(vault, "Notes/other.md", "more\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain('warn Vault sync failed. {"status":"offline"');
  });

  test("the background tick removes old scratch files and old logs once a day, also with sync off", async () => {
    sandbox.write(vault, ".eva/scratch/old.pdf", "old");
    // A vault from before #767 lists its old Scratch/ in .gitignore.
    sandbox.write(vault, ".gitignore", "Scratch/\n");
    sandbox.write(vault, "Scratch/old.pdf", "old");
    let logCleanups = 0;
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config({ sync: syncOff }),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        removeOldLogs: () => {
          logCleanups += 1;
        },
      }),
    );
    setClock(new Date(Date.now() + 8 * 24 * 60 * 60_000));
    await eva.backgroundTick();
    expect(existsSync(join(vault, ".eva", "scratch", "old.pdf"))).toBe(false);
    // Eva writes no more in the old Scratch/, so it goes once it is empty (#767).
    expect(existsSync(join(vault, "Scratch"))).toBe(false);
    expect(logCleanups).toBe(1);
    await eva.backgroundTick();
    expect(logCleanups).toBe(1);
    setClock(new Date(clock.getTime() + 24 * 60 * 60_000));
    await eva.backgroundTick();
    expect(logCleanups).toBe(2);
  });

  test("the scratch cleanup waits while an Assistant turn runs (lessons 22, 30)", async () => {
    sandbox.write(vault, ".eva/scratch/old.pdf", "old");
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine, { sync: syncOff });
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    setClock(new Date(Date.now() + 8 * 24 * 60 * 60_000));
    await instance.backgroundTick();
    expect(existsSync(join(vault, ".eva", "scratch", "old.pdf"))).toBe(true);
    release();
    await turn;
    await instance.backgroundTick();
    expect(existsSync(join(vault, ".eva", "scratch", "old.pdf"))).toBe(false);
  });

  test("a second idle sweep never starts while one runs", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Notes/local.md", "local\n");
    const first = instance.sweep();
    expect(await instance.sweep()).toBe("skipped");
    expect(await first).toBe("ok");
  });

  test("a second background tick never starts while one runs", async () => {
    let checks = 0;
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config({ sync: syncOn }),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        updateChannel: {
          kind: "source",
          check: () => {
            checks += 1;
            return Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false, releases: null });
          },
          apply: () => Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false, releases: null }),
        },
      }),
    );
    // The first tick waits on its vault fetch; a second tick at that moment must do nothing.
    const first = eva.backgroundTick();
    await eva.backgroundTick();
    expect(checks).toBe(0);
    await first;
    expect(checks).toBe(1);
  });

  test("a stale check asks the update channel again at most once an hour, and after a failure every 10 minutes", async () => {
    let checks = 0;
    let offline = false;
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config({ sync: syncOn }),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        updateChannel: {
          kind: "executable",
          check: () => {
            checks += 1;
            if (offline) return Promise.reject(new Error("offline"));
            return Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: [] });
          },
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: [] }),
        },
      }),
    );
    // The frequency can be off, so the first look of a page asks the channel.
    expect((await eva.checkForUpdateIfStale())?.latest).toBe("0.2.0");
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(1);
    setClock(new Date(clock.getTime() + 61 * 60_000));
    offline = true;
    expect((await eva.checkForUpdateIfStale())?.lastError).toBe("offline");
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(2);
    setClock(new Date(clock.getTime() + 11 * 60_000));
    await eva.checkForUpdateIfStale();
    expect(checks).toBe(3);
  });

  test("an update waits for a message that is still gathering, then installs (lesson 92)", async () => {
    const restarts: string[] = [];
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        gatherMs: 50,
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
        restartForUpdate: () => restarts.push("restart"),
      }),
    );
    const session = eva.createAssistantSession({ source: "schedule" });
    const turn = eva.sessions.send(session.id, "Plan my day.");
    expect((await eva.updateNow())?.phase).toBe("waiting_for_idle");
    await turn;
    await eva.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("the engine update runs `claude update` with the engine's config folder and no token (lesson 96)", async () => {
    const claudeRuns: { command: string; environment: Readonly<Record<string, string>> }[] = [];
    let version = "2.1.0";
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        claudeRuns.push({ command: command.join(" "), environment: options.environment });
        if (command[1] === "update") version = "2.2.0";
        return Promise.resolve({ exitCode: 0, stdout: `${version} (Claude Code)\n`, stderr: "" });
      },
    };
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: { claudeOauthToken: "oauth-token-value-for-tests", githubToken: "github-token-value-for-tests" },
        engines: [new FakeEngine()],
        runner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        claudeExecutable: "/opt/claude",
      }),
    );
    expect(eva.engineUpdateStatus()).toEqual({ phase: "idle", last: null });
    expect(eva.updateEngine()?.phase).toBe("updating");
    const instance = eva;
    await waitFor(() => instance.engineUpdateStatus()?.phase === "idle");
    expect(instance.engineUpdateStatus()?.last).toMatchObject({ outcome: "updated", after: "2.2.0" });
    expect(claudeRuns.map((run) => run.command)).toEqual([
      "/opt/claude --version",
      "/opt/claude update",
      "/opt/claude --version",
    ]);
    for (const run of claudeRuns) {
      expect(run.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
      expect(Object.values(run.environment)).not.toContain("github-token-value-for-tests");
      expect(Object.values(run.environment)).not.toContain("oauth-token-value-for-tests");
    }
  });

  test("the engine update waits for a running turn, and Eva's own update waits for the engine update", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const finishUpdateGate: { open: (() => void) | null } = { open: null };
    const runner: ProcessRunner = {
      run: async (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        if (command[1] === "update") await new Promise<void>((resolve) => (finishUpdateGate.open = resolve));
        return { exitCode: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
      },
    };
    const restarts: string[] = [];
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      claudeExecutable: "/opt/claude",
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    setEva(instance);
    const turn = instance.sessions.send(instance.createAssistantSession({ source: "cli" }).id, "go");
    await waitFor(() => engine.requests.length >= 1);
    expect(instance.updateEngine()?.phase).toBe("waiting_for_idle");
    release();
    await turn;
    // The engine update runs apart, so the tick never waits for its download.
    await instance.backgroundTick();
    expect(instance.engineUpdateStatus()?.phase).toBe("updating");
    expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
    await waitFor(() => finishUpdateGate.open !== null);
    finishUpdateGate.open?.();
    await waitFor(() => instance.engineUpdateStatus()?.phase === "idle");
    expect(instance.engineUpdateStatus()?.last?.outcome).toBe("up_to_date");
    await instance.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("gives her own version and the version of each tool, from the claude program that she runs", async () => {
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] === "/opt/claude")
          return Promise.resolve({ exitCode: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" });
        // The other tools are missing, so the answer does not depend on this machine.
        if (command.length === 2 && ["--version", "-version", "--help", "version"].includes(command[1] ?? ""))
          return Promise.reject(new Error("not found"));
        return systemProcessRunner.run(command, options);
      },
    };
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
      toolPlaces: { platform: "linux", userHome: "/srv/person", standalone: true },
    });
    setEva(instance);
    const versions = await instance.versions();
    expect(versions.eva).toBe(instance.status().version);
    expect(versions.tools.find((tool) => tool.program === "claude")?.version).toBe("2.1.300");
    expect(versions.tools.find((tool) => tool.program === "git")?.version).toBeNull();
    expect(versions.tools.some((tool) => tool.program === "bun")).toBe(false);
  });

  test("the latest tool versions come from the sources; a found one waits an hour, and a failure 10 minutes", async () => {
    const asked: string[] = [];
    let piAnswers = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const path = new URL(request.url).pathname;
        asked.push(path);
        if (path === "/@anthropic-ai/claude-code/latest") return Response.json({ version: "2.1.310" });
        if (path === "/repos/earendil-works/pi/releases/latest" && piAnswers)
          return Response.json({ tag_name: "v1.4.0" });
        return new Response("down", { status: 503 });
      },
    });
    const base = `http://127.0.0.1:${String(server.port)}`;
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolLatestSources: { npmBaseUrl: base, githubApiBaseUrl: base },
      });
      setEva(instance);
      // Two reads at once share one lookup of each tool.
      const [first] = await Promise.all([instance.latestToolVersions(), instance.latestToolVersions()]);
      expect(first).toEqual([
        { program: "claude", latest: "2.1.310" },
        { program: "pi", latest: null },
        { program: "uv", latest: null },
        { program: "gh", latest: null },
      ]);
      expect(asked).toHaveLength(4);
      // A failure waits 10 minutes; a found version waits an hour.
      asked.length = 0;
      piAnswers = true;
      expect((await instance.latestToolVersions()).find((tool) => tool.program === "pi")?.latest).toBeNull();
      expect(asked).toHaveLength(0);
      setClock(new Date(clock.getTime() + 11 * 60_000));
      const second = await instance.latestToolVersions();
      expect(second.find((tool) => tool.program === "pi")?.latest).toBe("1.4.0");
      expect(asked).not.toContain("/@anthropic-ai/claude-code/latest");
      asked.length = 0;
      setClock(new Date(clock.getTime() + 61 * 60_000));
      await instance.latestToolVersions();
      expect(asked).toContain("/@anthropic-ai/claude-code/latest");
      expect(asked).toContain("/repos/earendil-works/pi/releases/latest");
      // Claude Code on the stable channel reads the stable tag.
      mkdirSync(join(home, "engines", "claude"), { recursive: true });
      writeFileSync(join(home, "engines", "claude", "settings.json"), JSON.stringify({ autoUpdatesChannel: "stable" }));
      asked.length = 0;
      await instance.latestToolVersions();
      expect(asked).toContain("/@anthropic-ai/claude-code/stable");
    } finally {
      await server.stop(true);
    }
  });

  test("the Updates page installs a tool, one at a time, and a failure gives the steps", async () => {
    const release = serveGhRelease();
    const runner = ghInstallRunner(systemProcessRunner, { version: null });
    const options = (ghReleaseUrl: string): EvaOptions => ({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      toolPlaces: { platform: "linux", userHome: home, standalone: false },
      toolInstall: { arch: "x64", ghReleaseUrl },
    });
    try {
      const instance = new Eva(options(release.url));
      setEva(instance);
      const [first, second] = await Promise.all([instance.installTool("gh"), instance.installTool("gh")]);
      expect(first).toEqual({ ok: true, message: "Installed gh." });
      expect(second).toEqual({ ok: false, message: "Eva is installing another tool. Try again when it is done." });
      expect(runner.installs).toBe(1);
      instance.stop();
      const offline = new Eva(options("http://127.0.0.1:1/latest"));
      setEva(offline);
      const failed = await offline.installTool("gh");
      expect(failed.ok).toBe(false);
      expect(failed.message).toContain("Eva could not install gh");
      expect(failed.message).toContain("https://cli.github.com");
    } finally {
      await release.stop();
    }
  });

  test("Eva's own update waits for a running tool install, then restarts (#565)", async () => {
    const release = serveGhRelease();
    const ghRunner = ghInstallRunner(systemProcessRunner, { version: null });
    const unpackGate: { open: (() => void) | null } = { open: null };
    const runner: ProcessRunner = {
      run: async (command, options) => {
        if (command[0] === "tar") await new Promise<void>((resolve) => (unpackGate.open = resolve));
        return ghRunner.run(command, options);
      },
    };
    const restarts: string[] = [];
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolPlaces: { platform: "linux", userHome: home, standalone: false },
        toolInstall: { arch: "x64", ghReleaseUrl: release.url },
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
        restartForUpdate: () => restarts.push("restart"),
      });
      setEva(instance);
      const installing = instance.installTool("gh");
      await waitFor(() => unpackGate.open !== null);
      expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
      await instance.backgroundTick();
      expect(restarts).toEqual([]);
      unpackGate.open?.();
      expect((await installing).ok).toBe(true);
      await instance.backgroundTick();
      expect(restarts).toEqual(["restart"]);
    } finally {
      await release.stop();
    }
  });

  test("the Updates page lists what voice notes lack, and one install adds each part", async () => {
    const archive = new TextEncoder().encode("a pretend archive");
    const archiveHash = createHash("sha256").update(archive).digest("hex");
    const model = new TextEncoder().encode("a pretend whisper model");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const base = `http://127.0.0.1:${String(server.port)}`;
        const path = new URL(request.url).pathname;
        const release = (name: string): object => ({
          assets: [{ name, browser_download_url: `${base}/files/${name}`, digest: `sha256:${archiveHash}` }],
        });
        if (path === "/ffmpeg") return Response.json(release("ffmpeg-master-latest-linux64-gpl.tar.xz"));
        // whisper.cpp: the list of its recent releases, as GitHub gives it.
        if (path === "/whisper") return Response.json([release("whisper-bin-ubuntu-x64.tar.gz")]);
        if (path === "/model") return new Response(model);
        return new Response(archive);
      },
    });
    let installs = 0;
    const runner: ProcessRunner = {
      run: (command, options) => {
        const program = command[0] ?? "";
        if (program === "tar") {
          installs += 1;
          const target = command[command.indexOf("-C") + 1] ?? "";
          const file = (command[2] ?? "").includes("ffmpeg") ? join("build", "bin", "ffmpeg") : "whisper-cli";
          mkdirSync(join(target, file, ".."), { recursive: true });
          writeFileSync(join(target, file), "pretend program");
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        // Only Eva's own copies answer, so the answer does not depend on this machine.
        if (command.length === 2 && ["--version", "-version", "--help", "version"].includes(command[1] ?? ""))
          return existsSync(program)
            ? Promise.resolve({ exitCode: 0, stdout: "version 7.1\n", stderr: "" })
            : Promise.reject(new Error("not found"));
        return systemProcessRunner.run(command, options);
      },
    };
    const base = `http://127.0.0.1:${String(server.port)}`;
    try {
      const instance = new Eva({
        paths: homePaths(home),
        config: config(),
        secrets: {},
        engines: [new FakeEngine()],
        runner,
        processEnvironment: gitEnvironment,
        now: () => clock,
        basePrompt: "Base.",
        toolPlaces: { platform: "linux", userHome: home, standalone: false },
        toolInstall: {
          arch: "x64",
          ffmpegReleaseUrl: `${base}/ffmpeg`,
          whisperReleaseUrl: `${base}/whisper`,
          voiceModelUrl: `${base}/model`,
          voiceModelSha256: createHash("sha256").update(model).digest("hex"),
        },
      });
      setEva(instance);
      expect((await instance.versions()).voiceNotes).toEqual({
        missing: ["ffmpeg", "whisper-cli", "speech model"],
        on: false,
      });
      expect(await instance.installVoiceNotes()).toEqual({
        ok: true,
        message: "Installed voice notes. Press Restart Eva to turn them on.",
      });
      expect(readFileSync(join(home, "voice", "ggml-base.bin"), "utf8")).toBe("a pretend whisper model");
      const after = await instance.versions();
      expect(after.voiceNotes).toEqual({ missing: [], on: false });
      expect(after.tools.find((tool) => tool.program === "ffmpeg")?.version).toBe("7.1");
      // Nothing is missing, so a second press downloads nothing.
      expect((await instance.installVoiceNotes()).ok).toBe(true);
      expect(installs).toBe(2);
    } finally {
      await server.stop(true);
    }
  });

  test("an engine update pressed during Eva's own install runs before her restart", async () => {
    const finishInstallGate: { open: (() => void) | null } = { open: null };
    const claudeRuns: string[] = [];
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] !== "/opt/claude") return systemProcessRunner.run(command, options);
        claudeRuns.push(command.join(" "));
        return Promise.resolve({ exitCode: 0, stdout: "2.1.0\n", stderr: "" });
      },
    };
    const restarts: string[] = [];
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      claudeExecutable: "/opt/claude",
      updateChannel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: async () => {
          await new Promise<void>((resolve) => (finishInstallGate.open = resolve));
          return { current: "0.1.0", latest: "0.2.0", available: false, releases: null };
        },
      },
      restartForUpdate: () => restarts.push("restart"),
    });
    setEva(instance);
    const installing = instance.updateNow();
    await waitFor(() => finishInstallGate.open !== null);
    expect(instance.updateEngine()?.phase).toBe("waiting_for_idle");
    finishInstallGate.open?.();
    await installing;
    expect(claudeRuns).toEqual([]);
    // The waiting engine update holds the restart, or the restart would lose it.
    expect(restarts).toEqual([]);
    await instance.backgroundTick();
    await waitFor(() => instance.engineUpdateStatus()?.last !== null);
    expect(claudeRuns).toEqual(["/opt/claude --version", "/opt/claude update", "/opt/claude --version"]);
    await instance.backgroundTick();
    expect(restarts).toEqual(["restart"]);
  });

  test("an update waits while a schedule fires, before its chat gets the prompt (lesson 92)", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({
        version: 1,
        schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }, { id: "Bad" }],
      }),
    );
    const instance = start(
      new FakeEngine(),
      {},
      {
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
      },
    );
    const releaseGate: { open: (() => void) | null } = { open: null };
    // The first check says the file problem; a slow front end keeps the check running.
    const unsubscribe = instance.schedules?.subscribe(
      () =>
        new Promise<boolean>((resolve) => {
          releaseGate.open = () => resolve(true);
        }),
    );
    const check = instance.schedules?.tick();
    await waitFor(() => releaseGate.open !== null);
    expect((await instance.updateNow())?.phase).toBe("waiting_for_idle");
    unsubscribe?.();
    releaseGate.open?.();
    await check;
  });

  test("an Eva with no claude program has no engine update", () => {
    const instance = start(new FakeEngine());
    expect(instance.engineUpdateStatus()).toBeNull();
    expect(instance.updateEngine()).toBeNull();
  });

  test("voice notes stay off until a whisper model is configured", () => {
    expect(start(new FakeEngine()).transcribe).toBeNull();
    const voice = { ...defaultConfig.voice, modelPath: "/models/ggml-base.bin" };
    expect(start(new FakeEngine(), { voice }).transcribe).toBeInstanceOf(Function);
  });

  test("the idle sweep waits while an Assistant turn runs (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    sandbox.write(vault, "half.md", "half written\n");
    expect(await instance.sweep()).toBe("skipped");
    release();
    await turn;
  });

  test("with no vault configured, Eva still starts and says so", () => {
    const eva = setEva(
      new Eva({
        paths: homePaths(home),
        config: { ...defaultConfig, vaultPath: null },
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => new Date(),
        basePrompt: "Base.",
        gatherMs: 5,
      }),
    );
    expect(eva.status().vaultPath).toBeNull();
    expect(() => eva.createAssistantSession({ source: "cli" })).toThrow("vault");
    // The page and Telegram read this text too, and neither can run a terminal command.
    expect(() => eva.createAssistantSession({ source: "web" })).toThrow("Finish the setup in Settings, on Eva's page.");
  });
});

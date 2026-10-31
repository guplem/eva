#!/usr/bin/env bun
/**
 * Eva's entry point. It only wires the layers together, so it holds almost no decision of its own;
 * every piece it joins has its own tests. The engine choice stays here, because only this file may
 * name an engine adapter.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { locateEngineProgram, pathWithOwnGh, pathWithUvFolder } from "./core/engine-install/engine-install.ts";
import { locateVoiceProgram, ownVoicePrograms } from "./core/engine-install/voice-install.ts";
import { Eva } from "./core/eva.ts";
import { shellWallGap } from "./core/shell-wall.ts";
import { acquireInstanceLock, isProcessAlive, readBootId } from "./core/instance/instance-lock.ts";
import { newCopyLaunch, waitForOldCopy } from "./core/instance/new-copy.ts";
import { clearRunMarker, startRunMarker } from "./core/instance/run-marker.ts";
import { hardExitGraceMs, shutdownDeadlineMs, stopSequence } from "./core/instance/shutdown.ts";
import { prepareStart } from "./core/instance/startup.ts";
import { assistantBasePrompt } from "./core/modes/assistant-base-prompt.ts";
import { createHomeFolders, instanceNameOf, type EvaConfig, type HomePaths } from "./core/settings/home.ts";
import { ClaudeCodeEngine } from "./engines/claude-code/claude-code-adapter.ts";
import { PiEngine } from "./engines/pi/pi-adapter.ts";
import { startLocalApi } from "./frontends/api/local-api.ts";
import { describeFailure, runCli } from "./frontends/cli/commands.ts";
import { terminalDeviceApprover } from "./frontends/cli/devices.ts";
import {
  evaCommand,
  remoteAccessWatcher,
  mutableOutput,
  withLinePrompt,
  writeLine,
  type CliHost,
} from "./frontends/cli/host.ts";
import { updateChannel } from "./frontends/cli/local-commands.ts";
import { restartMethodNow } from "./frontends/cli/service.ts";
import { HubTelegram, startTelegram } from "./frontends/telegram/telegram-start.ts";
import type { EngineName, EnginePort } from "./shared/engine-port.ts";
import { FileLogger, type Logger } from "./shared/logger.ts";
import { systemLongProcessStarter } from "./shared/long-process.ts";
import { systemLineProcessStarter } from "./shared/line-process.ts";
import { systemProcessRunner } from "./shared/process-runner.ts";
import { Redactor } from "./shared/redaction.ts";
import { exitCodes } from "./shared/exit-codes.ts";
import { evaVersion } from "./shared/version.ts";

/** Within the minute that the person waits for the address; `tailscale status` is a cheap read. */
const tailscaleReadMs = 30_000;

// Before anything reads the environment: every child, the agents' too, finds the gh and the uv that Eva installs.
process.env[process.env["PATH"] === undefined && process.env["Path"] !== undefined ? "Path" : "PATH"] =
  pathWithUvFolder({ PATH: pathWithOwnGh(process.env, process.platform, homedir()) }, process.platform, homedir());

const host: CliHost = {
  environment: process.env,
  platform: process.platform,
  arch: process.arch,
  userHome: homedir(),
  // Lazy: userInfo() throws for a uid with no passwd entry, and only doctor and the service install read it.
  get userName() {
    return userInfo().username;
  },
  hostName: hostname(),
  pid: process.pid,
  parentPid: () => process.ppid,
  runner: systemProcessRunner,
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  interactive: process.stdin.isTTY,
  outputIsTerminal: process.stdout.isTTY,
  withPrompt: (work) => {
    // A hidden answer, such as the vault password, needs a terminal output that can stop its echo.
    const { output, mute } = mutableOutput(process.stdout);
    return withLinePrompt(
      createInterface({ input: process.stdin, output, terminal: process.stdout.isTTY }),
      work,
      mute,
    );
  },
  sleep: (ms) => Bun.sleep(ms),
  // A `bun build --compile` executable runs its code from Bun's embedded file system.
  standalone: Bun.main.includes("$bunfs") || Bun.main.includes("~BUN"),
  execPath: process.execPath,
  mainScript: join(import.meta.dir, "main.ts"),
  sourceFolder: dirname(import.meta.dir),
  isProcessAlive,
  bootId: readBootId(process.platform),
  onStopSignal: (handler) => {
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  },
};

/** The engine's program: the one that the settings name, or one found on the disk now. */
function locateEngine(config: EvaConfig, engine: EngineName): string | null {
  const configured = engine === "claude-code" ? config.engines.claudeCode.executable : config.engines.pi.executable;
  // A service keeps the PATH from its install, which can lack the folder of a later engine install.
  return (
    configured ??
    locateEngineProgram(engine, {
      platform: host.platform,
      homeFolder: host.userHome,
      environment: host.environment,
      which: (name: string) => Bun.which(name),
      exists: existsSync,
    })
  );
}

/** Only this file may name an engine adapter. Also gives the claude program, for the engine update. */
function createEngines(
  config: EvaConfig,
  paths: HomePaths,
  logger: Logger,
): { engines: EnginePort[]; claudeExecutable: string | null } {
  const engines: EnginePort[] = [];
  const claudeExecutable = locateEngine(config, "claude-code");
  if (claudeExecutable === null)
    logger.log("warn", "No claude program found; Claude Code chats will fail. Run `eva doctor`.");
  else
    engines.push(
      new ClaudeCodeEngine({ executable: claudeExecutable, permissionMode: config.engines.claudeCode.permissionMode }),
    );
  const piExecutable = locateEngine(config, "pi");
  if (piExecutable !== null) {
    engines.push(
      new PiEngine({
        command: [piExecutable],
        workFolder: join(paths.enginesFolder, "pi"),
        models: config.engines.pi.models,
      }),
    );
  }
  return { engines, claudeExecutable };
}

/** The voice programs that the settings name, or Eva's own copies, which a service may not have on its PATH. */
function withVoicePrograms(config: EvaConfig): EvaConfig {
  const own = ownVoicePrograms(host.platform, host.userHome, host.environment);
  const places = { which: (name: string) => Bun.which(name), exists: existsSync };
  return {
    ...config,
    voice: {
      ...config.voice,
      ffmpegExecutable: locateVoiceProgram(config.voice.ffmpegExecutable, own.ffmpeg, places),
      whisperExecutable: locateVoiceProgram(config.voice.whisperExecutable, own.whisper, places),
    },
  };
}

/** After an update without a supervisor, the new copy starts first and waits for this one. */
function startNewCopy(paths: HomePaths): void {
  const launch = newCopyLaunch({
    evaCommand: evaCommand(host),
    arguments: process.argv.slice(2),
    environment: process.env,
    instance: instanceNameOf(paths),
    pid: host.pid,
  });
  const [program = process.execPath, ...arguments_] = launch.command;
  // No seam fits a child that outlives Eva: the process runner waits for its end, and the long
  // process starter keeps it attached to Eva's output.
  spawn(program, arguments_, { detached: true, stdio: "ignore", windowsHide: true, env: launch.environment }).unref();
}

/** `eva` and `eva run`: the whole Eva, until a signal, an update or a restart stops her. */
async function serve(paths: HomePaths): Promise<number> {
  createHomeFolders(paths);
  await waitForOldCopy({
    environment: process.env,
    isProcessAlive,
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
  });
  // Replaced by a logged stop once the logger and the stop sequence exist.
  let lockLost = (): void => process.exit(exitCodes.crash);
  // Before the migrations, so a second start never changes the files under a running Eva.
  const lock = await acquireInstanceLock(paths.lock, {
    pid: host.pid,
    bootId: host.bootId,
    isProcessAlive,
    sleep: (ms) => Bun.sleep(ms),
    onLost: () => {
      lockLost();
    },
  });
  const { config, secrets, notes, migrations } = await prepareStart({
    paths,
    runner: systemProcessRunner,
    processEnvironment: process.env,
    hostName: hostname(),
    now: () => new Date(),
    newToken: () => randomBytes(24).toString("base64url"),
  });
  const startedAfterUncleanExit = startRunMarker(paths.runningMarker, new Date());

  const redactor = new Redactor();
  for (const secret of Object.values(secrets)) redactor.addSecret(secret);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor, now: () => new Date() });
  for (const note of notes) logger.log(note.level, note.message, note.fields);
  // The first read happens before the local API starts, so a ready tailnet's host is known at once.
  const remoteAccess = config.remoteAccess.tailscaleServe
    ? remoteAccessWatcher(host, config.port, (access) => {
        logger.log(access.step === "failed" ? "warn" : "info", "Tailscale access.", { ...access });
      })
    : null;
  await remoteAccess?.refresh();

  let stop: (exitCode: number) => void = () => undefined;
  const { engines, claudeExecutable } = createEngines(config, paths, logger);
  const eva = new Eva({
    paths,
    config: withVoicePrograms(config),
    secrets,
    engines,
    shellWallGap: () => shellWallGap({ platform: process.platform, which: (name) => Bun.which(name) }),
    runner: systemProcessRunner,
    processEnvironment: process.env,
    now: () => new Date(),
    basePrompt: assistantBasePrompt,
    logger,
    removeOldLogs: () => {
      logger.removeOldFiles();
    },
    evaCommand: evaCommand(host),
    updateChannel: updateChannel(host, secrets),
    restartForUpdate: () => {
      stop(exitCodes.update);
    },
    claudeExecutable,
    locateEngine: (engine) => locateEngine(config, engine),
    remoteAccess,
    toolPlaces: { platform: host.platform, userHome: host.userHome, standalone: host.standalone },
  });
  // A person at Eva's terminal can always allow a new browser, with or without Telegram.
  eva.deviceLogins.attachApprover(terminalDeviceApprover);
  // Tailscale can arrive, sign in or turn HTTPS on after the start: the person never needs a restart.
  remoteAccess?.watch(tailscaleReadMs);
  // A promise that nobody awaits must never end Eva silently (lesson 50).
  process.on("unhandledRejection", (reason: unknown) => {
    logger.log("error", "A background task failed.", {
      reason: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    });
  });
  // An exception that nobody catches leaves the core in an unknown state: log it, and let the service restart Eva.
  process.on("uncaughtException", (error: Error) => {
    logger.log("error", "Eva stopped on an error that nobody caught.", { reason: error.stack ?? error.message });
    lock.release();
    process.exit(exitCodes.crash);
  });
  eva.startBackgroundWork();
  const api = startLocalApi({
    eva,
    port: config.port,
    token: secrets.localApiToken,
    extraHosts: config.remoteAccess.hostNames,
    allowedTailscaleIdentities: config.remoteAccess.allowedTailscaleIdentities,
    tailnet: () => remoteAccess?.tailnet() ?? null,
    logger,
  });
  logger.log("info", "Eva started.", { version: evaVersion, url: api.url });
  writeLine(
    host,
    `Eva ${evaVersion} runs on ${api.url}. Vault: ${config.vaultPath ?? "not configured (run eva setup)"}.`,
  );

  const telegram = new HubTelegram(eva, () =>
    startTelegram({ paths, eva, logger, writeLine: (line) => writeLine(host, line) }),
  );
  // After the bot starts, so that the alert reaches Telegram too.
  if (startedAfterUncleanExit) eva.reportUncleanExit();
  eva.reportStartMigrations(migrations);
  eva.noticeDefaultEngine();
  const stopEva = stopSequence({
    stopParts: async () => {
      remoteAccess?.stop();
      eva.stop();
      await telegram.stop();
      api.stop();
    },
    release: () => {
      clearRunMarker(paths.runningMarker);
      lock.release();
    },
    logger,
    deadlineMs: shutdownDeadlineMs,
    armHardExit: (exitCode) => {
      setTimeout(() => process.exit(exitCode), shutdownDeadlineMs + hardExitGraceMs).unref();
    },
    startNewCopy: () => {
      if (restartMethodNow(host) !== "new-copy") return false;
      startNewCopy(paths);
      return true;
    },
  });
  return new Promise<number>((resolve) => {
    stop = (exitCode) => {
      void stopEva(exitCode).then(resolve);
    };
    lockLost = () => {
      logger.log("error", "Another Eva took over this home folder, so this one stops.");
      stop(exitCodes.crash);
    };
    host.onStopSignal(() => {
      stop(exitCodes.clean);
    });
  });
}

runCli(process.argv.slice(2), host, {
  serve,
  startLongProcess: systemLongProcessStarter,
  startLineProcess: systemLineProcessStarter,
})
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const failure = describeFailure(error);
    process.stderr.write(failure.text);
    process.exit(failure.exitCode);
  });

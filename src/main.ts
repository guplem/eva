#!/usr/bin/env bun
/**
 * Eva's entry point. It only wires the layers together, so it holds no decision worth a test;
 * every piece it joins has its own tests.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Eva } from "./core/eva.ts";
import { acquireInstanceLock, isProcessAlive, readBootId } from "./core/instance/instance-lock.ts";
import { newCopyLaunch, waitForOldCopy } from "./core/instance/new-copy.ts";
import { clearRunMarker, startRunMarker } from "./core/instance/run-marker.ts";
import { hardExitGraceMs, shutdownDeadlineMs, stopSequence } from "./core/instance/shutdown.ts";
import { prepareStart } from "./core/instance/startup.ts";
import { assistantBasePrompt } from "./core/modes/assistant-base-prompt.ts";
import { allowedTailscaleIdentities, TailscalePublisher } from "./core/remote-access/tailscale.ts";
import { createHomeFolders, type EvaConfig, type HomePaths } from "./core/settings/home.ts";
import { ClaudeCodeEngine } from "./engines/claude-code/claude-code-adapter.ts";
import { PiEngine } from "./engines/pi/pi-adapter.ts";
import { startLocalApi } from "./frontends/api/local-api.ts";
import { describeFailure, runCli } from "./frontends/cli/commands.ts";
import {
  childEnvironment,
  defaultHomeFolder,
  evaCommand,
  updateChannel,
  writeLine,
  type CliHost,
} from "./frontends/cli/host.ts";
import { restartMethod } from "./frontends/cli/service.ts";
import { HubTelegram, startTelegram } from "./frontends/telegram/telegram-start.ts";
import type { EnginePort } from "./shared/engine-port.ts";
import { FileLogger, type Logger } from "./shared/logger.ts";
import { systemLongProcessStarter } from "./shared/long-process.ts";
import { systemProcessRunner } from "./shared/process-runner.ts";
import { Redactor } from "./shared/redaction.ts";
import { exitCodes } from "./shared/exit-codes.ts";
import { evaVersion } from "./shared/version.ts";

const tailscaleRetryMs = 60_000;

const host: CliHost = {
  environment: process.env,
  platform: process.platform,
  arch: process.arch,
  userHome: homedir(),
  userName: userInfo().username,
  hostName: hostname(),
  pid: process.pid,
  parentPid: process.ppid,
  runner: systemProcessRunner,
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  withPrompt: async (work) => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await work((question) => prompt.question(question));
    } finally {
      prompt.close();
    }
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

/** Only this file may name an engine adapter. Also gives the claude program, for the engine update. */
function createEngines(
  config: EvaConfig,
  paths: HomePaths,
  logger: Logger,
): { engines: EnginePort[]; claudeExecutable: string | null } {
  const engines: EnginePort[] = [];
  const claudeExecutable = config.engines.claudeCode.executable ?? Bun.which("claude");
  if (claudeExecutable === null)
    logger.log("warn", "No claude program found; Claude Code chats will fail. Run `eva doctor`.");
  else engines.push(new ClaudeCodeEngine({ executable: claudeExecutable }));
  const piExecutable = config.engines.pi.executable ?? Bun.which("pi");
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

/** After an update without a supervisor, the new copy starts first and waits for this one. */
function startNewCopy(): void {
  const launch = newCopyLaunch({
    evaCommand: evaCommand(host),
    arguments: process.argv.slice(2),
    environment: process.env,
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
  const { config, secrets, notes } = await prepareStart({
    paths,
    runner: systemProcessRunner,
    processEnvironment: process.env,
    hostName: hostname(),
    now: () => new Date(),
    newToken: () => randomBytes(24).toString("base64url"),
  });
  const tailscale = await TailscalePublisher.start({
    enabled: config.remoteAccess.tailscaleServe,
    runner: systemProcessRunner,
    environment: childEnvironment(host),
    port: config.port,
  });
  const lock = acquireInstanceLock(paths.lock, { pid: host.pid, bootId: host.bootId, isProcessAlive });
  const startedAfterUncleanExit = startRunMarker(paths.runningMarker, new Date());

  const redactor = new Redactor();
  for (const secret of Object.values(secrets)) redactor.addSecret(secret);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor, now: () => new Date() });
  for (const note of notes) logger.log(note.level, note.message, note.fields);
  const access = tailscale.access();
  if (access !== null) logger.log(access.url === null ? "warn" : "info", "Tailscale access.", { ...access });

  let stop: (exitCode: number) => void = () => undefined;
  const { engines, claudeExecutable } = createEngines(config, paths, logger);
  const eva = new Eva({
    paths,
    config,
    secrets,
    engines,
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
    remoteAccess: () => tailscale.access(),
    defaultHome: defaultHomeFolder(host),
  });
  const publishRetry = setInterval(() => {
    void tailscale.retry().then((published) => {
      if (published) logger.log("info", "Tailscale access.", { ...tailscale.access() });
    });
  }, tailscaleRetryMs);
  eva.sessions.subscribe((event) => {
    if (event.kind === "turn_failed")
      logger.log("warn", "A turn failed.", { sessionId: event.sessionId, reason: event.reason });
    // The cache counts go in the log too, so a broken prompt cache shows (lesson 120).
    if (event.kind === "turn_finished")
      logger.log("info", "A turn finished.", { sessionId: event.sessionId, ...event.usage });
  });
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
  const tailnetHost = tailscale.hostName();
  const api = startLocalApi({
    eva,
    port: config.port,
    token: secrets.localApiToken,
    extraHosts: [...config.remoteAccess.hostNames, ...(tailnetHost === null ? [] : [tailnetHost])],
    allowedTailscaleIdentities: allowedTailscaleIdentities(
      config.remoteAccess.allowedTailscaleIdentities,
      tailscale.ownerLogin(),
    ),
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
  const stopEva = stopSequence({
    stopParts: async () => {
      clearInterval(publishRetry);
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
      if (restartMethod(host.environment, host.isProcessAlive, host.parentPid) !== "new-copy") return false;
      startNewCopy();
      return true;
    },
  });
  return new Promise<number>((resolve) => {
    stop = (exitCode) => {
      void stopEva(exitCode).then(resolve);
    };
    host.onStopSignal(() => {
      stop(exitCodes.clean);
    });
  });
}

runCli(process.argv.slice(2), host, { serve, startLongProcess: systemLongProcessStarter })
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const failure = describeFailure(error);
    process.stderr.write(failure.text);
    process.exit(failure.exitCode);
  });

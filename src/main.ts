#!/usr/bin/env bun
/**
 * Eva's entry point. It only wires the layers together (docs/plan.md §4.2), so it holds no
 * decision worth a test; every piece it joins has its own tests.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Eva } from "./core/eva.ts";
import {
  homePaths,
  loadConfig,
  loadSecrets,
  resolveHomeFolder,
  saveConfig,
  saveSecrets,
  type HomePaths,
} from "./core/instance/home.ts";
import { acquireInstanceLock, isProcessAlive } from "./core/instance/instance-lock.ts";
import { assistantBasePrompt } from "./core/modes/assistant-base-prompt.ts";
import { ClaudeCodeEngine } from "./engines/claude-code/claude-code-adapter.ts";
import { PiEngine } from "./engines/pi/pi-adapter.ts";
import { startLocalApi } from "./frontends/api/local-api.ts";
import { parseArguments, usageText, type CliCommand } from "./frontends/cli/arguments.ts";
import { runChat } from "./frontends/cli/chat.ts";
import { describeProjects, describeStatus } from "./frontends/cli/client.ts";
import { runDoctor } from "./frontends/cli/doctor.ts";
import { systemdUnit, windowsTaskCommand } from "./frontends/cli/service.ts";
import { runSetup, setupEnvironmentNames } from "./frontends/cli/setup.ts";
import { HttpTelegramApi } from "./frontends/telegram/telegram-api.ts";
import { TelegramBot } from "./frontends/telegram/telegram-bot.ts";
import type { EnginePort } from "./shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment } from "./shared/environment.ts";
import { isEvaError } from "./shared/errors.ts";
import { exitCodes } from "./shared/exit-codes.ts";
import { writeFileAtomic } from "./shared/files.ts";
import { FileLogger } from "./shared/logger.ts";
import { systemProcessRunner } from "./shared/process-runner.ts";
import { Redactor } from "./shared/redaction.ts";
import { evaVersion } from "./shared/version.ts";
import { updateExecutable } from "./core/updates/self-update.ts";

function write(text: string): void {
  process.stdout.write(text);
}

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  const command = parseArguments(argv);
  if (command.command === "usage-error") {
    process.stderr.write(`${command.message}\n\n${usageText}`);
    return exitCodes.badConfig;
  }
  if (command.command === "help") {
    write(usageText);
    return exitCodes.clean;
  }
  if (command.command === "version") {
    writeLine(evaVersion);
    return exitCodes.clean;
  }
  if (command.command === "update") return update();
  const paths = homePaths(
    resolveHomeFolder({
      flag: command.home,
      environment: process.env,
      platform: process.platform,
      userHome: homedir(),
    }),
  );

  switch (command.command) {
    case "doctor": {
      const healthy = await runDoctor({
        runner: systemProcessRunner,
        environment: childEnvironment(),
        write: writeLine,
        standalone: isStandalone(),
      });
      return healthy ? exitCodes.clean : exitCodes.crash;
    }
    case "setup": {
      const setupOptions = {
        paths,
        write: writeLine,
        newToken: () => randomBytes(24).toString("base64url"),
        runner: systemProcessRunner,
        environment: childEnvironment(),
      };
      if (command.nonInteractive) {
        await runSetup({
          ...setupOptions,
          interactive: false,
          ask: (key) => Promise.resolve(process.env[setupEnvironmentNames[key]] ?? ""),
        });
      } else {
        await withPrompt(async (ask) => {
          await runSetup({ ...setupOptions, interactive: true, ask: (_key, question) => ask(question) });
        });
      }
      return exitCodes.clean;
    }
    case "service-install":
      return installService(paths);
    case "status":
    case "projects":
    case "chat":
      return runClientCommand(command, paths);
    case "run":
      return serve(paths);
  }
}

async function runClientCommand(
  command: Extract<CliCommand, { command: "status" | "projects" | "chat" }>,
  paths: HomePaths,
): Promise<number> {
  const config = loadConfig(paths);
  const token = loadSecrets(paths).localApiToken;
  if (token === undefined) {
    process.stderr.write("No local token yet. Run `eva setup` first.\n");
    return exitCodes.badConfig;
  }
  const baseUrl = `http://127.0.0.1:${String(config.port)}`;
  try {
    if (command.command === "status") {
      const codePath = pairingCodePath(paths);
      writeLine(
        await describeStatus({ baseUrl, token }, existsSync(codePath) ? readFileSync(codePath, "utf-8").trim() : null),
      );
    } else if (command.command === "projects") writeLine(await describeProjects({ baseUrl, token }, command.query));
    else {
      await withPrompt(async (ask) => {
        await runChat({
          baseUrl,
          token,
          mode: command.projectId === undefined ? "assistant" : "project",
          model: command.model ?? config.engines.claudeCode.defaultModel,
          ...(command.projectId === undefined ? {} : { projectId: command.projectId }),
          ...(command.clone === undefined ? {} : { clone: command.clone }),
          readLine: async () => {
            try {
              return await ask("");
            } catch {
              return null;
            }
          },
          write,
        });
      });
    }
    return exitCodes.clean;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\nIs Eva running? Start her with \`eva\`.\n`,
    );
    return exitCodes.crash;
  }
}

async function serve(paths: HomePaths): Promise<number> {
  mkdirSync(paths.root, { recursive: true });
  const config = loadConfig(paths);
  const secrets = { ...loadSecrets(paths) };
  if (secrets.localApiToken === undefined) {
    secrets.localApiToken = randomBytes(24).toString("base64url");
    saveSecrets(paths, secrets);
  }
  const lock = acquireInstanceLock(paths.lock, { pid: process.pid, isProcessAlive });

  const redactor = new Redactor();
  for (const secret of Object.values(secrets)) redactor.addSecret(secret);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor, now: () => new Date() });
  logger.removeOldFiles();

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
        model: config.engines.pi.model,
      }),
    );
  }

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
  });
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
  eva.startBackgroundWork();
  const api = startLocalApi({
    eva,
    port: config.port,
    token: secrets.localApiToken,
    extraHosts: config.remoteAccess.hostNames,
    allowedTailscaleIdentities: config.remoteAccess.allowedTailscaleIdentities,
  });
  logger.log("info", "Eva started.", { version: evaVersion, url: api.url });
  writeLine(`Eva ${evaVersion} runs on ${api.url}. Vault: ${config.vaultPath ?? "not configured (run eva setup)"}.`);

  return new Promise<number>((resolve) => {
    let bot: TelegramBot | null = null;
    const stop = (exitCode: number): void => {
      void (async () => {
        await bot?.stop();
        api.stop();
        eva.stop();
        lock.release();
        logger.log("info", "Eva stopped.", { exitCode });
        resolve(exitCode);
      })();
    };
    bot = startTelegram(paths, eva, logger, (exitCode) => {
      stop(exitCode);
    });
    process.once("SIGINT", () => {
      stop(exitCodes.clean);
    });
    process.once("SIGTERM", () => {
      stop(exitCodes.clean);
    });
  });
}

/** Telegram runs on the hub instance only (plan §4.4, lesson 56). */
function startTelegram(
  paths: HomePaths,
  eva: Eva,
  logger: FileLogger,
  onFatal: (exitCode: number) => void,
): TelegramBot | null {
  const config = loadConfig(paths);
  const token = loadSecrets(paths).telegramBotToken;
  if (config.role !== "hub" || !config.telegram.enabled || token === undefined) return null;
  let pairingCode = "";
  if (config.telegram.allowedChatId === null) {
    pairingCode = `EVA-${randomBytes(4).toString("hex").toUpperCase()}`;
    writeFileAtomic(pairingCodePath(paths), pairingCode);
    writeLine(`Telegram is not paired yet. Send ${pairingCode} to your bot.`);
  }
  const bot = new TelegramBot({
    api: new HttpTelegramApi({ token }),
    eva,
    statePath: paths.telegramState,
    allowedChatId: config.telegram.allowedChatId,
    allowedUserId: config.telegram.allowedUserId,
    pairingCode,
    onPaired: (chatId, userId) => {
      const current = loadConfig(paths);
      saveConfig(paths, {
        ...current,
        telegram: { ...current.telegram, allowedChatId: chatId, allowedUserId: userId },
      });
      rmSync(pairingCodePath(paths), { force: true });
      logger.log("info", "Telegram paired.");
    },
    onFatal,
    logger,
    ...(eva.transcribe === null ? {} : { transcribe: eva.transcribe }),
  });
  void bot.run();
  return bot;
}

function pairingCodePath(paths: HomePaths): string {
  return join(paths.stateFolder, "telegram-pairing-code.txt");
}

async function installService(paths: HomePaths): Promise<number> {
  const executable = [process.execPath, join(import.meta.dir, "main.ts")];
  if (process.platform === "win32") {
    const result = await systemProcessRunner.run(windowsTaskCommand({ executable, home: paths.root }), {
      cwd: paths.root,
      environment: childEnvironment(),
      timeoutMs: 30_000,
    });
    writeLine(result.exitCode === 0 ? "Eva now starts when you log in." : `schtasks failed: ${result.stderr.trim()}`);
    return result.exitCode === 0 ? exitCodes.clean : exitCodes.crash;
  }
  const unitPath = join(homedir(), ".config", "systemd", "user", "eva.service");
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, systemdUnit({ executable, home: paths.root, path: process.env["PATH"] ?? "/usr/bin:/bin" }));
  for (const step of [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", "eva.service"],
  ]) {
    const result = await systemProcessRunner.run(step, {
      cwd: paths.root,
      environment: childEnvironment(),
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      writeLine(`${step.join(" ")} failed: ${result.stderr.trim()}`);
      return exitCodes.crash;
    }
  }
  writeLine(`Installed ${unitPath}. Run \`loginctl enable-linger\` once so Eva runs while you are logged out.`);
  return exitCodes.clean;
}

async function withPrompt(work: (ask: (question: string) => Promise<string>) => Promise<void>): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await work((question) => prompt.question(question));
  } finally {
    prompt.close();
  }
}

/** `eva update`: only the single executable updates itself; a source checkout uses git. */
async function update(): Promise<number> {
  if (!isStandalone()) {
    writeLine("Eva runs from source here. Update it with `git pull` and `bun install`.");
    return exitCodes.clean;
  }
  const result = await updateExecutable({
    currentVersion: evaVersion,
    executablePath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    runner: systemProcessRunner,
    environment: childEnvironment(),
  });
  writeLine(
    result.status === "up_to_date"
      ? `Eva ${result.version} is the latest version.`
      : `Updated Eva from ${result.from} to ${result.to}. Restart Eva to use it.`,
  );
  return exitCodes.clean;
}

/** A `bun build --compile` executable runs its code from Bun's embedded file system. */
function isStandalone(): boolean {
  return Bun.main.includes("$bunfs") || Bun.main.includes("~BUN");
}

function childEnvironment(): Record<string, string> {
  return buildChildEnvironment(process.env, baseEnvironmentAllowlist);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (isEvaError(error, "config_invalid")) {
      process.stderr.write(`${error.message}\n`);
      process.exit(exitCodes.badConfig);
    }
    if (isEvaError(error, "instance_locked")) {
      process.stderr.write(`${error.message}\n`);
      process.exit(exitCodes.secondInstance);
    }
    if (isEvaError(error)) {
      // An expected failure, such as a refused update: its message says what to do, no stack needed.
      process.stderr.write(`${error.message}\n`);
      process.exit(exitCodes.crash);
    }
    process.stderr.write(
      `Eva stopped on an error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(exitCodes.crash);
  });

#!/usr/bin/env bun
/**
 * Eva's entry point. It only wires the layers together, so it holds no
 * decision worth a test; every piece it joins has its own tests.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Eva } from "./core/eva.ts";
import {
  createHomeFolders,
  homePaths,
  loadConfig,
  loadSecrets,
  resolveHomeFolder,
  saveSecrets,
  type EvaSecrets,
  type HomePaths,
} from "./core/settings/home.ts";
import { acquireInstanceLock, isProcessAlive, readBootId, runningInstancePid } from "./core/instance/instance-lock.ts";
import { clearRunMarker, startRunMarker } from "./core/instance/run-marker.ts";
import { stopWithinDeadline } from "./core/instance/shutdown.ts";
import { superviseEva } from "./core/instance/supervisor.ts";
import {
  changeSettings,
  describeSettings,
  isSharedSettingKey,
  loadSettings,
  moveSecuritySettingsFromVault,
  moveSettingsToVault,
  settingChange,
} from "./core/settings/settings.ts";
import { executableUpdateChannel } from "./core/updates/self-update.ts";
import { sourceUpdateChannel } from "./core/updates/source-update.ts";
import type { UpdateChannel } from "./core/updates/updater.ts";
import { githubTokenVariable } from "./core/vault/vault-clone.ts";
import { VaultSync } from "./core/vault/vault-sync.ts";
import { assistantBasePrompt } from "./core/modes/assistant-base-prompt.ts";
import { ClaudeCodeEngine } from "./engines/claude-code/claude-code-adapter.ts";
import { PiEngine } from "./engines/pi/pi-adapter.ts";
import { startLocalApi } from "./frontends/api/local-api.ts";
import { parseArguments, usageText, type CliCommand } from "./frontends/cli/arguments.ts";
import { runChat } from "./frontends/cli/chat.ts";
import {
  describeProjects,
  describeStatus,
  describeSync,
  requestHub,
  requestStatus,
  requestSettingsChange,
  requestSync,
  requestUpdate,
  startProjectWork,
  type ClientOptions,
} from "./frontends/cli/client.ts";
import { runDoctor } from "./frontends/cli/doctor.ts";
import {
  restartMethod,
  serviceCommand,
  serviceName,
  servicePath,
  systemdUnit,
  windowsRunTaskCommand,
  windowsTaskSettingsCommand,
  windowsTaskCommand,
} from "./frontends/cli/service.ts";
import { claimHub, claimHubIfUnclaimed, type MachineRole } from "./core/instance/hub.ts";
import { publishWithTailscale, readTailscale } from "./core/remote-access/tailscale.ts";
import { runSetup, setupEnvironmentNames } from "./frontends/cli/setup.ts";
import { describeAccess, runNetworkSetup } from "./frontends/cli/network-setup.ts";
import { HttpTelegramApi } from "./frontends/telegram/telegram-api.ts";
import { TelegramBot } from "./frontends/telegram/telegram-bot.ts";
import type { EnginePort } from "./shared/engine-port.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment } from "./shared/environment.ts";
import { isEvaError } from "./shared/errors.ts";
import { exitCodes } from "./shared/exit-codes.ts";
import { writeFileAtomic } from "./shared/files.ts";
import { FileLogger } from "./shared/logger.ts";
import { systemLongProcessStarter } from "./shared/long-process.ts";
import { systemProcessRunner } from "./shared/process-runner.ts";
import { Redactor } from "./shared/redaction.ts";
import { evaVersion } from "./shared/version.ts";

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
  const paths = homePaths(
    resolveHomeFolder({
      flag: command.home,
      environment: process.env,
      platform: process.platform,
      userHome: homedir(),
    }),
  );

  switch (command.command) {
    case "doctor":
      return (await doctor(paths)) ? exitCodes.clean : exitCodes.crash;
    case "setup": {
      // The setup order starts with the doctor: a missing tool shows before any question.
      await doctor(paths);
      createHomeFolders(paths);
      const setupOptions = {
        paths,
        write: writeLine,
        newToken: () => randomBytes(24).toString("base64url"),
        runner: systemProcessRunner,
        environment: childEnvironment(),
      };
      const networkOptions = {
        runner: systemProcessRunner,
        environment: childEnvironment(),
        write: writeLine,
        sleep: (ms: number) => Bun.sleep(ms),
      };
      if (command.nonInteractive) {
        await runSetup({
          ...setupOptions,
          interactive: false,
          ask: (key) => Promise.resolve(process.env[setupEnvironmentNames[key]] ?? ""),
        });
        await runNetworkSetup({
          ...networkOptions,
          interactive: false,
          ask: () => Promise.resolve(""),
          port: loadSettings(paths).config.port,
        });
      } else {
        await withPrompt(async (ask) => {
          await runSetup({ ...setupOptions, interactive: true, ask: (_key, question) => ask(question) });
          // The last step: the address that opens Eva on every other device.
          await runNetworkSetup({ ...networkOptions, interactive: true, ask, port: loadSettings(paths).config.port });
        });
      }
      return exitCodes.clean;
    }
    case "service-install":
      return installService(paths);
    case "supervise":
      return supervise(paths);
    case "update":
      return update(paths, command.checkOnly);
    case "sync":
      return sync(paths);
    case "hub":
      return hub(paths);
    case "link":
      return link(paths);
    case "settings":
      return settings(paths, command);
    case "status":
    case "projects":
    case "chat":
    case "work":
      return runClientCommand(command, paths);
    case "run":
      return serve(paths);
  }
}

function doctor(paths: HomePaths): Promise<boolean> {
  return runDoctor({
    runner: systemProcessRunner,
    environment: childEnvironment(),
    write: writeLine,
    standalone: isStandalone(),
    platform: process.platform,
    userName: userInfo().username,
    defaultEngine: loadSettings(paths).config.engines.default,
  });
}

async function runClientCommand(
  command: Extract<CliCommand, { command: "status" | "projects" | "chat" | "work" }>,
  paths: HomePaths,
): Promise<number> {
  const config = loadSettings(paths).config;
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
    else if (command.command === "work") {
      writeLine(
        await startProjectWork(
          { baseUrl, token },
          {
            projectId: command.projectId,
            request: command.request,
            reportToSessionId: process.env["EVA_SESSION_ID"] ?? null,
          },
        ),
      );
    } else {
      await withPrompt(async (ask) => {
        await runChat({
          baseUrl,
          token,
          mode: command.projectId === undefined ? "assistant" : "project",
          model: command.model ?? config.engines.claudeCode.defaultModel,
          ...(command.projectId === undefined ? {} : { projectId: command.projectId }),
          ...(command.clone === undefined ? {} : { clone: command.clone }),
          ...(command.engine === undefined ? {} : { engine: command.engine }),
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
  createHomeFolders(paths);
  await waitForOldCopy();
  const secrets = { ...loadSecrets(paths) };
  const settingsMoved = await moveSettingsAfterPull(paths, secrets);
  const loaded = loadSettings(paths);
  const config = loaded.config;
  const hubClaimed =
    config.vaultPath !== null && claimHubIfUnclaimed(config.vaultPath, config.machineName ?? hostname(), new Date());
  const tailscale = config.remoteAccess.tailscaleServe
    ? await readTailscale(systemProcessRunner, childEnvironment())
    : null;
  const ownerLogin = tailscale?.ownerLogin ?? null;
  let remoteAccess =
    tailscale === null
      ? null
      : await publishWithTailscale(systemProcessRunner, childEnvironment(), tailscale, config.port);
  if (secrets.localApiToken === undefined) {
    secrets.localApiToken = randomBytes(24).toString("base64url");
    saveSecrets(paths, secrets);
  }
  const lock = acquireInstanceLock(paths.lock, {
    pid: process.pid,
    bootId: readBootId(process.platform),
    isProcessAlive,
  });
  const startedAfterUncleanExit = startRunMarker(paths.runningMarker, new Date());

  const redactor = new Redactor();
  for (const secret of Object.values(secrets)) redactor.addSecret(secret);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor, now: () => new Date() });
  if (settingsMoved.toVault) logger.log("info", "Moved the shared settings from config.json to the vault.");
  if (settingsMoved.toMachine)
    logger.log("info", "Moved the security settings from the vault to config.json; the vault's copy is ignored now.");
  if (loaded.problem !== null) logger.log("warn", "The vault's settings were not used.", { problem: loaded.problem });
  if (hubClaimed) logger.log("info", "No machine was the hub yet, so this machine claimed it.");
  if (remoteAccess !== null)
    logger.log(remoteAccess.url === null ? "warn" : "info", "Tailscale access.", { ...remoteAccess });

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
    evaCommand: isStandalone() ? [process.execPath] : [process.execPath, Bun.main],
    updateChannel: updateChannel(secrets),
    restartForUpdate: () => {
      restart?.();
    },
    remoteAccess: () => remoteAccess,
    defaultHome: defaultHomeFolder(),
  });
  // Until the tailnet turns HTTPS on, Eva tries again, so the person never needs a restart.
  const publishRetry = setInterval(() => {
    if (tailscale === null || (remoteAccess !== null && remoteAccess.url !== null)) return;
    void readTailscale(systemProcessRunner, childEnvironment()).then(async (fresh) => {
      if (fresh === null) return;
      remoteAccess = await publishWithTailscale(systemProcessRunner, childEnvironment(), fresh, config.port);
      if (remoteAccess.url !== null) logger.log("info", "Tailscale access.", { ...remoteAccess });
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
  const api = startLocalApi({
    eva,
    port: config.port,
    token: secrets.localApiToken,
    extraHosts: [...config.remoteAccess.hostNames, ...(tailscale === null ? [] : [tailscale.hostName])],
    // Plug and play: with no list, only the account that owns this machine in Tailscale gets in.
    allowedTailscaleIdentities:
      config.remoteAccess.allowedTailscaleIdentities.length > 0 || ownerLogin === null
        ? config.remoteAccess.allowedTailscaleIdentities
        : [ownerLogin],
  });
  logger.log("info", "Eva started.", { version: evaVersion, url: api.url });
  writeLine(`Eva ${evaVersion} runs on ${api.url}. Vault: ${config.vaultPath ?? "not configured (run eva setup)"}.`);

  return new Promise<number>((resolve) => {
    let bot: TelegramBot | null = null;
    restart = () => {
      stop(exitCodes.update);
    };
    let stopping = false;
    const stop = (exitCode: number): void => {
      if (stopping) return;
      stopping = true;
      // The last guard: a stop that still hangs after its deadline ends the process here.
      setTimeout(() => process.exit(exitCode), shutdownDeadlineMs + hardExitGraceMs).unref();
      void (async () => {
        try {
          const outcome = await stopWithinDeadline(async () => {
            clearInterval(publishRetry);
            eva.stop();
            await bot?.stop();
            api.stop();
          }, shutdownDeadlineMs);
          if (outcome.kind !== "stopped") logger.log("warn", "Eva did not stop cleanly.", { ...outcome });
        } finally {
          clearRunMarker(paths.runningMarker);
          lock.release();
          logger.log("info", "Eva stopped.", { exitCode });
          if (exitCode === exitCodes.update && restartMethod(process.env, isProcessAlive) === "new-copy") {
            startNewCopy();
            resolve(exitCodes.clean);
          } else {
            resolve(exitCode);
          }
        }
      })();
    };
    // Only the hub runs Telegram; the bot starts or stops when the hub moves.
    const followRole = async (role: MachineRole): Promise<void> => {
      if (role === "hub" && bot === null) {
        bot = startTelegram(paths, eva, logger);
      } else if (role === "satellite" && bot !== null) {
        const stopping = bot;
        bot = null;
        await stopping.stop();
      }
    };
    void followRole(eva.role());
    eva.onRoleChange((role) => {
      void followRole(role);
    });
    // After the bot starts, so that the alert reaches Telegram too.
    if (startedAfterUncleanExit) eva.reportUncleanExit();
    process.once("SIGINT", () => {
      stop(exitCodes.clean);
    });
    process.once("SIGTERM", () => {
      stop(exitCodes.clean);
    });
  });
}

/** Telegram runs on the hub instance only (lesson 56), whenever it has a bot token. */
function startTelegram(paths: HomePaths, eva: Eva, logger: FileLogger): TelegramBot | null {
  const config = loadSettings(paths).config;
  const token = loadSecrets(paths).telegramBotToken;
  if (token === undefined) return null;
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
      changeSettings(paths, { telegram: { allowedChatId: chatId, allowedUserId: userId } });
      rmSync(pairingCodePath(paths), { force: true });
      logger.log("info", "Telegram paired.");
    },
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
  const executable = serviceCommand({
    standalone: isStandalone(),
    execPath: process.execPath,
    mainScript: join(import.meta.dir, "main.ts"),
  });
  const name = serviceName(paths.root, defaultHomeFolder());
  const runStep = (step: readonly string[]): ReturnType<typeof systemProcessRunner.run> =>
    systemProcessRunner.run(step, { cwd: paths.root, environment: childEnvironment(), timeoutMs: 30_000 });
  if (process.platform === "win32") {
    const created = await runStep(windowsTaskCommand({ executable, home: paths.root }, name));
    if (created.exitCode !== 0) {
      writeLine(`schtasks failed: ${created.stderr.trim()}`);
      writeLine("If it says that access is denied, open the terminal with Run as administrator, then try again.");
      return exitCodes.crash;
    }
    const settings = await runStep(windowsTaskSettingsCommand(name));
    if (settings.exitCode !== 0)
      writeLine(`Windows may stop Eva after three days, or on battery: ${settings.stderr.trim()}`);
    // A running Eva keeps the lock, so the new task's Eva would only exit 3.
    if (runningInstancePid(paths.lock, { bootId: readBootId(process.platform), isProcessAlive }) !== null) {
      writeLine("Eva now starts when you log in. She already runs, so the new task takes over at your next logon.");
      return exitCodes.clean;
    }
    const started = await runStep(windowsRunTaskCommand(name));
    writeLine(
      started.exitCode === 0
        ? "Eva now starts when you log in, and she runs now."
        : `Eva now starts when you log in. She did not start now: ${started.stderr.trim()}`,
    );
    return exitCodes.clean;
  }
  const unitPath = join(homedir(), ".config", "systemd", "user", `${name}.service`);
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(
    unitPath,
    systemdUnit({ executable, home: paths.root, path: servicePath(process.env["PATH"] ?? "/usr/bin:/bin") }),
  );
  for (const step of [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", `${name}.service`],
  ]) {
    const result = await runStep(step);
    if (result.exitCode !== 0) {
      writeLine(`${step.join(" ")} failed: ${result.stderr.trim()}`);
      return exitCodes.crash;
    }
  }
  writeLine(`Installed ${unitPath}. Eva runs now.`);
  // Linger keeps the user's services running after logout (lesson 85); Eva works without it.
  const linger = await runStep(["loginctl", "enable-linger"]);
  writeLine(
    linger.exitCode === 0
      ? "Eva keeps running when you log out."
      : `loginctl enable-linger failed: ${linger.stderr.trim()}. Eva stops when you log out until an administrator runs \`sudo loginctl enable-linger ${userInfo().username}\`.`,
  );
  return exitCodes.clean;
}

/** `eva supervise`: runs Eva as a child, and starts her again after a crash or an update. */
async function supervise(paths: HomePaths): Promise<number> {
  createHomeFolders(paths);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor: new Redactor(), now: () => new Date() });
  const command = serviceCommand({
    standalone: isStandalone(),
    execPath: process.execPath,
    mainScript: join(import.meta.dir, "main.ts"),
  });
  const supervisor = superviseEva({
    command: [...command, "--home", paths.root],
    cwd: paths.root,
    // The child is Eva herself, not an agent, so she gets the whole environment (lesson 96 covers agents).
    environment: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    start: systemLongProcessStarter,
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
    // A warning, so the restart shows in `/logs` on the phone, and a line for a person at the console.
    log: (message) => {
      logger.log("warn", message);
      writeLine(message);
    },
    stopTimeoutMs: shutdownDeadlineMs + hardExitGraceMs,
    pid: process.pid,
  });
  process.once("SIGINT", () => {
    supervisor.stop();
  });
  process.once("SIGTERM", () => {
    supervisor.stop();
  });
  return supervisor.done;
}

/** The home folder that Eva uses when no `--home` or `EVA_HOME` names one. */
function defaultHomeFolder(): string {
  // Only EVA_HOME is left out: APPDATA and XDG_CONFIG_HOME still move the default folder.
  const environment = { APPDATA: process.env["APPDATA"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] };
  return resolveHomeFolder({ environment, platform: process.platform, userHome: homedir() });
}

async function withPrompt(work: (ask: (question: string) => Promise<string>) => Promise<void>): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await work((question) => prompt.question(question));
  } finally {
    prompt.close();
  }
}

let restart: (() => void) | null = null;

/** `eva update`: the running Eva updates and restarts herself; a stopped Eva is updated here. */
async function update(paths: HomePaths, checkOnly: boolean): Promise<number> {
  const client = runningClient(paths);
  if (client !== null) {
    writeLine(await requestUpdate(client, checkOnly));
    return exitCodes.clean;
  }
  const channel = updateChannel(loadSecrets(paths));
  const found = checkOnly ? await channel.check() : await channel.apply();
  writeLine(
    found.current === found.latest
      ? `Eva ${found.current} is the latest version.`
      : checkOnly
        ? `Eva ${found.latest} is available (this is ${found.current}). Run \`eva update\` to install it.`
        : `Updated Eva from ${found.current} to ${found.latest}.`,
  );
  return exitCodes.clean;
}

/** `eva sync`: the running Eva syncs; a stopped Eva syncs here. */
async function sync(paths: HomePaths): Promise<number> {
  const client = runningClient(paths);
  if (client !== null) {
    writeLine(await requestSync(client));
    return exitCodes.clean;
  }
  const vaultPath = loadConfig(paths).vaultPath;
  if (vaultPath === null) {
    writeLine("No vault is configured. Run `eva setup` first.");
    return exitCodes.badConfig;
  }
  const vaultSync = new VaultSync({
    vaultPath,
    runner: systemProcessRunner,
    environment: gitEnvironment(loadSecrets(paths)),
    now: () => new Date(),
  });
  await vaultSync.pull();
  const state = await vaultSync.save();
  writeLine(describeSync(state));
  return state.status === "ok" ? exitCodes.clean : exitCodes.crash;
}

/** `eva link`: the address that opens Eva on the phone and other computers. */
async function link(paths: HomePaths): Promise<number> {
  const client = runningClient(paths);
  if (client === null) {
    writeLine("Eva is not running, so she publishes no address. Start her with `eva`, or run `eva setup`.");
    return exitCodes.crash;
  }
  writeLine(describeAccess(await requestStatus(client)).join("\n"));
  return exitCodes.clean;
}

/** `eva hub`: makes this machine the hub; the old hub stops at its next vault fetch. */
async function hub(paths: HomePaths): Promise<number> {
  const client = runningClient(paths);
  if (client !== null) {
    writeLine(await requestHub(client));
    return exitCodes.clean;
  }
  const config = loadSettings(paths).config;
  if (config.vaultPath === null) {
    writeLine("Without a vault, this machine is always the hub.");
    return exitCodes.clean;
  }
  const machine = config.machineName ?? hostname();
  const vaultSync = new VaultSync({
    vaultPath: config.vaultPath,
    runner: systemProcessRunner,
    environment: gitEnvironment(loadSecrets(paths)),
    now: () => new Date(),
  });
  await vaultSync.pull();
  claimHub(config.vaultPath, machine, new Date());
  writeLine(`${machine} is now the hub. ${describeSync(await vaultSync.save())}`);
  return exitCodes.clean;
}

/** `eva settings`: shows or changes a setting, through the running Eva when one runs. */
async function settings(paths: HomePaths, command: Extract<CliCommand, { command: "settings" }>): Promise<number> {
  const loaded = loadSettings(paths);
  if (loaded.problem !== null) writeLine(`The vault's settings were not used: ${loaded.problem}`);
  const lines = describeSettings(loaded.config);
  if (command.action === "list") {
    writeLine(lines.join("\n"));
    return exitCodes.clean;
  }
  const key = command.key ?? "";
  if (command.action === "get") {
    const found = lines.filter((line) => line.startsWith(`${key} = `) || line.startsWith(`${key}.`));
    writeLine(found.length === 0 ? `${key} is not a setting.` : found.join("\n"));
    return found.length === 0 ? exitCodes.badConfig : exitCodes.clean;
  }
  const change = settingChange(key, command.value ?? "");
  const client = runningClient(paths);
  const place = isSharedSettingKey(key) ? "in the vault, for every machine" : "on this machine";
  if (client === null) {
    changeSettings(paths, change);
    writeLine(`Saved ${key} ${place}.`);
  } else {
    const restartNeeded = await requestSettingsChange(client, change);
    writeLine(`Saved ${key} ${place}.${restartNeeded ? " Restart Eva to use it." : " Eva uses it now."}`);
  }
  return exitCodes.clean;
}

/** The API of the Eva that runs with this home, or null when none runs. */
function runningClient(paths: HomePaths): ClientOptions | null {
  const token = loadSecrets(paths).localApiToken;
  const probe = { bootId: readBootId(process.platform), isProcessAlive };
  if (token === undefined || runningInstancePid(paths.lock, probe) === null) return null;
  return { baseUrl: `http://127.0.0.1:${String(loadConfig(paths).port)}`, token };
}

/** Signed releases for the single executable; git for a source checkout. */
function updateChannel(secrets: EvaSecrets): UpdateChannel {
  if (isStandalone()) {
    return executableUpdateChannel({
      currentVersion: evaVersion,
      executablePath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      runner: systemProcessRunner,
      environment: childEnvironment(),
    });
  }
  return sourceUpdateChannel({
    folder: dirname(import.meta.dir),
    runner: systemProcessRunner,
    environment: gitEnvironment(secrets),
    bunExecutable: process.execPath,
  });
}

/**
 * Pulls the vault before the settings move to it, so this machine never starts a settings file
 * that another machine already pushed (a conflict that would stop the vault's pushes). Then the
 * security settings move the other way, out of the vault.
 */
async function moveSettingsAfterPull(
  paths: HomePaths,
  secrets: EvaSecrets,
): Promise<{ toVault: boolean; toMachine: boolean }> {
  const vaultPath = loadConfig(paths).vaultPath;
  if (vaultPath === null || !existsSync(vaultPath)) return { toVault: false, toMachine: false };
  await new VaultSync({
    vaultPath,
    runner: systemProcessRunner,
    environment: gitEnvironment(secrets),
    now: () => new Date(),
  }).pull();
  return { toVault: moveSettingsToVault(paths), toMachine: moveSecuritySettingsFromVault(paths) };
}

const oldCopyVariable = "EVA_WAIT_FOR_PID";
const tailscaleRetryMs = 60_000;
/** systemd sends SIGKILL 90 seconds after SIGTERM by default; Eva ends well before that. */
const shutdownDeadlineMs = 20_000;
const hardExitGraceMs = 5_000;
const oldCopyWaitMs = 60_000;

/** After an update, the new copy starts first; the lock is free only when the old copy has gone. */
function startNewCopy(): void {
  const command = isStandalone() ? [process.execPath] : [process.execPath, Bun.main];
  const [program = process.execPath, ...arguments_] = [...command, ...process.argv.slice(2)];
  // The new copy is Eva herself, not an agent, so it gets Eva's whole environment (lesson 96 covers agents).
  spawn(program, arguments_, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [oldCopyVariable]: String(process.pid) },
  }).unref();
}

async function waitForOldCopy(): Promise<void> {
  const pid = Number(process.env[oldCopyVariable]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const started = Date.now();
  while (isProcessAlive(pid) && Date.now() - started < oldCopyWaitMs) await Bun.sleep(200);
}

function gitEnvironment(secrets: EvaSecrets): Record<string, string> {
  return buildChildEnvironment(
    process.env,
    baseEnvironmentAllowlist,
    secrets.githubToken === undefined ? {} : { [githubTokenVariable]: secrets.githubToken },
  );
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
    // The service log keeps stderr, so a crash report is redacted too (lesson 95).
    process.stderr.write(
      new Redactor().redact(
        `Eva stopped on an error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      ),
    );
    process.exit(exitCodes.crash);
  });

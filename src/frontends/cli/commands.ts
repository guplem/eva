/**
 * The `eva` command line: it reads the arguments, runs the command, and gives the exit code.
 * The `run` command starts the whole Eva, which only `src/main.ts` may wire, so it comes in.
 */
import { randomBytes } from "node:crypto";
import {
  createHomeFolders,
  homePaths,
  loadSecrets,
  resolveHomeFolder,
  type HomePaths,
} from "../../core/settings/home.ts";
import { loadSettings } from "../../core/settings/settings.ts";
import { githubClientId, githubDeviceLogin } from "../../core/vault/github-login.ts";
import { systemClock } from "../../shared/clock.ts";
import { isEvaError } from "../../shared/errors.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { readTextTolerant } from "../../shared/files.ts";
import type { LongProcessStarter } from "../../shared/long-process.ts";
import { Redactor } from "../../shared/redaction.ts";
import { evaVersion } from "../../shared/version.ts";
import { parseArguments, usageText, type CliCommand } from "./arguments.ts";
import { runChat } from "./chat.ts";
import { describeProjects, describeStatus, startProjectWork } from "./client.ts";
import { runDoctor } from "./doctor.ts";
import { childEnvironment, defaultHomeFolder, remoteAccessWatcher, writeLine, type CliHost } from "./host.ts";
import { hub, link, settings, sync, update } from "./local-commands.ts";
import { runNetworkSetup, type NetworkSetupOptions } from "./network-setup.ts";
import { installService, supervise } from "./service.ts";
import { runSetup, setupEnvironmentNames, type SetupOptions } from "./setup.ts";

export interface CliWiring {
  /** `eva` and `eva run`: starts Eva and resolves with her exit code when she stops. */
  readonly serve: (paths: HomePaths) => Promise<number>;
  /** Starts Eva under `eva supervise`. */
  readonly startLongProcess: LongProcessStarter;
}

/** Runs one `eva` command and gives the process's exit code. */
export async function runCli(argv: readonly string[], host: CliHost, wiring: CliWiring): Promise<number> {
  const command = parseArguments(argv);
  if (command.command === "usage-error") {
    host.writeError(`${command.message}\n\n${usageText}`);
    return exitCodes.badConfig;
  }
  if (command.command === "help") {
    host.write(usageText);
    return exitCodes.clean;
  }
  if (command.command === "version") {
    writeLine(host, evaVersion);
    return exitCodes.clean;
  }
  const paths = homePaths(
    resolveHomeFolder({
      flag: command.home,
      environment: host.environment,
      platform: host.platform,
      userHome: host.userHome,
    }),
  );

  switch (command.command) {
    case "doctor":
      return (await doctor(host, paths)) ? exitCodes.clean : exitCodes.crash;
    case "setup":
      await setup(host, paths, command.nonInteractive);
      return exitCodes.clean;
    case "service-install":
      return installService(host, paths);
    case "supervise":
      return supervise(host, paths, wiring.startLongProcess);
    case "update":
      return update(host, paths, command.checkOnly, command.version);
    case "sync":
      return sync(host, paths);
    case "hub":
      return hub(host, paths);
    case "link":
      return link(host, paths);
    case "settings":
      return settings(host, paths, command);
    case "status":
    case "projects":
    case "chat":
    case "work":
      return runClientCommand(host, paths, command);
    case "run":
      return wiring.serve(paths);
  }
}

/** The exit code and the message of an error that no command caught. */
export function describeFailure(error: unknown): { readonly exitCode: number; readonly text: string } {
  if (isEvaError(error, "config_invalid")) return { exitCode: exitCodes.badConfig, text: `${error.message}\n` };
  if (isEvaError(error, "instance_locked")) return { exitCode: exitCodes.secondInstance, text: `${error.message}\n` };
  // An expected failure, such as a refused update: its message says what to do, no stack needed.
  if (isEvaError(error)) return { exitCode: exitCodes.crash, text: `${error.message}\n` };
  // The service log keeps stderr, so a crash report is redacted too (lesson 95).
  return {
    exitCode: exitCodes.crash,
    text: new Redactor().redact(
      `Eva stopped on an error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    ),
  };
}

function doctor(host: CliHost, paths: HomePaths): Promise<boolean> {
  return runDoctor({
    runner: host.runner,
    environment: childEnvironment(host),
    write: (text) => {
      writeLine(host, text);
    },
    standalone: host.standalone,
    platform: host.platform,
    userName: host.userName,
    defaultEngine: loadSettings(paths).config.engines.default,
  });
}

async function setup(host: CliHost, paths: HomePaths, nonInteractive: boolean): Promise<void> {
  // The setup order starts with the doctor: a missing tool shows before any question.
  await doctor(host, paths);
  createHomeFolders(paths);
  const write = (text: string): void => {
    writeLine(host, text);
  };
  const setupOptions = {
    paths,
    write,
    newToken: () => randomBytes(24).toString("base64url"),
    runner: host.runner,
    environment: childEnvironment(host),
    defaultHome: defaultHomeFolder(host),
    platform: host.platform,
    githubLogin: githubBrowserLogin(host, githubClientId),
  };
  const networkOptions = (port: number): Omit<NetworkSetupOptions, "interactive" | "ask"> => ({
    // Setup publishes too, so the address that it prints works as soon as Eva runs.
    access: remoteAccessWatcher(host, port),
    localUrl: `http://127.0.0.1:${String(port)}`,
    write,
    sleep: host.sleep,
  });
  if (nonInteractive) {
    await runSetup({
      ...setupOptions,
      interactive: false,
      ask: (key) => Promise.resolve(host.environment[setupEnvironmentNames[key]] ?? ""),
    });
    await runNetworkSetup({
      ...networkOptions(loadSettings(paths).config.port),
      interactive: false,
      ask: () => Promise.resolve(""),
    });
    return;
  }
  await host.withPrompt(async (ask) => {
    await runSetup({ ...setupOptions, interactive: true, ask: (_key, question) => ask(question) });
    // The last step: the address that opens Eva on every other device.
    await runNetworkSetup({ ...networkOptions(loadSettings(paths).config.port), interactive: true, ask });
  });
}

/** `status`, `projects`, `chat` and `work`: these need the running Eva. */
async function runClientCommand(
  host: CliHost,
  paths: HomePaths,
  command: Extract<CliCommand, { command: "status" | "projects" | "chat" | "work" }>,
): Promise<number> {
  const config = loadSettings(paths).config;
  const token = loadSecrets(paths).localApiToken;
  if (token === undefined) {
    host.writeError("No local token yet. Run `eva setup` first.\n");
    return exitCodes.badConfig;
  }
  const client = { baseUrl: `http://127.0.0.1:${String(config.port)}`, token };
  try {
    if (command.command === "status") {
      writeLine(host, await describeStatus(client, readTextTolerant(paths.telegramPairingCode)?.trim() ?? null));
    } else if (command.command === "projects") {
      writeLine(host, await describeProjects(client, command.query));
    } else if (command.command === "work") {
      writeLine(
        host,
        await startProjectWork(client, {
          projectId: command.projectId,
          request: command.request,
          reportToSessionId: host.environment["EVA_SESSION_ID"] ?? null,
        }),
      );
    } else {
      await host.withPrompt(async (ask) => {
        await runChat({
          ...client,
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
          write: host.write,
        });
      });
    }
    return exitCodes.clean;
  } catch (error) {
    host.writeError(
      `${error instanceof Error ? error.message : String(error)}\nIs Eva running? Start her with \`eva\`.\n`,
    );
    return exitCodes.crash;
  }
}

/** The browser login of `eva setup`, or null while Eva has no OAuth App (#113). */
function githubBrowserLogin(host: CliHost, clientId: string | null): SetupOptions["githubLogin"] {
  if (clientId === null) return null;
  return (show) => githubDeviceLogin({ clientId, show, sleep: host.sleep, clock: systemClock });
}

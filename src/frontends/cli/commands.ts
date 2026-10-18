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
  type EvaConfig,
  type HomePaths,
} from "../../core/settings/home.ts";
import type { CheckResult } from "../../core/checks.ts";
import { checkGoogle } from "../../core/google/google-check.ts";
import { googleCredentialsFolder } from "../../core/google/google-login.ts";
import { loadSettings, vaultSettingsPath } from "../../core/settings/settings.ts";
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
import {
  describeProjects,
  describeSetupProgress,
  describeStatus,
  isAnswering,
  requestDeviceAllow,
  requestRestart,
  startProjectWork,
} from "./client.ts";
import { allowDevice } from "./devices.ts";
import { runDoctor } from "./doctor.ts";
import {
  childEnvironment,
  defaultHomeFolder,
  installEnvironment,
  remoteAccessWatcher,
  writeLine,
  type CliHost,
} from "./host.ts";
import { hub, link, runningClient, settings, sync, update } from "./local-commands.ts";
import { runNetworkSetup } from "./network-setup.ts";
import { installService, supervise } from "./service.ts";
import { runSetup, setupEnvironmentNames, type SetupOptions, type SetupQuestion } from "./setup.ts";
import { startAndLetIn } from "./setup-start.ts";

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
    case "devices-allow":
      return allowDevice(host, paths, command.code);
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
  const config = loadSettings(paths).config;
  return runDoctor({
    runner: host.runner,
    environment: childEnvironment(host),
    write: (text) => {
      writeLine(host, text);
    },
    standalone: host.standalone,
    platform: host.platform,
    userName: host.userName,
    userHome: host.userHome,
    defaultEngine: config.engines.default,
    google: () => googleState(paths, config.google),
  });
}

/** The saved client and login, plus one token refresh, or null when Google is not set up at all. */
async function googleState(paths: HomePaths, google: EvaConfig["google"]): Promise<CheckResult | null> {
  const secrets = loadSecrets(paths);
  const { googleOauthClientId: clientId, googleOauthClientSecret: clientSecret } = secrets;
  if (google.email === null && clientId === undefined && clientSecret === undefined) return null;
  const result = await checkGoogle({
    config: google,
    client: clientId === undefined || clientSecret === undefined ? null : { clientId, clientSecret },
    credentialsFolder: googleCredentialsFolder(paths),
    readServices: false,
  });
  // The terminal output can reach a log, as the Test result reaches the page: both are redacted (lesson 95).
  const redactor = new Redactor();
  for (const secret of Object.values(secrets)) redactor.addSecret(secret);
  return { ok: result.ok, detail: redactor.redact(result.detail) };
}

async function setup(host: CliHost, paths: HomePaths, nonInteractive: boolean): Promise<void> {
  // The setup order starts with the doctor: a missing tool shows before any question.
  await doctor(host, paths);
  createHomeFolders(paths);
  const write = (text: string): void => {
    writeLine(host, text);
  };
  const port = (): number => loadSettings(paths).config.port;
  const localUrl = (): string => `http://127.0.0.1:${String(port())}`;
  const setupOptions = {
    paths,
    write,
    newToken: () => randomBytes(24).toString("base64url"),
    runner: host.runner,
    environment: childEnvironment(host),
    defaultHome: defaultHomeFolder(host),
    platform: host.platform,
    githubLogin: githubBrowserLogin(host, githubClientId),
    userHome: host.userHome,
    installEnvironment: installEnvironment(host),
    arch: host.arch,
  };
  // The files as the running Eva read them, so the end of setup knows whether she must restart.
  const snapshot: { readByEva: string | null } = { readByEva: null };
  const start =
    (interactive: boolean, ask: (question: string) => Promise<string>, script: (key: SetupQuestion) => string) =>
    async (): Promise<void> => {
      await startAndLetIn({
        interactive,
        // A script never waits for a device code: nobody is there to read the page.
        ask: (key, question) =>
          interactive ? ask(question) : Promise.resolve(key === "deviceCode" ? "" : script(key)),
        write,
        // Setup publishes too, so the address that it prints works as soon as Eva runs.
        network: () =>
          runNetworkSetup({
            access: remoteAccessWatcher(host, port()),
            localUrl: localUrl(),
            write,
            sleep: host.sleep,
            interactive,
            ask,
          }),
        localUrl: localUrl(),
        startService: async () => (await installService(host, paths)) === exitCodes.clean,
        isRunning: async () => {
          const client = runningClient(host, paths);
          return client !== null && (await isAnswering(client));
        },
        allow: async (code) => {
          const client = runningClient(host, paths);
          return client === null ? null : requestDeviceAllow(client, code);
        },
        sleep: host.sleep,
      });
      snapshot.readByEva = setupFiles(paths);
    };
  if (nonInteractive) {
    const script = (key: SetupQuestion): string => host.environment[setupEnvironmentNames[key]] ?? "";
    await runSetup({
      ...setupOptions,
      interactive: false,
      ask: (key) => Promise.resolve(script(key)),
      afterEssentials: start(false, () => Promise.resolve(""), script),
    });
  } else {
    await host.withPrompt(async (ask) => {
      await runSetup({
        ...setupOptions,
        interactive: true,
        ask: (_key, question) => ask(question),
        afterEssentials: start(true, ask, () => ""),
      });
    });
  }
  const client = runningClient(host, paths);
  if (client !== null) for (const line of await describeSetupProgress(client)) write(line);
  if (client !== null && snapshot.readByEva !== null && snapshot.readByEva !== setupFiles(paths)) {
    write("Restarting Eva, so she uses the new answers. A conversation that runs now stops.");
    await requestRestart(client);
  } else if (client === null) {
    write("Run `eva doctor` to check the tools, then start Eva with `eva service install` or `eva`.");
  }
}

/** The files that hold the setup's answers, as one text, to tell whether any changed. */
function setupFiles(paths: HomePaths): string {
  const vaultPath = loadSettings(paths).config.vaultPath;
  return [paths.config, paths.secrets, ...(vaultPath === null ? [] : [vaultSettingsPath(vaultPath)])]
    .map((path) => readTextTolerant(path) ?? "")
    .join("\n");
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

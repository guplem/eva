/**
 * The `eva` command line: it reads the arguments, runs the command, and gives the exit code.
 * The `run` command starts the whole Eva, which only `src/main.ts` may wire, so it comes in.
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createHomeFolders,
  instanceNameOf,
  instancesFolder,
  listInstances,
  loadSecrets,
  type EvaConfig,
  type HomePaths,
} from "../../core/settings/home.ts";
import type { CheckResult } from "../../core/checks.ts";
import { checkGoogle } from "../../core/google/google-check.ts";
import { googleCredentialsFolder } from "../../core/google/google-login.ts";
import { changeSettings, loadSettings } from "../../core/settings/settings.ts";
import { githubClientId, githubDeviceLogin } from "../../core/vault/github-login.ts";
import { systemClock } from "../../shared/clock.ts";
import { EvaError, isEvaError } from "../../shared/errors.ts";
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
import { allowDevice, canOpenBrowser, openEva, openLoggedIn } from "./devices.ts";
import { chooseInstance } from "./instance-choice.ts";
import { runDoctor } from "./doctor.ts";
import {
  childEnvironment,
  installEnvironment,
  remoteAccessWatcher,
  tailnetAccounts,
  writeLine,
  type CliHost,
} from "./host.ts";
import { hub, link, runningClient, settings, sync, update } from "./local-commands.ts";
import { runNetworkSetup } from "./network-setup.ts";
import { installService, supervise } from "./service.ts";
import { runSetup, setupEnvironmentNames, type SetupOptions, type SetupQuestion } from "./setup.ts";
import { doneLine, questionText, stepLines } from "./setup-output.ts";
import { startAndLetIn, type AccountChoice, type FinishPlace } from "./setup-start.ts";

export interface CliWiring {
  /** `eva` and `eva run`: starts Eva and resolves with her exit code when she stops. */
  readonly serve: (paths: HomePaths) => Promise<number>;
  /** Starts Eva under `eva supervise`. */
  readonly startLongProcess: LongProcessStarter;
}

/** Runs one `eva` command and gives the process's exit code. */
export async function runCli(argv: readonly string[], host: CliHost, wiring: CliWiring): Promise<number> {
  const command = parseArguments(argv);
  try {
    return await runCommand(command, host, wiring);
  } catch (error) {
    if (!isEvaError(error, "prompt_stopped")) throw error;
    // Setup saves each answer at once, so a stop loses nothing (#407).
    writeLine(host, command.command === "setup" ? setupStoppedLine : "Stopped.");
    return exitCodes.clean;
  }
}

const setupStoppedLine = "Setup stopped. Each answer is saved. Run `eva setup` to go on.";

async function runCommand(command: CliCommand, host: CliHost, wiring: CliWiring): Promise<number> {
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
  // The name is the first setup question, so the advice on Enter comes before it.
  if (command.command === "setup")
    for (const line of [
      "",
      "Eva setup",
      "Press Enter to keep the value in [brackets], or to skip a question.",
      ...stepLines("Name"),
    ])
      writeLine(host, line);
  const paths = await chooseInstance(host, {
    name: command.instance,
    creates: command.command === "setup",
    // Setup asks its own questions unless a script runs it, so it may ask for the name too.
    interactive: command.command === "setup" ? !command.nonInteractive : host.interactive,
  });

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
    case "open":
      return openEva(host, paths);
    case "status":
    case "projects":
    case "chat":
    case "work":
      return runClientCommand(host, paths, command);
    case "run":
      return serveOrExplain(host, paths, wiring);
  }
}

/**
 * `eva` runs Eva in the terminal. A person who types it to look at Eva, while she already runs as a
 * service, gets the commands that show her state instead of a lock error (#321).
 */
async function serveOrExplain(host: CliHost, paths: HomePaths, wiring: CliWiring): Promise<number> {
  try {
    return await wiring.serve(paths);
  } catch (error) {
    if (!isEvaError(error, "instance_locked")) throw error;
    const name = instanceNameOf(paths);
    const eva = listInstances(instancesFolder(host)).length > 1 ? `eva --instance ${name}` : "eva";
    throw new EvaError(
      "instance_locked",
      [
        `This Eva (${name}) already runs, for example as a service. There is nothing more to start.`,
        `To see her state, run \`${eva} status\`. Her address: \`${eva} link\`. Every command: \`eva help\`.`,
      ].join("\n"),
      { cause: error },
    );
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

function doctor(host: CliHost, paths: HomePaths, forSetup = false): Promise<boolean> {
  const config = loadSettings(paths).config;
  return runDoctor({
    forSetup,
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
  // Setup writes the config, so an Eva with none is the one that this setup makes.
  const isNewEva = !existsSync(paths.config);
  const write = (text: string): void => {
    writeLine(host, text);
  };
  write(doneLine(`This Eva lives in ${paths.root}`));
  for (const line of stepLines("Programs")) write(line);
  // The setup order starts with the tools: a missing one shows before any question.
  await doctor(host, paths, true);
  createHomeFolders(paths);
  const port = (): number => loadSettings(paths).config.port;
  const localUrl = (): string => `http://127.0.0.1:${String(port())}`;
  const setupOptions = {
    paths,
    write,
    newToken: () => randomBytes(24).toString("base64url"),
    runner: host.runner,
    environment: childEnvironment(host),
    platform: host.platform,
    githubLogin: githubBrowserLogin(host, githubClientId),
    userHome: host.userHome,
    installEnvironment: installEnvironment(host),
    arch: host.arch,
  };
  // The first Eva on a computer lets in the computer's own Tailscale account; another asks whose (#322).
  // The question is for a new Eva beside another one, and for an Eva that lets in a chosen account,
  // so that it can change. The owner's own Eva keeps her account with no new question.
  const otherEvas = listInstances(instancesFolder(host)).filter((name) => name !== instanceNameOf(paths));
  const asksAccount =
    (isNewEva && otherEvas.length > 0) || loadSettings(paths).config.remoteAccess.allowedTailscaleIdentities.length > 0;
  const start =
    (interactive: boolean, ask: (question: string) => Promise<string>, script: (key: SetupQuestion) => string) =>
    (): Promise<FinishPlace> =>
      startAndLetIn({
        interactive,
        // A script never waits for a device code or a choice: nobody is there to read the page.
        ask: (key, question) =>
          interactive
            ? ask(question)
            : Promise.resolve(key === "deviceCode" || key === "finishOn" || key === "openHere" ? "" : script(key)),
        write,
        // Setup publishes too, so the address that it prints works as soon as Eva runs.
        network: () =>
          runNetworkSetup({
            access: remoteAccessWatcher(host, port()),
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
        openHere: canOpenBrowser(host)
          ? async (page) => {
              const client = runningClient(host, paths);
              return client !== null && (await openLoggedIn(host, client, page));
            }
          : null,
        sleep: host.sleep,
        account: asksAccount ? accountChoice(host, paths) : null,
      });
  let result = { changedAfterStart: false, finishOnPage: false };
  if (nonInteractive) {
    const script = (key: SetupQuestion): string => host.environment[setupEnvironmentNames[key]] ?? "";
    result = await runSetup({
      ...setupOptions,
      interactive: false,
      ask: (key) => Promise.resolve(script(key)),
      afterEssentials: start(false, () => Promise.resolve(""), script),
    });
  } else {
    await host.withPrompt(async (prompt) => {
      // Each question gets its mark, so a person sees when setup waits for an answer.
      const ask = (question: string): Promise<string> => prompt(questionText(question));
      result = await runSetup({
        ...setupOptions,
        interactive: true,
        ask: (_key, question) => ask(question),
        afterEssentials: start(true, ask, () => ""),
      });
    });
  }
  // The steps for the page are the last lines, so the person sees them without a scroll.
  if (result.finishOnPage) return;
  const client = runningClient(host, paths);
  if (client === null) {
    write("Run `eva doctor` to check the tools, then start Eva with `eva service install` or `eva`.");
    return;
  }
  // Every answer is saved by now, so a page that does not answer only gets a line, never a failed setup.
  try {
    if (!(await isAnswering(client))) throw new Error("no answer");
    for (const line of await describeSetupProgress(client)) write(line);
    write("Run `eva setup` again at any time: it asks only for the steps that are not done.");
    // Only setup's own answers count: a save on the page meanwhile has its own Restart button.
    if (result.changedAfterStart) {
      write("Restarting Eva, so she uses the new answers. A conversation that runs now stops.");
      await requestRestart(client);
    }
  } catch {
    write("Eva's page did not answer. Run `eva status`, then restart her from Settings to use the new answers.");
  }
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
    if (isEvaError(error, "prompt_stopped")) throw error;
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

/** The Tailscale account that uses an Eva that is not the first one on this computer (#322). */
function accountChoice(host: CliHost, paths: HomePaths): AccountChoice {
  return {
    accounts: () => tailnetAccounts(host),
    allowed: () => loadSettings(paths).config.remoteAccess.allowedTailscaleIdentities,
    allow: (account) => {
      changeSettings(paths, { remoteAccess: { allowedTailscaleIdentities: [account] } });
    },
    restart: async () => {
      const client = runningClient(host, paths);
      if (client === null) return false;
      // A failed or stuck restart only gets a line: the account is saved, and setup goes on.
      const asked = await Promise.race([
        requestRestart(client).then(
          () => true,
          () => false,
        ),
        host.sleep(restartWaitMs).then(() => false),
      ]);
      if (!asked) return false;
      // The old Eva still answers for a moment, so the wait starts after a pause.
      for (let waited = 0; waited < restartWaitMs; waited += restartPollMs) {
        await host.sleep(restartPollMs);
        if (await isAnswering(client)) return true;
      }
      return false;
    },
  };
}

const restartPollMs = 2_000;
const restartWaitMs = 30_000;

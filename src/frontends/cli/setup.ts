/**
 * `eva setup`: asks for each setting and writes the instance home.
 * An empty answer keeps the current value. With `--non-interactive`, each answer comes from
 * an environment variable instead (`setupEnvironmentNames`), and a bad answer stops setup.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  homePaths,
  isExtraInstance,
  loadConfig,
  saveConfig,
  engineFolders as engineFoldersOf,
  type EngineFolders,
  loadSecrets,
  saveSecrets,
  type EvaConfig,
  type EvaSecrets,
  type HomePaths,
} from "../../core/settings/home.ts";
import {
  engineProgramNames,
  findEngineProgram,
  installEngine,
  type EngineInstallInputs,
} from "../../core/engine-install/engine-install.ts";
import { claudeLoggedIn, piLoginState } from "../../core/setup/logins.ts";
import { isProcessAlive, readBootId, runningInstancePid } from "../../core/instance/instance-lock.ts";
import { changeSettings, loadSettings, vaultSettingsPath } from "../../core/settings/settings.ts";
import {
  checkVaultRepository,
  cloneVault,
  githubTokenVariable,
  pushNewVault,
  vaultNeedsPush,
} from "../../core/vault/vault-clone.ts";
import {
  createGitHubRepository,
  listGitHubRepositories,
  type GitHubRepository,
} from "../../core/vault/github-repositories.ts";
import { githubLoginAccess } from "../../core/vault/github-login.ts";
import { createVaultFromTemplate } from "../../core/vault/vault-template.ts";
import type { EngineName } from "../../shared/engine-port.ts";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import {
  engineLoginReport,
  engineLoginState,
  engineLoginSteps,
  quoteForShell,
  withVariable,
  type EngineLoginState,
} from "./engine-logins.ts";

export type SetupQuestion =
  | "timeZone"
  | "githubToken"
  | "vaultRepository"
  | "vault"
  | "createVault"
  | "name"
  | "language"
  | "topics"
  | "githubRepository"
  | "engine"
  | "installEngines"
  | "startService"
  | "port"
  | "trustedOwners"
  | "claudeToken"
  | "telegramToken"
  | "telegramChatId"
  | "googleEmail"
  | "googleClientId"
  | "googleClientSecret"
  | "voiceModel";

/** The environment variable that answers each question in `eva setup --non-interactive`. */
export const setupEnvironmentNames: Readonly<Record<SetupQuestion, string>> = {
  timeZone: "EVA_TIME_ZONE",
  githubToken: "EVA_GITHUB_TOKEN",
  vaultRepository: "EVA_VAULT_REPOSITORY",
  vault: "EVA_VAULT_PATH",
  createVault: "EVA_CREATE_VAULT",
  name: "EVA_PERSON_NAME",
  language: "EVA_LANGUAGE",
  topics: "EVA_TOPICS",
  githubRepository: "EVA_GITHUB_REPOSITORY",
  engine: "EVA_ENGINE",
  installEngines: "EVA_INSTALL_ENGINES",
  startService: "EVA_START_SERVICE",
  port: "EVA_PORT",
  trustedOwners: "EVA_TRUSTED_OWNERS",
  claudeToken: "EVA_CLAUDE_TOKEN",
  telegramToken: "EVA_TELEGRAM_BOT_TOKEN",
  telegramChatId: "EVA_TELEGRAM_CHAT_ID",
  googleEmail: "EVA_GOOGLE_EMAIL",
  googleClientId: "EVA_GOOGLE_CLIENT_ID",
  googleClientSecret: "EVA_GOOGLE_CLIENT_SECRET",
  voiceModel: "EVA_VOICE_MODEL",
};

export interface SetupOptions {
  readonly paths: HomePaths;
  readonly ask: (key: SetupQuestion, question: string) => Promise<string>;
  readonly write: (line: string) => void;
  readonly newToken: () => string;
  /** False: a bad answer stops setup instead of asking again. */
  readonly interactive: boolean;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  /** The platform's default home: a setup in any other home sets up an extra instance. */
  readonly defaultHome: string;
  readonly platform: NodeJS.Platform;
  /** The GitHub browser login, which shows its code through `show`; null when Eva has no OAuth App yet. */
  readonly githubLogin: ((show: (code: string, link: string) => void) => Promise<string>) | null;
  /** The OS user's home folder, where the engine installers put their programs. */
  readonly userHome: string;
  /** The environment of an engine installer: the child environment plus the person's proxy settings. */
  readonly installEnvironment: Readonly<Record<string, string>>;
  readonly arch: string;
  /** The GitHub API, which lists and creates repositories; a test points it at a fake server. */
  readonly githubApiBaseUrl?: string;
  /** The pi release downloads; a test points it at a fake server. */
  readonly piReleasesBaseUrl?: string;
  /** Runs once the engines, the port and the local token are in place, before the other questions. */
  readonly afterEssentials?: () => Promise<void>;
}

/** Returns whether setup saved anything after `afterEssentials`, when a running Eva would need a restart. */
export async function runSetup(options: SetupOptions): Promise<{ changedAfterStart: boolean }> {
  const paths = homePaths(options.paths.root);
  // Each answer is saved at once, on top of the files as they are now: Ctrl+C loses nothing, and
  // a change from the web page, which writes the same files, is never undone.
  const config = (): EvaConfig => loadSettings(paths).config;
  const secrets = (): EvaSecrets => loadSecrets(paths);
  const refusal: { error: EvaError | null } = { error: null };
  const progress = { started: false, changedAfterStart: false };
  const saveSetting = (change: Readonly<Record<string, unknown>>): void => {
    progress.changedAfterStart ||= progress.started;
    try {
      changeSettings(paths, change);
    } catch (error) {
      // A vault that a newer Eva migrated refuses a change; the questions go on, so no token is lost.
      if (!isEvaError(error, "vault_ahead")) throw error;
      refusal.error ??= error;
    }
  };
  const saveSecret = (name: keyof EvaSecrets, value: string): void => {
    progress.changedAfterStart ||= progress.started;
    saveSecrets(paths, { ...secrets(), [name]: value });
  };
  // Only the machine's file: a merge with defaults would write over the vault's own settings.
  const saveVaultPath = (folder: string): void => {
    progress.changedAfterStart ||= progress.started;
    saveConfig(paths, { ...loadConfig(paths), vaultPath: folder });
  };
  const ask = async (key: SetupQuestion, question: string): Promise<string> =>
    (await options.ask(key, question)).trim();
  /** A person is not asked again for a step done already, on the page or in an earlier setup. */
  const done = (isDone: boolean): boolean => options.interactive && isDone;
  options.write(`Eva setup. Press Enter to keep the value in brackets. Home: ${paths.root}`);
  // First, so the person knows every login that this instance still needs before the questions.
  const engineFolders = isExtraInstance(paths, options.defaultHome, options.platform) ? engineFoldersOf(paths) : null;
  const loginState = (folders: EngineFolders): Promise<EngineLoginState> =>
    engineLoginState({
      folders,
      claudeTokenSaved: secrets().claudeOauthToken !== undefined,
      runner: options.runner,
      environment: options.environment,
    });
  // A script gets no steps: setup ends at once, and the report at the end says what to run.
  if (engineFolders !== null && options.interactive) {
    for (const line of engineLoginSteps(await loginState(engineFolders), engineFolders, options.platform)) {
      options.write(line);
    }
  }

  // Only a script picks the default engine. For a person, the engine with a login wins (below).
  const engine = options.interactive ? "" : await ask("engine", "Default engine, claude-code or pi: ");
  if (engine === "claude-code" || engine === "pi") saveSetting({ engines: { default: engine } });
  else if (engine !== "") throw new EvaError("config_invalid", "The engine must be claude-code or pi.");
  // Only a script skips the installs, such as a test or a machine image that brings its own engines.
  const install = options.interactive ? "" : await ask("installEngines", "Install the missing engines? [Y/n]: ");
  if (install !== "" && !/^(y(es)?|no?)$/i.test(install))
    throw new EvaError("config_invalid", "The answer to install the engines must be yes or no.");
  // Before the token question, so the person can run `claude setup-token` with the new program.
  if (!/^no?$/i.test(install)) await installEngines(options, config(), engineFolders);

  // The running Eva of this home holds her own port, so a rerun of setup keeps it.
  const freePort =
    runningInstancePid(paths.lock, { bootId: readBootId(process.platform), isProcessAlive }) === null
      ? await firstFreePort(config().port)
      : config().port;
  // Only a script (EVA_PORT) picks the port; a person gets the free one, and `eva settings` changes it.
  saveSetting({ port: options.interactive ? freePort : await readPort(ask, freePort) });
  // Before Eva can start: her page and the `eva` commands need this token.
  if (secrets().localApiToken === undefined) saveSecret("localApiToken", options.newToken());
  await options.afterEssentials?.();
  progress.started = true;

  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = done(config().timeZone !== null)
    ? ""
    : await ask("timeZone", `Time zone, such as Europe/Madrid [${config().timeZone ?? detectedTimeZone}]: `);
  if (timeZone !== "") saveSetting({ timeZone });

  const vaultReady = (): boolean => {
    const folder = config().vaultPath;
    return folder !== null && !isEmptyFolder(folder);
  };
  // Only a person: a script answers every question again on each run.
  const vaultWasReady = done(vaultReady());
  if (!vaultWasReady) await askVault(options, ask, saveVaultPath, saveSecret);
  else if (!done(secrets().githubToken !== undefined)) {
    // Private projects need the token too, so a ready vault still gets the question.
    if (options.interactive && options.githubLogin !== null)
      await askGithubLoginOf(options, ask, saveSecret, options.githubLogin, false);
    else {
      const githubToken = await ask("githubToken", "GitHub token, for private projects (Enter to skip): ");
      if (githubToken !== "") saveSecret("githubToken", githubToken);
    }
  }
  const readyVault = config().vaultPath;
  // A new vault that had no GitHub login yet gets the push now. One with a remote has its push from sync.
  if (
    vaultWasReady &&
    readyVault !== null &&
    (await vaultNeedsPush({ folder: readyVault, runner: options.runner, environment: options.environment }))
  ) {
    options.write(`The vault in ${readyVault} is in no GitHub repository yet.`);
    await offerVaultPush(options, readyVault, ask);
  }
  // A vault brings the person's settings from another machine; a script's engine answer still wins.
  if (engine === "claude-code" || engine === "pi") saveSetting({ engines: { default: engine } });
  // A cloned vault brings the person's settings from another machine; an answer above still wins.
  if (timeZone !== "") saveSetting({ timeZone });
  else if (config().timeZone === null) saveSetting({ timeZone: detectedTimeZone });

  if (!done(config().trust.trustedRepositoryOwners.length > 0)) {
    const owners = await ask(
      "trustedOwners",
      `GitHub accounts whose repositories you trust, comma-separated [${config().trust.trustedRepositoryOwners.join(", ") || "none"}]: `,
    );
    if (owners !== "") saveSetting({ trust: { trustedRepositoryOwners: splitList(owners) } });
  }

  if (!done(secrets().claudeOauthToken !== undefined)) {
    const claudeToken = await ask(
      "claudeToken",
      `Claude token from \`claude setup-token\` (Enter to skip${secrets().claudeOauthToken === undefined ? "" : ", one is saved"}): `,
    );
    if (claudeToken !== "") saveSecret("claudeOauthToken", claudeToken);
  }
  if (engine === "") {
    const piFolder = engineFolders?.piAgent ?? join(options.userHome, ".pi", "agent");
    // Without a token, Claude Code uses its own login.
    const claudeFolder = engineFolders?.claude ?? join(options.userHome, ".claude");
    const logins = {
      "claude-code": secrets().claudeOauthToken !== undefined || claudeLoggedIn(claudeFolder),
      pi: piLoginState(piFolder) === "ok",
    };
    const moved = loggedInEngine(config().engines.default, logins);
    if (moved !== null) {
      saveSetting({ engines: { default: moved } });
      options.write(
        `Eva uses ${engineProgramNames[moved]}: it has a login, and the other engine has none. To change the default engine, open Settings in the web app.`,
      );
    }
  }

  if (!done(secrets().telegramBotToken !== undefined)) {
    const telegramToken = await ask(
      "telegramToken",
      `Telegram bot token from BotFather, optional (Enter to skip${secrets().telegramBotToken === undefined ? "" : ", one is saved"}): `,
    );
    if (telegramToken !== "") saveSecret("telegramBotToken", telegramToken);
  }
  if (secrets().telegramBotToken !== undefined && !done(config().telegram.allowedChatId !== null)) {
    const current = config().telegram.allowedChatId;
    const chatId = await ask(
      "telegramChatId",
      `Telegram chat id that may talk to Eva (Enter to pair with a code instead) [${current === null ? "none" : String(current)}]: `,
    );
    if (/^-?\d+$/.test(chatId)) saveSetting({ telegram: { allowedChatId: Number(chatId) } });
    else if (chatId !== "") {
      const problem = "A Telegram chat id is a whole number.";
      if (!options.interactive) throw new EvaError("config_invalid", problem);
      options.write(`${problem} Pair the chat with the code from \`eva status\` instead.`);
    }
  }

  if (!done(config().google.email !== null)) {
    options.write(
      "Google is optional. To skip the Google questions, press Enter. Settings in the web app show each Google step, with its links.",
    );
    const googleEmail = await ask(
      "googleEmail",
      `Google account for Calendar, Drive, Contacts and Tasks [${config().google.email ?? "none"}]: `,
    );
    if (googleEmail !== "") saveSetting({ google: { email: googleEmail } });
  }
  const googleClient = (): boolean =>
    secrets().googleOauthClientId !== undefined && secrets().googleOauthClientSecret !== undefined;
  if (config().google.email !== null && !done(googleClient())) {
    const clientId = await ask("googleClientId", "Google OAuth client id (Enter to keep): ");
    if (clientId !== "") saveSecret("googleOauthClientId", clientId);
    const clientSecret = await ask("googleClientSecret", "Google OAuth client secret (Enter to keep): ");
    if (clientSecret !== "") saveSecret("googleOauthClientSecret", clientSecret);
  }

  if (!done(config().voice.modelPath !== null)) {
    const voiceModel = await ask(
      "voiceModel",
      `whisper.cpp model file for voice notes [${config().voice.modelPath ?? "none"}]: `,
    );
    if (voiceModel !== "") saveSetting({ voice: { modelPath: voiceModel } });
  }

  if (refusal.error !== null) throw refusal.error;
  if (engineFolders !== null) {
    const state = await loginState(engineFolders);
    const claudeTokenHint = options.interactive
      ? `run \`eva --home ${quoteForShell(paths.root, options.platform)} setup\` again, and give it the token`
      : `run setup again with the token in ${setupEnvironmentNames.claudeToken}`;
    for (const line of engineLoginReport(state, engineFolders, claudeTokenHint, options.platform)) {
      options.write(line);
    }
  }
  const vaultPath = config().vaultPath;
  const files = [
    paths.config,
    paths.secrets,
    ...(vaultPath !== null && existsSync(vaultPath) ? [vaultSettingsPath(vaultPath)] : []),
  ];
  options.write(`Saved ${files.join(", ")}.`);
  return { changedAfterStart: progress.changedAfterStart };
}

/**
 * The GitHub login: the browser login, or a pasted token. `enterLogsIn`: false keeps Enter as
 * "skip" when the vault is ready and the login serves only private projects, as in a rerun.
 */
async function askGithubLoginOf(
  options: SetupOptions,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
  saveSecret: (name: keyof EvaSecrets, value: string) => void,
  githubLogin: NonNullable<SetupOptions["githubLogin"]>,
  enterLogsIn: boolean,
): Promise<void> {
  const githubToken = (): string | undefined => loadSecrets(homePaths(options.paths.root)).githubToken;
  options.write(githubLoginAccess);
  for (;;) {
    const answer = await ask(
      "githubToken",
      githubToken() !== undefined
        ? "GitHub login, for a private vault and private projects: press Enter to keep the saved one, type login to log in again, or paste a token: "
        : enterLogsIn
          ? "GitHub login, for a private vault and private projects: press Enter to log in with your browser, paste a token, or type skip: "
          : "GitHub login, for a private vault and private projects: type login to log in with your browser, paste a token, or press Enter to skip: ",
    );
    const keyword = answer.toLowerCase();
    if (keyword === "skip" || (answer === "" && (githubToken() !== undefined || !enterLogsIn))) return;
    if (answer !== "" && keyword !== "login") {
      saveSecret("githubToken", answer);
      return;
    }
    try {
      saveSecret(
        "githubToken",
        await githubLogin((code, link) => {
          options.write(
            `Open ${link} and enter the code ${code}. Setup waits until you confirm. Press Ctrl+C to stop setup.`,
          );
        }),
      );
      options.write("Logged in to GitHub.");
      return;
    } catch (error) {
      if (!isEvaError(error, "github_failed")) throw error;
      options.write(error.message);
    }
  }
}

/**
 * The vault questions: the GitHub login first, then the vault's repository, picked from the
 * person's repositories, and its folder. A new vault starts from the template.
 */
async function askVault(
  options: SetupOptions,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
  saveVaultPath: (folder: string) => void,
  saveSecret: (name: keyof EvaSecrets, value: string) => void,
): Promise<void> {
  const paths = homePaths(options.paths.root);
  const githubToken = (): string | undefined => loadSecrets(paths).githubToken;
  const askGithubToken = async (): Promise<void> => {
    const answer = await ask(
      "githubToken",
      `GitHub token, for a private vault over HTTPS (Enter to skip${githubToken() === undefined ? "" : ", one is saved"}): `,
    );
    // Saved now, so a failed clone never makes the person type the token again.
    if (answer !== "") saveSecret("githubToken", answer);
  };
  const askRepository = async (): Promise<VaultChoice> => {
    // The login comes first, so the person picks the vault from a list instead of typing its address.
    // A script cannot wait for a person, so it gives a token, or none.
    if (options.interactive && options.githubLogin !== null)
      await askGithubLoginOf(options, ask, saveSecret, options.githubLogin, true);
    else await askGithubToken();
    const token = githubToken();
    if (options.interactive && token !== undefined) {
      const picked = await pickRepository(options, ask, token);
      if (picked !== null) return picked;
    }
    const repository = await ask(
      "vaultRepository",
      "Your vault's repository, such as https://github.com/you/vault (Enter to skip, or to start a new vault): ",
    );
    return { repository, create: false };
  };
  const first = await askRepository();
  if (first.skip === true) return;
  let { repository, create } = first;
  // Eva clones the vault herself: with a repository, the folder has a default, so only
  // a script (EVA_VAULT_PATH) picks another one.
  const current = loadSettings(paths).config.vaultPath;
  const defaultFolder = current ?? (repository === "" && !create ? null : join(paths.root, "vault"));
  const answer =
    (repository === "" && !create) || !options.interactive
      ? await ask("vault", `Vault folder [${defaultFolder ?? "none"}]: `)
      : "";
  const folder = answer === "" ? defaultFolder : answer;
  if (folder === null) return;
  saveVaultPath(folder);
  if (!isEmptyFolder(folder)) {
    if (create)
      options.write(`${folder} is not empty, so Eva does not put a new vault there. It is your vault folder now.`);
    return;
  }
  const gitEnvironment = (): Record<string, string> => {
    const token = githubToken();
    return { ...options.environment, ...(token === undefined ? {} : { [githubTokenVariable]: token }) };
  };
  while (repository !== "") {
    const reason = await checkVaultRepository({ repository, runner: options.runner, environment: gitEnvironment() });
    if (reason === null) break;
    const problem = `git could not read ${repository}: ${reason}`;
    if (!options.interactive) throw new EvaError("config_invalid", problem);
    options.write(`${problem}\nCheck the address and the token, then try again.`);
    ({ repository, create } = await askRepository());
  }
  if (repository !== "") {
    await cloneVault({ repository, folder, runner: options.runner, environment: gitEnvironment() });
    options.write(`Cloned the vault into ${folder}.`);
  } else {
    const timeZone = loadSettings(paths).config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    await offerNewVault(options, folder, timeZone, ask, create);
  }
}

/** The vault's repository address, or "" with `create` for a new vault, or "" alone to skip. */
interface VaultChoice {
  readonly repository: string;
  readonly create: boolean;
  /** Enter at the list: no vault now. "0" creates one, so Enter does not ask about it again. */
  readonly skip?: boolean;
}

// Enough to find a vault at a glance on a phone screen; a name or an address reaches the others.
const listedRepositories = 15;

/**
 * Lists the person's repositories, and asks which one holds the vault. Returns null when GitHub
 * cannot list them, such as for a token that reaches only some repositories: setup then asks for the address.
 */
async function pickRepository(
  options: SetupOptions,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
  token: string,
): Promise<VaultChoice | null> {
  let repositories: GitHubRepository[];
  try {
    repositories = await listGitHubRepositories({
      token,
      ...(options.githubApiBaseUrl === undefined ? {} : { baseUrl: options.githubApiBaseUrl }),
    });
  } catch (error) {
    if (!isEvaError(error, "github_failed")) throw error;
    options.write(`Eva could not list your GitHub repositories. ${error.message}`);
    return null;
  }
  const shown = repositories.slice(0, listedRepositories);
  options.write(
    [
      "Your GitHub repositories, pushed most recently first:",
      "  0. Create a new vault",
      ...shown.map(
        (repository, index) =>
          `  ${String(index + 1)}. ${repository.fullName}${repository.private ? " (private)" : ""}`,
      ),
    ].join("\n"),
  );
  for (;;) {
    const answer = await ask(
      "vaultRepository",
      "Your vault: type its number, its name, or its address (Enter to skip): ",
    );
    if (answer === "") return { repository: "", create: false, skip: true };
    if (answer === "0") return { repository: "", create: true };
    if (/^\d+$/.test(answer)) {
      const repository = shown[Number(answer) - 1];
      if (repository !== undefined) return { repository: repository.cloneUrl, create: false };
      options.write(`No repository has the number ${answer}.`);
      continue;
    }
    // A name from the whole list, not only the shown part: `vault` or `you/vault`.
    const name = answer.toLowerCase();
    const named = repositories.filter(
      (repository) =>
        repository.fullName.toLowerCase() === name || repository.fullName.toLowerCase().split("/")[1] === name,
    );
    const only = named.length === 1 ? named[0] : undefined;
    if (only !== undefined) return { repository: only.cloneUrl, create: false };
    if (named.length > 1) {
      options.write(
        `Several repositories are named ${answer}: ${named.map((each) => each.fullName).join(", ")}. Type the full name.`,
      );
      continue;
    }
    if (isAddress(answer)) return { repository: answer, create: false };
    // A repository that is not in the list, such as one of the oldest.
    if (/^[\w.-]+\/[\w.-]+$/.test(answer)) return { repository: `https://github.com/${answer}.git`, create: false };
    // Never a bare word to git, which would read it as a folder on this computer.
    options.write(`No repository is named ${answer}. Type a number, a name such as you/vault, or an address.`);
  }
}

/**
 * Installs each engine's missing program, with no question: one path is simpler than a choice.
 * A failed install gives the steps, and setup goes on.
 */
async function installEngines(
  options: SetupOptions,
  config: EvaConfig,
  engineFolders: EngineFolders | null,
): Promise<void> {
  for (const engine of ["claude-code", "pi"] as const) {
    const inputs: EngineInstallInputs = {
      runner: options.runner,
      environment: options.installEnvironment,
      platform: options.platform,
      arch: options.arch,
      homeFolder: options.userHome,
      configured: engine === "claude-code" ? config.engines.claudeCode.executable : config.engines.pi.executable,
      ...(options.piReleasesBaseUrl === undefined ? {} : { piReleasesBaseUrl: options.piReleasesBaseUrl }),
    };
    if ((await findEngineProgram(engine, inputs)) !== null) continue;
    const name = engineProgramNames[engine];
    options.write(`Installing ${name}. This can take a few minutes.`);
    let program: string;
    try {
      program = await installEngine(engine, inputs);
    } catch (error) {
      if (!isEvaError(error, "engine_install_failed")) throw error;
      options.write(`${error.message} Setup goes on without it.`);
      continue;
    }
    options.write(`Installed ${name}: ${program}.`);
    const run = commandLine(program, options.platform);
    options.write(
      engine === "claude-code"
        ? `For a Claude subscription, run \`${run} setup-token\` in another terminal. It makes the token for the Claude question.`
        : `For another provider, run \`${piLogin(run, engineFolders, options.platform)}\` in another terminal, and type /login. Never choose Anthropic: a Claude login in pi bills as extra usage.`,
    );
  }
}

/**
 * The default engine moves only when it has no login and the other engine has one. So Claude
 * Code stays when both have a login, and a choice made on the web page stays too.
 */
function loggedInEngine(current: EngineName, logins: Readonly<Record<EngineName, boolean>>): EngineName | null {
  const other: EngineName = current === "claude-code" ? "pi" : "claude-code";
  return logins[current] || !logins[other] ? null : other;
}

/**
 * A missing or empty vault folder: Eva can start a vault there from her template.
 * `chosen`: the person already chose "Create a new vault" from the list of repositories.
 */
async function offerNewVault(
  options: SetupOptions,
  folder: string,
  timeZone: string,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
  chosen: boolean,
): Promise<void> {
  if (!chosen) {
    const create = await ask("createVault", `${folder} holds no vault. Create a new vault there? [y/N]: `);
    if (!/^y(es)?$/i.test(create)) return;
  }
  const name = (await ask("name", "What should Eva call you? ")) || "the owner";
  const language = (await ask("language", "The language for Eva's answers [English]: ")) || "English";
  const topics = splitList(
    await ask("topics", "Your main topics, comma-separated, such as work, family, music (Enter to skip): "),
  );
  await createVaultFromTemplate({
    folder,
    answers: { name, language, timeZone, topics },
    runner: options.runner,
    environment: options.environment,
  });
  options.write(`Created a new vault in ${folder}.`);
  await offerVaultPush(options, folder, ask);
}

/**
 * Puts a new vault in a private GitHub repository, made through the GitHub API with the login token.
 * The local vault comes first, so a failed create or push loses nothing, and a rerun offers it again.
 */
async function offerVaultPush(
  options: SetupOptions,
  folder: string,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
): Promise<void> {
  const token = loadSecrets(homePaths(options.paths.root)).githubToken;
  if (token === undefined) {
    options.write(
      "To keep the vault in a private GitHub repository, log in to GitHub: run `eva setup` again, and log in at the GitHub question.",
    );
    return;
  }
  // A push can fail after GitHub made the repository; a retry with the same name then pushes to it again.
  const created = new Map<string, string>();
  for (;;) {
    const answer = await ask(
      "githubRepository",
      "Name of a new private GitHub repository for the vault, such as vault, or the address of an empty one (Enter to skip): ",
    );
    if (answer === "") return;
    try {
      let repository = isAddress(answer) ? answer : (created.get(answer) ?? "");
      if (repository === "") {
        const made = await createGitHubRepository({
          token,
          name: answer,
          ...(options.githubApiBaseUrl === undefined ? {} : { baseUrl: options.githubApiBaseUrl }),
        });
        options.write(`Created the private repository ${made.fullName}.`);
        created.set(answer, made.cloneUrl);
        repository = made.cloneUrl;
      }
      await pushNewVault({
        repository,
        folder,
        runner: options.runner,
        environment: { ...options.environment, [githubTokenVariable]: token },
      });
      options.write(`Pushed the vault to ${repository}.`);
      return;
    } catch (error) {
      if (!isEvaError(error, "github_failed") && !isEvaError(error, "git_failed")) throw error;
      options.write(error.message);
      // A script goes on with the local vault, and says why above.
      if (!options.interactive) return;
      options.write(
        created.size > 0
          ? "Type the same name to push again, or type another name, or paste the address of an empty repository."
          : "Type another name. Or create an empty private repository on github.com, and paste its address here.",
      );
    }
  }
}

/** A git address or a folder on this computer, not a bare repository name such as `vault`. */
function isAddress(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/|^[^/\s]+@[^:\s]+:|^[a-z]:[\\/]|^\.{0,2}[\\/]/i.test(text);
}

async function readPort(
  ask: (key: SetupQuestion, question: string) => Promise<string>,
  current: number,
): Promise<number> {
  const port = await ask("port", `Local port [${String(current)}]: `);
  if (port === "") return current;
  const value = Number(port);
  if (Number.isInteger(value) && value >= 1024 && value <= 65535) return value;
  throw new EvaError("config_invalid", "The port must be a whole number from 1024 to 65535.");
}

/**
 * The first port from `start` up that nothing listens on, so a second instance on one machine
 * gets its own port. A running instance's own port counts as taken too, so the
 * caller skips this check for the home whose Eva runs now.
 */
export async function firstFreePort(start: number): Promise<number> {
  for (let port = start; port < Math.min(start + 50, 65_536); port += 1) {
    if (await isPortFree(port)) return port;
  }
  return start;
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });
    await probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

function isEmptyFolder(folder: string): boolean {
  return !existsSync(folder) || readdirSync(folder).length === 0;
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** How a person types the program in their shell: a bare name as it is, or a quoted path. */
function commandLine(program: string, platform: NodeJS.Platform): string {
  if (!/[\\/]/.test(program)) return program;
  // PowerShell runs a quoted path only after its call operator.
  return platform === "win32" ? `& ${quoteForShell(program, platform)}` : quoteForShell(program, platform);
}

/** The pi command for a login. An extra instance keeps its pi login in its own folder. */
function piLogin(run: string, engineFolders: EngineFolders | null, platform: NodeJS.Platform): string {
  return engineFolders === null ? run : withVariable("PI_CODING_AGENT_DIR", engineFolders.piAgent, [run], platform);
}

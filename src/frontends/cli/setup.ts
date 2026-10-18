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
  engineFolders as engineFoldersOf,
  type EngineFolders,
  loadSecrets,
  saveSecrets,
  type EvaConfig,
  type EvaSecrets,
  type HomePaths,
} from "../../core/settings/home.ts";
import { isProcessAlive, readBootId, runningInstancePid } from "../../core/instance/instance-lock.ts";
import { loadSettings, saveSettings, vaultSettingsPath, withVaultSettings } from "../../core/settings/settings.ts";
import { checkVaultRepository, cloneVault, githubTokenVariable } from "../../core/vault/vault-clone.ts";
import { createVaultFromTemplate } from "../../core/vault/vault-template.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import {
  engineLoginReport,
  engineLoginState,
  engineLoginSteps,
  loginToGitHub,
  quoteForShell,
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
}

const ghTimeoutMs = 120_000;

export async function runSetup(options: SetupOptions): Promise<void> {
  const paths = homePaths(options.paths.root);
  let config: EvaConfig = loadSettings(paths).config;
  const secrets: EvaSecrets = { ...loadSecrets(paths) };
  const ask = async (key: SetupQuestion, question: string): Promise<string> =>
    (await options.ask(key, question)).trim();
  options.write(`Eva setup. Press Enter to keep the value in brackets. Home: ${paths.root}`);
  // First, so the person can log in to gh before setup runs `gh repo create`.
  const engineFolders = isExtraInstance(paths, options.defaultHome, options.platform) ? engineFoldersOf(paths) : null;
  const loginState = (folders: EngineFolders): Promise<EngineLoginState> =>
    engineLoginState({
      folders,
      claudeTokenSaved: secrets.claudeOauthToken !== undefined,
      runner: options.runner,
      environment: options.environment,
    });
  // A script gets no steps: setup ends at once, and the report at the end says what to run.
  if (engineFolders !== null && options.interactive) {
    for (const line of engineLoginSteps(await loginState(engineFolders), engineFolders, options.platform)) {
      options.write(line);
    }
  }

  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = await ask("timeZone", `Time zone, such as Europe/Madrid [${config.timeZone ?? detectedTimeZone}]: `);
  if (timeZone !== "") config = { ...config, timeZone };

  const askRepository = async (): Promise<string> => {
    const githubToken = await ask(
      "githubToken",
      `GitHub token, for a private vault over HTTPS (Enter to skip${secrets.githubToken === undefined ? "" : ", one is saved"}): `,
    );
    if (githubToken !== "") {
      secrets.githubToken = githubToken;
      // Saved now, so a failed clone never makes the person type the token again.
      saveSecrets(paths, secrets);
    }
    return ask(
      "vaultRepository",
      "Your vault's repository, such as https://github.com/you/vault (Enter to skip, or to start a new vault): ",
    );
  };
  let repository = await askRepository();
  // Eva clones the vault herself: with a repository, the folder has a default, so only
  // a script (EVA_VAULT_PATH) picks another one.
  const defaultFolder = config.vaultPath ?? (repository === "" ? null : join(paths.root, "vault"));
  const vaultPath =
    repository === "" || !options.interactive ? await ask("vault", `Vault folder [${defaultFolder ?? "none"}]: `) : "";
  const chosenFolder = vaultPath === "" ? defaultFolder : vaultPath;
  if (chosenFolder !== null) config = { ...config, vaultPath: chosenFolder };
  if (config.vaultPath !== null && isEmptyFolder(config.vaultPath)) {
    const gitEnvironment = (): Record<string, string> => ({
      ...options.environment,
      ...(secrets.githubToken === undefined ? {} : { [githubTokenVariable]: secrets.githubToken }),
    });
    while (repository !== "") {
      const reason = await checkVaultRepository({ repository, runner: options.runner, environment: gitEnvironment() });
      if (reason === null) break;
      const problem = `git could not read ${repository}: ${reason}`;
      if (!options.interactive) throw new EvaError("config_invalid", problem);
      options.write(`${problem}\nCheck the address and the token, then try again.`);
      repository = await askRepository();
    }
    if (repository !== "") {
      await cloneVault({ repository, folder: config.vaultPath, runner: options.runner, environment: gitEnvironment() });
      options.write(`Cloned the vault into ${config.vaultPath}.`);
    } else {
      await offerNewVault(options, engineFolders, config.vaultPath, config.timeZone ?? detectedTimeZone, ask);
    }
  }

  // A cloned vault brings the person's settings from another machine; an answer above still wins.
  config = withVaultSettings(config).config;
  if (timeZone !== "") config = { ...config, timeZone };
  else if (config.timeZone === null) config = { ...config, timeZone: detectedTimeZone };

  const engine = await ask("engine", `Default engine, claude-code or pi [${config.engines.default}]: `);
  if (engine === "claude-code" || engine === "pi")
    config = { ...config, engines: { ...config.engines, default: engine } };
  else if (engine !== "") {
    const problem = "The engine must be claude-code or pi.";
    if (!options.interactive) throw new EvaError("config_invalid", problem);
    options.write(`${problem} The engine stays ${config.engines.default}.`);
  }

  // The running Eva of this home holds her own port, so a rerun of setup keeps it.
  const freePort =
    runningInstancePid(paths.lock, { bootId: readBootId(process.platform), isProcessAlive }) === null
      ? await firstFreePort(config.port)
      : config.port;
  // Only a script (EVA_PORT) picks the port; a person gets the free one, and `eva settings` changes it.
  config = { ...config, port: options.interactive ? freePort : await readPort(ask, freePort) };

  const owners = await ask(
    "trustedOwners",
    `GitHub accounts whose repositories you trust, comma-separated [${config.trust.trustedRepositoryOwners.join(", ") || "none"}]: `,
  );
  if (owners !== "") config = { ...config, trust: { trustedRepositoryOwners: splitList(owners) } };

  const claudeToken = await ask(
    "claudeToken",
    `Claude token from \`claude setup-token\` (Enter to skip${secrets.claudeOauthToken === undefined ? "" : ", one is saved"}): `,
  );
  if (claudeToken !== "") secrets.claudeOauthToken = claudeToken;

  const telegramToken = await ask(
    "telegramToken",
    `Telegram bot token from BotFather (Enter to skip${secrets.telegramBotToken === undefined ? "" : ", one is saved"}): `,
  );
  if (telegramToken !== "") secrets.telegramBotToken = telegramToken;
  if (secrets.telegramBotToken !== undefined) {
    const chatId = await ask(
      "telegramChatId",
      `Telegram chat id that may talk to Eva (Enter to pair with a code instead) [${config.telegram.allowedChatId === null ? "none" : String(config.telegram.allowedChatId)}]: `,
    );
    if (/^-?\d+$/.test(chatId)) config = { ...config, telegram: { ...config.telegram, allowedChatId: Number(chatId) } };
    else if (chatId !== "") {
      const problem = "A Telegram chat id is a whole number.";
      if (!options.interactive) throw new EvaError("config_invalid", problem);
      options.write(`${problem} Pair the chat with the code from \`eva status\` instead.`);
    }
  }

  const googleEmail = await ask(
    "googleEmail",
    `Google account for Calendar, Drive, Contacts and Tasks [${config.google.email ?? "none"}]: `,
  );
  if (googleEmail !== "") config = { ...config, google: { ...config.google, email: googleEmail } };
  if (config.google.email !== null) {
    const clientId = await ask("googleClientId", "Google OAuth client id (Enter to keep): ");
    if (clientId !== "") secrets.googleOauthClientId = clientId;
    const clientSecret = await ask("googleClientSecret", "Google OAuth client secret (Enter to keep): ");
    if (clientSecret !== "") secrets.googleOauthClientSecret = clientSecret;
  }

  const voiceModel = await ask(
    "voiceModel",
    `whisper.cpp model file for voice notes [${config.voice.modelPath ?? "none"}]: `,
  );
  if (voiceModel !== "") config = { ...config, voice: { ...config.voice, modelPath: voiceModel } };

  secrets.localApiToken ??= options.newToken();
  saveSettings(paths, config);
  saveSecrets(paths, secrets);
  if (engineFolders !== null) {
    const state = await loginState(engineFolders);
    const claudeTokenHint = options.interactive
      ? `run \`eva --home ${quoteForShell(paths.root, options.platform)} setup\` again, and give it the token`
      : `run setup again with the token in ${setupEnvironmentNames.claudeToken}`;
    for (const line of engineLoginReport(state, engineFolders, claudeTokenHint, options.platform)) {
      options.write(line);
    }
  }
  const files = [
    paths.config,
    paths.secrets,
    ...(config.vaultPath !== null && existsSync(config.vaultPath) ? [vaultSettingsPath(config.vaultPath)] : []),
  ];
  options.write(`Saved ${files.join(", ")}. Run \`eva doctor\`, then \`eva\`.`);
}

/** A missing or empty vault folder: Eva can start a vault there from her template. */
async function offerNewVault(
  options: SetupOptions,
  engineFolders: EngineFolders | null,
  folder: string,
  timeZone: string,
  ask: (key: SetupQuestion, question: string) => Promise<string>,
): Promise<void> {
  const create = await ask("createVault", `${folder} holds no vault. Create a new vault there? [y/N]: `);
  if (!/^y(es)?$/i.test(create)) return;
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
  const repository = await ask(
    "githubRepository",
    "Name of a new private GitHub repository for it, made with `gh` (Enter to skip): ",
  );
  if (repository === "") return;
  const result = await options.runner.run(
    ["gh", "repo", "create", repository, "--private", "--source", folder, "--remote", "origin", "--push"],
    {
      cwd: folder,
      environment: {
        ...options.environment,
        ...(engineFolders === null ? {} : { GH_CONFIG_DIR: engineFolders.gh }),
        GIT_TERMINAL_PROMPT: "0",
      },
      timeoutMs: ghTimeoutMs,
    },
  );
  const login = engineFolders === null ? "gh auth login" : loginToGitHub(engineFolders.gh, options.platform);
  options.write(
    result.exitCode === 0
      ? `Created the private repository ${repository} and pushed the vault.`
      : `gh could not create the repository: ${result.stderr.trim()}. Run \`${login}\`, then push the vault yourself.`,
  );
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

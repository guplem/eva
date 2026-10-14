/**
 * `eva setup`: asks for each setting in the terminal and writes the instance home
 * (docs/plan.md §8.1, §11). An empty answer keeps the current value.
 */
import {
  homePaths,
  loadConfig,
  loadSecrets,
  saveConfig,
  saveSecrets,
  type EvaConfig,
  type EvaSecrets,
  type HomePaths,
} from "../../core/instance/home.ts";

export interface SetupOptions {
  readonly paths: HomePaths;
  readonly ask: (question: string) => Promise<string>;
  readonly write: (line: string) => void;
  readonly newToken: () => string;
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const paths = homePaths(options.paths.root);
  let config: EvaConfig = loadConfig(paths);
  const secrets: EvaSecrets = { ...loadSecrets(paths) };
  options.write(`Eva setup. Press Enter to keep the value in brackets. Home: ${paths.root}`);

  const vaultPath = await options.ask(`Vault folder (a git clone of your vault) [${config.vaultPath ?? "none"}]: `);
  if (vaultPath.trim() !== "") config = { ...config, vaultPath: vaultPath.trim() };

  const timeZone = await options.ask(`Time zone, such as Europe/Madrid [${config.timeZone ?? "UTC"}]: `);
  if (timeZone.trim() !== "") config = { ...config, timeZone: timeZone.trim() };

  for (;;) {
    const port = (await options.ask(`Local port [${String(config.port)}]: `)).trim();
    if (port === "") break;
    const value = Number(port);
    if (Number.isInteger(value) && value >= 1024 && value <= 65535) {
      config = { ...config, port: value };
      break;
    }
    options.write("The port must be a whole number from 1024 to 65535.");
  }

  const owners = await options.ask(
    `GitHub accounts whose repositories you trust, comma-separated [${config.trust.trustedRepositoryOwners.join(", ") || "none"}]: `,
  );
  if (owners.trim() !== "") {
    config = {
      ...config,
      trust: {
        trustedRepositoryOwners: owners
          .split(",")
          .map((owner) => owner.trim())
          .filter((owner) => owner.length > 0),
      },
    };
  }

  const claudeToken = await options.ask(
    `Claude token from \`claude setup-token\` (Enter to skip${secrets.claudeOauthToken === undefined ? "" : ", one is saved"}): `,
  );
  if (claudeToken.trim() !== "") secrets.claudeOauthToken = claudeToken.trim();

  const telegramToken = await options.ask(
    `Telegram bot token from BotFather (Enter to skip${secrets.telegramBotToken === undefined ? "" : ", one is saved"}): `,
  );
  if (telegramToken.trim() !== "") {
    secrets.telegramBotToken = telegramToken.trim();
    config = { ...config, telegram: { ...config.telegram, enabled: true } };
  }

  secrets.localApiToken ??= options.newToken();
  saveConfig(paths, config);
  saveSecrets(paths, secrets);
  options.write(`Saved ${paths.config} and ${paths.secrets}. Run \`eva doctor\`, then \`eva\`.`);
}

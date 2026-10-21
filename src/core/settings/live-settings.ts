/**
 * The settings and secrets of a running Eva: what the settings page reads and changes. A change
 * is saved at once; the update frequency and the vault fetch apply at once, the rest at a restart.
 */
import { cleanGoogleClientId, cleanGoogleClientSecret, googleClientIdProblem } from "../google/google-client.ts";
import { existsSync } from "node:fs";
import type { EngineName } from "../../shared/engine-port.ts";
import { EvaError } from "../../shared/errors.ts";
import { readTextTolerant } from "../../shared/files.ts";
import type { Redactor } from "../../shared/redaction.ts";
import { loadSecrets, saveSecrets, type EvaConfig, type EvaSecrets, type HomePaths } from "./home.ts";
import { applySettingsChange, loadSettings, saveSettings } from "./settings.ts";

export interface PublicSettings {
  readonly config: EvaConfig;
  /** Whether each secret is set. The values never leave the core. */
  readonly secretsSet: Readonly<Record<PageSecretName | "localApiToken", boolean>>;
}

/** The secrets that the settings page may save. The local token stays with `eva setup`. */
export const pageSecretNames = [
  "githubToken",
  "telegramBotToken",
  "claudeOauthToken",
  "googleOauthClientId",
  "googleOauthClientSecret",
] as const;
export type PageSecretName = (typeof pageSecretNames)[number];

/** What the Setup section shows beside the settings. */
export interface SetupState {
  /** The vault's `origin`, without any credentials in it. */
  readonly vaultRemote: string | null;
  readonly telegram: { readonly paired: boolean; readonly pairingCode: string | null };
  /** The engines whose program Eva found at start. */
  readonly engines: readonly EngineName[];
}

export interface LiveSettingsOptions {
  readonly paths: HomePaths;
  readonly config: EvaConfig;
  readonly secrets: EvaSecrets;
  /** Learns each new secret, so its value never reaches a log or an error unredacted. */
  readonly redactor: Redactor;
  /** The vault's `origin` URL, or null. */
  readonly readVaultRemote: () => Promise<string | null>;
  readonly engines: readonly EngineName[];
}

/** Settings that apply at once; any other change waits for a restart. */
const liveSettingKeys: readonly string[] = ["updates", "sync.pullIntervalMinutes"];

export class LiveSettings {
  private readonly options: LiveSettingsOptions;
  private settings: EvaConfig;
  /** The saved secrets. A new value reaches the checks at once, and the rest at a restart. */
  private savedSecrets: EvaSecrets;

  constructor(options: LiveSettingsOptions) {
    this.options = options;
    this.settings = options.config;
    this.savedSecrets = options.secrets;
  }

  /** The settings as changed while Eva runs. */
  get config(): EvaConfig {
    return this.settings;
  }

  get secrets(): EvaSecrets {
    return this.savedSecrets;
  }

  publicSettings(): PublicSettings {
    const secrets = this.savedSecrets;
    return {
      config: this.settings,
      secretsSet: {
        telegramBotToken: secrets.telegramBotToken !== undefined,
        claudeOauthToken: secrets.claudeOauthToken !== undefined,
        githubToken: secrets.githubToken !== undefined,
        localApiToken: secrets.localApiToken !== undefined,
        googleOauthClientId: secrets.googleOauthClientId !== undefined,
        googleOauthClientSecret: secrets.googleOauthClientSecret !== undefined,
      },
    };
  }

  /**
   * Checks and saves a settings change: the person's part in the vault, the machine's part in
   * `config.json`.
   */
  update(patch: Readonly<Record<string, unknown>>): { saved: true; restartNeeded: boolean } {
    const keys = changedKeys(patch, "");
    const changed = applySettingsChange(this.savedSettings(), patch);
    saveSettings(this.options.paths, changed);
    this.settings = changed;
    const restartNeeded = keys.some(
      (key) => !liveSettingKeys.some((live) => key === live || key.startsWith(`${live}.`)),
    );
    return { saved: true, restartNeeded };
  }

  async setupState(): Promise<SetupState> {
    const remote = await this.options.readVaultRemote();
    const pairedChat = this.savedSettings().telegram.allowedChatId;
    // Only a running bot reads the code, and it runs only with a token; an old file stays after a removal.
    const code =
      this.savedSecrets.telegramBotToken === undefined
        ? ""
        : (readTextTolerant(this.options.paths.telegramPairingCode)?.trim() ?? "");
    return {
      vaultRemote: remote === null ? null : this.options.redactor.redact(remote.replace(/\/\/[^/@]*@/, "//")),
      telegram: { paired: pairedChat !== null, pairingCode: pairedChat === null && code !== "" ? code : null },
      engines: this.options.engines,
    };
  }

  /**
   * Saves one secret that the settings page may change, or removes it with null. The value never
   * comes back. The git, engine and Telegram processes read the secrets at start, so a restart follows.
   */
  saveSecret(name: PageSecretName, value: string | null): { saved: true; restartNeeded: true } {
    const trimmed = value === null ? null : cleanedSecret(name, value);
    if (trimmed === "") throw new EvaError("config_invalid", "A secret cannot be empty. Remove it instead.");
    const problem = name === "googleOauthClientId" && trimmed !== null ? googleClientIdProblem(trimmed) : null;
    if (problem !== null) throw new EvaError("config_invalid", problem);
    // Before anything else, so the value never reaches a log or an error unredacted.
    if (trimmed !== null) this.options.redactor.addSecret(trimmed);
    // From the file, so a secret that `eva setup` saved meanwhile stays.
    const secrets: EvaSecrets = { ...loadSecrets(this.options.paths) };
    if (trimmed === null) Reflect.deleteProperty(secrets, name);
    else secrets[name] = trimmed;
    saveSecrets(this.options.paths, secrets);
    this.savedSecrets = secrets;
    return { saved: true, restartNeeded: true };
  }

  /** The settings and secrets as saved now, also by `eva setup` in another process. */
  saved(): { readonly config: EvaConfig; readonly secrets: EvaSecrets } {
    return { config: this.savedSettings(), secrets: loadSecrets(this.options.paths) };
  }

  /**
   * The settings as saved now. The Telegram bot saves a new pairing to `config.json` while Eva
   * runs, so a change built on memory would undo it. A missing or bad file falls back to memory:
   * with a broken vault file, the loaded copy holds defaults, and a save would sync them everywhere.
   */
  private savedSettings(): EvaConfig {
    if (!existsSync(this.options.paths.config)) return this.settings;
    try {
      const loaded = loadSettings(this.options.paths);
      return loaded.problem === null ? loaded.config : this.settings;
    } catch {
      return this.settings;
    }
  }
}

/** The dotted keys that a settings change touches, such as `updates.frequency`. */
function changedKeys(change: unknown, prefix: string): string[] {
  if (change === null || typeof change !== "object" || Array.isArray(change)) return [prefix];
  return Object.entries(change).flatMap(([key, value]) => changedKeys(value, prefix === "" ? key : `${prefix}.${key}`));
}

/** A pasted secret without what a copy adds around it. A Google client id can come as a link (#323). */
function cleanedSecret(name: PageSecretName, value: string): string {
  if (name === "googleOauthClientId") return cleanGoogleClientId(value);
  if (name === "googleOauthClientSecret") return cleanGoogleClientSecret(value);
  return value.trim();
}

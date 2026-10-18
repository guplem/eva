/**
 * The start steps before the core runs: the settings moves after a pull, the hub claim and the
 * local token. The logger does not exist yet, so the steps return what they did as notes.
 */
import { existsSync } from "node:fs";
import type { EnvironmentMap } from "../../shared/environment.ts";
import type { LogLevel } from "../../shared/logger.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import {
  loadConfig,
  loadSecrets,
  saveSecrets,
  type EvaConfig,
  type EvaSecrets,
  type HomePaths,
} from "../settings/home.ts";
import { loadSettings, moveSecuritySettingsFromVault, moveSettingsToVault } from "../settings/settings.ts";
import { VaultSync } from "../vault/vault-sync.ts";
import { gitEnvironmentWithToken } from "./child-environments.ts";
import { claimHubIfUnclaimed } from "./hub.ts";

export interface StartNote {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface PreparedStart {
  readonly config: EvaConfig;
  /** The secrets, with a local token in them. */
  readonly secrets: EvaSecrets & { readonly localApiToken: string };
  readonly notes: readonly StartNote[];
}

export interface PrepareStartOptions {
  readonly paths: HomePaths;
  readonly runner: ProcessRunner;
  readonly processEnvironment: EnvironmentMap;
  /** The machine's host name: the machine's name when the settings give none. */
  readonly hostName: string;
  readonly now: () => Date;
  readonly newToken: () => string;
}

export async function prepareStart(options: PrepareStartOptions): Promise<PreparedStart> {
  const { paths } = options;
  const secrets: EvaSecrets = { ...loadSecrets(paths) };
  const notes: StartNote[] = [];
  const moved = await moveSettingsAfterPull(options, secrets);
  if (moved.toVault) notes.push({ level: "info", message: "Moved the shared settings from config.json to the vault." });
  if (moved.toMachine)
    notes.push({
      level: "info",
      message: "Moved the security settings from the vault to config.json; the vault's copy is ignored now.",
    });
  const loaded = loadSettings(paths);
  const config = loaded.config;
  if (loaded.problem !== null)
    notes.push({ level: "warn", message: "The vault's settings were not used.", fields: { problem: loaded.problem } });
  if (
    config.vaultPath !== null &&
    claimHubIfUnclaimed(config.vaultPath, config.machineName ?? options.hostName, options.now())
  )
    notes.push({ level: "info", message: "No machine was the hub yet, so this machine claimed it." });
  const localApiToken = secrets.localApiToken ?? options.newToken();
  if (secrets.localApiToken === undefined) saveSecrets(paths, { ...secrets, localApiToken });
  return { config, secrets: { ...secrets, localApiToken }, notes };
}

/**
 * Pulls the vault before the settings move to it, so this machine never starts a settings file
 * that another machine already pushed (a conflict that would stop the vault's pushes). Then the
 * security settings move the other way, out of the vault.
 */
async function moveSettingsAfterPull(
  options: PrepareStartOptions,
  secrets: EvaSecrets,
): Promise<{ toVault: boolean; toMachine: boolean }> {
  const vaultPath = loadConfig(options.paths).vaultPath;
  if (vaultPath === null || !existsSync(vaultPath)) return { toVault: false, toMachine: false };
  await new VaultSync({
    vaultPath,
    runner: options.runner,
    environment: gitEnvironmentWithToken(options.processEnvironment, secrets),
    now: options.now,
  }).pull();
  return { toVault: moveSettingsToVault(options.paths), toMachine: moveSecuritySettingsFromVault(options.paths) };
}

/**
 * The start steps before the core runs: the vault pull, the hub claim, the migrations and the
 * local token. The logger does not exist yet, so the steps return what they did as notes.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { evaVersion } from "../../shared/version.ts";
import { runStartMigrations, type StartMigrations } from "../migrations/migrations.ts";
import { withMachineDefaults } from "../settings/machine-defaults.ts";
import { loadSettings } from "../settings/settings.ts";
import { VaultSync, type VaultSyncStatus } from "../vault/vault-sync.ts";
import { gitEnvironmentWithToken } from "./child-environments.ts";
import { commitIdentity } from "./commit-identity.ts";
import { claimHubIfUnclaimed, machineRole } from "./hub.ts";

const remoteListTimeoutMs = 20_000;

/** Why a start did not claim the hub. "ok" never blocks a claim. */
const pullProblems: Readonly<Record<VaultSyncStatus, string>> = {
  ok: "The vault pull worked",
  offline: "The vault pull could not reach the remote",
  conflict: "The vault pull found a conflict",
  error: "The vault pull failed",
  skipped: "The vault is not on its default branch",
};

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
  /** Eva reports them after the Telegram bot starts, so that a failure reaches the phone. */
  readonly migrations: StartMigrations;
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
  const migrations = await migrateAfterPull(options, secrets, notes);
  const loaded = loadSettings(paths);
  const config = loaded.config;
  if (loaded.problem !== null)
    notes.push({ level: "warn", message: "The vault's settings were not used.", fields: { problem: loaded.problem } });
  const localApiToken = secrets.localApiToken ?? options.newToken();
  if (secrets.localApiToken === undefined) saveSecrets(paths, { ...secrets, localApiToken });
  return { config, secrets: { ...secrets, localApiToken }, notes, migrations };
}

/**
 * Pulls the vault, claims the hub when no machine has it, then runs the missing migrations: the
 * machine's on every computer, the vault's on the hub only. The pull comes first, so the hub never
 * starts a file that another machine already pushed (a conflict that would stop the vault's pushes).
 */
async function migrateAfterPull(
  options: PrepareStartOptions,
  secrets: EvaSecrets,
  notes: StartNote[],
): Promise<StartMigrations> {
  // The machine defaults find the vault in the home folder when config.json names none.
  const machineConfig = withMachineDefaults(loadConfig(options.paths), {
    homeRoot: options.paths.root,
    exists: existsSync,
  });
  const machine = machineConfig.machineName ?? options.hostName;
  const configuredVault = machineConfig.vaultPath;
  const vaultPath = configuredVault !== null && existsSync(configuredVault) ? configuredVault : null;
  if (vaultPath !== null) {
    const environment = gitEnvironmentWithToken(
      options.processEnvironment,
      secrets,
      commitIdentity(options.paths, machineConfig),
    );
    const pulled = await new VaultSync({ vaultPath, runner: options.runner, environment, now: options.now }).pull();
    // A failed pull may hide a claim that another machine pushed. A vault with no remote has no such claim.
    // A vault with an unpushed merge commit skips the fetch, and "ok" is then the state before the pull.
    const canClaim = pulled.status === "ok" || (await hasNoOrigin(vaultPath, options.runner, environment));
    if (!canClaim)
      notes.push({
        level: "warn",
        message: `${pullProblems[pulled.status]}, so this machine did not claim the hub yet.`,
        fields: { status: pulled.status, error: pulled.lastError },
      });
    else if (claimHubIfUnclaimed(vaultPath, machine, options.now()))
      notes.push({ level: "info", message: "No machine was the hub yet, so this machine claimed it." });
  }
  return runStartMigrations({
    paths: options.paths,
    // A machine migration waits for a vault that is not cloned yet; the vault store runs only on a clone.
    vaultPath: configuredVault,
    isHub: () => vaultPath !== null && machineRole(vaultPath, machine, "satellite") === "hub",
    version: evaVersion,
    now: options.now,
  });
}

/**
 * True only when git says that the vault has no `origin`, or the folder is no repository. A git
 * that fails, such as on a timeout, is no answer: a claim then could hide a pushed one.
 */
async function hasNoOrigin(
  vaultPath: string,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<boolean> {
  if (!existsSync(join(vaultPath, ".git"))) return true;
  const remotes = await runner.run(["git", "remote"], {
    cwd: vaultPath,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: remoteListTimeoutMs,
  });
  return remotes.exitCode === 0 && !remotes.stdout.split("\n").some((line) => line.trim() === "origin");
}

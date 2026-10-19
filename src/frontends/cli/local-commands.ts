/**
 * The commands that go through the running Eva when one runs with this home, and do the work
 * here when none runs: `update`, `sync`, `hub`, `link` and `settings`.
 */
import { claimHub } from "../../core/instance/hub.ts";
import { gitEnvironmentWithToken } from "../../core/instance/child-environments.ts";
import { runningInstancePid } from "../../core/instance/instance-lock.ts";
import { loadConfig, loadSecrets, type EvaSecrets, type HomePaths } from "../../core/settings/home.ts";
import { executableUpdateChannel } from "../../core/updates/self-update.ts";
import { sourceUpdateChannel } from "../../core/updates/source-update.ts";
import { Updater, type UpdateChannel } from "../../core/updates/updater.ts";
import {
  changeSettings,
  describeSettings,
  isSharedSettingKey,
  loadSettings,
  settingChange,
} from "../../core/settings/settings.ts";
import { VaultSync } from "../../core/vault/vault-sync.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { evaVersion } from "../../shared/version.ts";
import type { CliCommand } from "./arguments.ts";
import {
  describeRelease,
  describeSync,
  describeUpdateWithHint,
  requestHub,
  requestSettingsChange,
  requestStatus,
  requestSync,
  requestUpdate,
  type ClientOptions,
} from "./client.ts";
import { childEnvironment, writeLine, type CliHost } from "./host.ts";
import { accessLines } from "./network-setup.ts";

/** `eva update`: the running Eva updates and restarts herself; a stopped Eva is updated here. */
export async function update(
  host: CliHost,
  paths: HomePaths,
  checkOnly: boolean,
  version: string | null,
): Promise<number> {
  const client = runningClient(host, paths);
  if (client !== null) {
    writeLine(host, await requestUpdate(client, checkOnly, version));
    return exitCodes.clean;
  }
  const settings = loadSettings(paths).config.updates;
  // The same rules as a running Eva: the policy picks, unless the person names a version.
  const updater = new Updater({
    channel: updateChannel(host, loadSecrets(paths)),
    frequency: () => settings.frequency,
    policy: () => settings.install,
    isIdle: () => true,
    restart: () => undefined,
    now: () => new Date(),
  });
  const checked = await updater.check();
  const release = checkOnly || version === null ? null : describeRelease(checked, version);
  if (release !== null) writeLine(host, `${release}\n`);
  const status = checkOnly ? checked : await updater.updateNow(version ?? undefined);
  writeLine(
    host,
    status.phase === "restarting"
      ? `Updated Eva from ${status.current ?? "?"} to ${status.latest ?? "?"}.`
      : describeUpdateWithHint(status),
  );
  return status.lastError === null ? exitCodes.clean : exitCodes.crash;
}

/** `eva sync`: the running Eva syncs; a stopped Eva syncs here. */
export async function sync(host: CliHost, paths: HomePaths): Promise<number> {
  const client = runningClient(host, paths);
  if (client !== null) {
    writeLine(host, await requestSync(client));
    return exitCodes.clean;
  }
  const vaultPath = loadConfig(paths).vaultPath;
  if (vaultPath === null) {
    writeLine(host, "No vault is configured. Run `eva setup` first.");
    return exitCodes.badConfig;
  }
  const vaultSync = new VaultSync({
    vaultPath,
    runner: host.runner,
    environment: gitEnvironmentWithToken(host.environment, loadSecrets(paths)),
    now: () => new Date(),
  });
  await vaultSync.pull();
  const state = await vaultSync.save();
  writeLine(host, describeSync(state));
  return state.status === "ok" ? exitCodes.clean : exitCodes.crash;
}

/** `eva link`: the address that opens Eva on the phone and other computers. */
export async function link(host: CliHost, paths: HomePaths): Promise<number> {
  const client = runningClient(host, paths);
  if (client === null) {
    writeLine(host, "Eva is not running, so she publishes no address. Start her with `eva`, or run `eva setup`.");
    return exitCodes.crash;
  }
  const status = await requestStatus(client);
  writeLine(
    host,
    accessLines({
      remoteAccess: status.remoteAccess,
      localUrl: status.localUrl,
      actionHint: "Run `eva setup`, or open Settings in Eva's web page, to let Eva do these steps.",
    }).join("\n"),
  );
  return exitCodes.clean;
}

/** `eva hub`: makes this machine the hub; the old hub stops at its next vault fetch. */
export async function hub(host: CliHost, paths: HomePaths): Promise<number> {
  const client = runningClient(host, paths);
  if (client !== null) {
    writeLine(host, await requestHub(client));
    return exitCodes.clean;
  }
  const config = loadSettings(paths).config;
  if (config.vaultPath === null) {
    writeLine(host, "Without a vault, this machine is always the hub.");
    return exitCodes.clean;
  }
  const machine = config.machineName ?? host.hostName;
  const vaultSync = new VaultSync({
    vaultPath: config.vaultPath,
    runner: host.runner,
    environment: gitEnvironmentWithToken(host.environment, loadSecrets(paths)),
    now: () => new Date(),
  });
  await vaultSync.pull();
  claimHub(config.vaultPath, machine, new Date());
  writeLine(host, `${machine} is now the hub. ${describeSync(await vaultSync.save())}`);
  return exitCodes.clean;
}

/** `eva settings`: shows or changes a setting, through the running Eva when one runs. */
export async function settings(
  host: CliHost,
  paths: HomePaths,
  command: Extract<CliCommand, { command: "settings" }>,
): Promise<number> {
  const loaded = loadSettings(paths);
  if (loaded.problem !== null) writeLine(host, `The vault's settings were not used: ${loaded.problem}`);
  const lines = describeSettings(loaded.config);
  if (command.action === "list") {
    writeLine(host, lines.join("\n"));
    return exitCodes.clean;
  }
  const key = command.key ?? "";
  if (command.action === "get") {
    const found = lines.filter((line) => line.startsWith(`${key} = `) || line.startsWith(`${key}.`));
    writeLine(host, found.length === 0 ? `${key} is not a setting.` : found.join("\n"));
    return found.length === 0 ? exitCodes.badConfig : exitCodes.clean;
  }
  const change = settingChange(key, command.value ?? "");
  const client = runningClient(host, paths);
  const place = isSharedSettingKey(key) ? "in the vault, for every machine" : "on this machine";
  if (client === null) {
    changeSettings(paths, change);
    writeLine(host, `Saved ${key} ${place}.`);
  } else {
    const restartNeeded = await requestSettingsChange(client, change);
    writeLine(host, `Saved ${key} ${place}.${restartNeeded ? " Restart Eva to use it." : " Eva uses it now."}`);
  }
  return exitCodes.clean;
}

/** The API of the Eva that runs with this home, or null when none runs. */
export function runningClient(host: CliHost, paths: HomePaths): ClientOptions | null {
  const token = loadSecrets(paths).localApiToken;
  const probe = { bootId: host.bootId, isProcessAlive: host.isProcessAlive };
  if (token === undefined || runningInstancePid(paths.lock, probe) === null) return null;
  return { baseUrl: `http://127.0.0.1:${String(loadConfig(paths).port)}`, token };
}

/** Signed releases for the single executable; git for a source checkout. */
export function updateChannel(host: CliHost, secrets: EvaSecrets): UpdateChannel {
  if (host.standalone) {
    return executableUpdateChannel({
      currentVersion: evaVersion,
      executablePath: host.execPath,
      platform: host.platform,
      arch: host.arch,
      runner: host.runner,
      environment: childEnvironment(host),
    });
  }
  return sourceUpdateChannel({
    folder: host.sourceFolder,
    runner: host.runner,
    // Eva's own git commands, before or without a running core: the token, but not the instance's gh folder.
    environment: gitEnvironmentWithToken(host.environment, secrets),
    bunExecutable: host.execPath,
  });
}

/**
 * `eva update`: replaces the single executable with the latest GitHub
 * release, after the signature and the checksum match. A running executable cannot
 * be overwritten on Windows, but it can be renamed, so the old file moves aside first.
 */
import { chmodSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { evaRepository } from "../../shared/version.ts";
import {
  assetNameFor,
  checksumsFileName,
  isNewerVersion,
  parseChecksums,
  releasePublicKey,
  sha256Hex,
  signatureFileName,
  signedVersion,
  verifyChecksumsSignature,
} from "./release-verification.ts";
import type { UpdateChannel } from "./updater.ts";

export interface UpdateInputs {
  readonly currentVersion: string;
  /** The running executable. */
  readonly executablePath: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** The GitHub API address; a test points it at a fake server. */
  readonly apiBaseUrl?: string;
  readonly repository?: string;
  readonly publicKey?: string;
  /** Runs the new executable once before the swap (lesson 91). */
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

export type UpdateResult =
  | { readonly status: "up_to_date"; readonly version: string }
  | { readonly status: "updated"; readonly from: string; readonly to: string };

interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

interface Release {
  readonly tag_name: string;
  readonly body?: string | null;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly assets: readonly ReleaseAsset[];
}

const releaseTag = /^v\d+\.\d+\.\d+$/;
const requestTimeoutMs = 30_000;
const probeTimeoutMs = 30_000;
/** A 100 MB download on a slow line. */
const downloadTimeoutMs = 10 * 60_000;

/** Installs the release of `version`, or the newest release when it is undefined. */
export async function updateExecutable(inputs: UpdateInputs, version?: string): Promise<UpdateResult> {
  const assetName = assetNameFor(inputs.platform, inputs.arch);
  if (assetName === null)
    throw new EvaError("update_failed", `No Eva build exists for ${inputs.platform} ${inputs.arch}.`);
  const releases = await publishedReleases(inputs);
  const release = version === undefined ? releases[0] : releases.find((each) => versionOf(each) === version);
  if (release === undefined) {
    if (version === undefined) return { status: "up_to_date", version: inputs.currentVersion };
    throw new EvaError("update_failed", `No release ${version} exists. Nothing changed.`);
  }
  if (!isNewerVersion(release.tag_name, inputs.currentVersion)) {
    if (version === undefined) return { status: "up_to_date", version: inputs.currentVersion };
    throw new EvaError("update_failed", `Eva never installs an older version than ${inputs.currentVersion}.`);
  }
  return install(inputs, release, assetName);
}

async function install(inputs: UpdateInputs, release: Release, assetName: string): Promise<UpdateResult> {
  const checksums = new TextDecoder().decode(await download(release, checksumsFileName));
  const signature = new TextDecoder().decode(await download(release, signatureFileName));
  if (!verifyChecksumsSignature(checksums, signature, inputs.publicKey ?? releasePublicKey))
    throw new EvaError(
      "update_failed",
      `The signature of release ${release.tag_name} does not match. Nothing changed.`,
    );
  const version = signedVersion(checksums);
  if (version !== release.tag_name.replace(/^v/, "") || !isNewerVersion(version, inputs.currentVersion))
    throw new EvaError(
      "update_failed",
      `Release ${release.tag_name} signs version ${version ?? "none"}, which is not a newer version. Nothing changed.`,
    );
  const expected = parseChecksums(checksums).get(assetName);
  const executable = await download(release, assetName);
  if (expected === undefined || sha256Hex(executable) !== expected)
    throw new EvaError("update_failed", `${assetName} does not match its signed checksum. Nothing changed.`);

  await replaceExecutable(inputs, executable, version);
  return { status: "updated", from: inputs.currentVersion, to: version };
}

/** The signed releases on GitHub, as an update channel for the single executable. */
export function executableUpdateChannel(inputs: UpdateInputs): UpdateChannel {
  return {
    kind: "executable",
    async check() {
      const releases = await publishedReleases(inputs);
      const newer = releases.filter((release) => isNewerVersion(release.tag_name, inputs.currentVersion));
      return {
        current: inputs.currentVersion,
        latest: releases[0] === undefined ? inputs.currentVersion : versionOf(releases[0]),
        available: newer.length > 0,
        releases: newer.map((release) => ({ version: versionOf(release), notes: release.body ?? "" })),
      };
    },
    async apply(version) {
      const result = await updateExecutable(inputs, version);
      return result.status === "updated"
        ? { current: result.from, latest: result.to, available: false, releases: [] }
        : { current: result.version, latest: result.version, available: false, releases: [] };
    },
  };
}

function versionOf(release: Release): string {
  return release.tag_name.replace(/^v/, "");
}

/** The published releases, newest first: never a draft or a pre-release. */
async function publishedReleases(inputs: UpdateInputs): Promise<Release[]> {
  // One page of 100 holds months of releases; an older one is too old to pick by hand.
  const url = `${inputs.apiBaseUrl ?? "https://api.github.com"}/repos/${inputs.repository ?? evaRepository}/releases?per_page=100`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new EvaError("update_failed", "GitHub could not be reached.");
  }
  if (!response.ok)
    throw new EvaError("update_failed", `GitHub answered ${String(response.status)} for the list of releases.`);
  const releases = (await response.json()) as Release[];
  return releases
    .filter((release) => release.draft !== true && release.prerelease !== true && releaseTag.test(release.tag_name))
    .sort((left, right) => (isNewerVersion(left.tag_name, right.tag_name) ? -1 : 1));
}

async function download(release: Release, name: string): Promise<Uint8Array> {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (asset === undefined) throw new EvaError("update_failed", `Release ${release.tag_name} has no ${name}.`);
  let response: Response;
  try {
    response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  } catch {
    throw new EvaError("update_failed", `${name} could not be downloaded.`);
  }
  if (!response.ok)
    throw new EvaError("update_failed", `${name} could not be downloaded (${String(response.status)}).`);
  return new Uint8Array(await response.arrayBuffer());
}

async function replaceExecutable(inputs: UpdateInputs, bytes: Uint8Array, version: string): Promise<void> {
  const executablePath = inputs.executablePath;
  const fresh = `${executablePath}.new`;
  writeFileSync(fresh, bytes);
  chmodSync(fresh, 0o755);
  // A file that does not start on this machine must never take the old one's place (lesson 91).
  const probe = await inputs.runner
    .run([fresh, "version"], {
      cwd: dirname(executablePath),
      environment: inputs.environment,
      timeoutMs: probeTimeoutMs,
    })
    .catch(() => null);
  if (probe?.exitCode !== 0 || probe.stdout.trim() !== version) {
    rmSync(fresh, { force: true });
    throw new EvaError("update_failed", `The new executable did not start and say ${version}. Nothing changed.`);
  }
  const old = asideName(executablePath);
  renameSync(executablePath, old);
  try {
    renameSync(fresh, executablePath);
  } catch (error) {
    renameSync(old, executablePath);
    throw new EvaError("update_failed", "The new executable could not take the old one's place. Nothing changed.", {
      cause: error,
    });
  }
}

/**
 * Where the old executable goes. Windows cannot remove a running file, and Eva's supervisor
 * still runs the file from before the last update. So `.old` can stay, and the old executable
 * then gets a unique name. Each update removes the leftovers that it can.
 */
function asideName(executablePath: string): string {
  const old = `${executablePath}.old`;
  const folder = dirname(executablePath);
  const leftover = `${basename(old)}-`;
  let names: string[] = [];
  try {
    names = readdirSync(folder);
  } catch {
    // Removing the leftovers is a courtesy: the update goes on without it.
  }
  // Only the names that this function gives: never a file of the person's own.
  for (const name of names.filter((each) => each.startsWith(leftover) && /^\d+$/.test(each.slice(leftover.length)))) {
    try {
      rmSync(join(folder, name), { force: true });
    } catch {
      // Still running: the next update tries again.
    }
  }
  try {
    rmSync(old, { force: true });
    return old;
  } catch {
    return `${old}-${String(Date.now())}`;
  }
}

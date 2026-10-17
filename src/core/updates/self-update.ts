/**
 * `eva update` (docs/plan.md §10, P8): replaces the single executable with the latest GitHub
 * release, after the signature and the checksum match (plan §12). A running executable cannot
 * be overwritten on Windows, but it can be renamed, so the old file moves aside first.
 */
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
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
  readonly assets: readonly ReleaseAsset[];
}

const requestTimeoutMs = 30_000;
const probeTimeoutMs = 30_000;
/** A 100 MB download on a slow line. */
const downloadTimeoutMs = 10 * 60_000;

export async function updateExecutable(inputs: UpdateInputs): Promise<UpdateResult> {
  const assetName = assetNameFor(inputs.platform, inputs.arch);
  if (assetName === null)
    throw new EvaError("update_failed", `No Eva build exists for ${inputs.platform} ${inputs.arch}.`);
  const release = await latestRelease(inputs);
  if (!isNewerVersion(release.tag_name, inputs.currentVersion))
    return { status: "up_to_date", version: inputs.currentVersion };

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
      const release = await latestRelease(inputs);
      return {
        current: inputs.currentVersion,
        latest: release.tag_name.replace(/^v/, ""),
        available: isNewerVersion(release.tag_name, inputs.currentVersion),
      };
    },
    async apply() {
      const result = await updateExecutable(inputs);
      return result.status === "updated"
        ? { current: result.from, latest: result.to, available: false }
        : { current: result.version, latest: result.version, available: false };
    },
  };
}

async function latestRelease(inputs: UpdateInputs): Promise<Release> {
  const url = `${inputs.apiBaseUrl ?? "https://api.github.com"}/repos/${inputs.repository ?? "guplem/eva"}/releases/latest`;
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
    throw new EvaError("update_failed", `GitHub answered ${String(response.status)} for the latest release.`);
  return (await response.json()) as Release;
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
  const old = `${executablePath}.old`;
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
  rmSync(old, { force: true });
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

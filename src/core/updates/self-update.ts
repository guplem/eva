/**
 * `eva update` (docs/plan.md §10, P8): replaces the single executable with the latest GitHub
 * release, after the signature and the checksum match (plan §12). A running executable cannot
 * be overwritten on Windows, but it can be renamed, so the old file moves aside first.
 */
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { EvaError } from "../../shared/errors.ts";
import {
  assetNameFor,
  checksumsFileName,
  isNewerVersion,
  parseChecksums,
  releasePublicKey,
  sha256Hex,
  signatureFileName,
  verifyChecksumsSignature,
} from "./release-verification.ts";

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
  const expected = parseChecksums(checksums).get(assetName);
  const executable = await download(release, assetName);
  if (expected === undefined || sha256Hex(executable) !== expected)
    throw new EvaError("update_failed", `${assetName} does not match its signed checksum. Nothing changed.`);

  replaceExecutable(inputs.executablePath, executable);
  return { status: "updated", from: inputs.currentVersion, to: release.tag_name.replace(/^v/, "") };
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

function replaceExecutable(executablePath: string, bytes: Uint8Array): void {
  const fresh = `${executablePath}.new`;
  const old = `${executablePath}.old`;
  writeFileSync(fresh, bytes);
  chmodSync(fresh, 0o755);
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

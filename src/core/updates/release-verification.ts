/**
 * Self-update checks a signature (docs/plan.md §12). The release workflow lists the SHA-256
 * of each executable in `SHA256SUMS` and signs that file with an Ed25519 key that only the
 * workflow holds (the `EVA_RELEASE_SIGNING_KEY` secret). Eva carries the public key, so a
 * download that someone changed, or a release that CI did not build, never replaces her.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

/** The public half of the release key, as base64 SPKI DER. Change it only with the secret. */
export const releasePublicKey = "MCowBQYDK2VwAyEA1ad1tCv98teDT5kyWOZboQt0pyoSzJqSgXmyzy/nQMU=";

export const checksumsFileName = "SHA256SUMS";
export const signatureFileName = "SHA256SUMS.sig";

/** True when `signatureBase64` is the key's Ed25519 signature of the exact checksums text. */
export function verifyChecksumsSignature(
  checksumsText: string,
  signatureBase64: string,
  publicKeyBase64: string = releasePublicKey,
): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(checksumsText, "utf8"), key, Buffer.from(signatureBase64.trim(), "base64"));
  } catch {
    return false;
  }
}

/** Reads `sha256sum` output: `<hash>  <file name>` on each line. */
export function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) checksums.set(match[2], match[1]);
  }
  return checksums;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The release asset for this machine, or null when no build exists for it. */
export function assetNameFor(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "win32" && arch === "x64") return "eva-windows-x64.exe";
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `eva-linux-${arch}`;
  return null;
}

/** True when `candidate` (such as `v0.2.0` or `0.2.0`) is a newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string): number[] =>
    version
      .replace(/^v/, "")
      .split("-")[0]
      ?.split(".")
      .map((part) => Number(part) || 0) ?? [];
  const next = parse(candidate);
  const now = parse(current);
  for (let index = 0; index < Math.max(next.length, now.length); index += 1) {
    const difference = (next[index] ?? 0) - (now[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

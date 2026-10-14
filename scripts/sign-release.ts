/**
 * Signs a release's `SHA256SUMS` with the Ed25519 key in the `EVA_RELEASE_SIGNING_KEY`
 * environment variable (a PKCS #8 PEM), and writes `SHA256SUMS.sig` beside it. It then checks
 * the signature with the public key that Eva carries, so a release signed with the wrong key
 * fails here, not on a person's machine.
 *
 * Usage: bun run scripts/sign-release.ts <release folder>
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checksumsFileName,
  signatureFileName,
  verifyChecksumsSignature,
} from "../src/core/updates/release-verification.ts";

const folder = process.argv[2];
const pem = process.env["EVA_RELEASE_SIGNING_KEY"];
if (folder === undefined || pem === undefined || pem.trim() === "") {
  process.stderr.write("Usage: EVA_RELEASE_SIGNING_KEY=<pem> bun run scripts/sign-release.ts <release folder>\n");
  process.exit(2);
}

const checksums = readFileSync(join(folder, checksumsFileName), "utf8");
const signature = sign(null, Buffer.from(checksums, "utf8"), createPrivateKey(pem)).toString("base64");
if (!verifyChecksumsSignature(checksums, signature)) {
  process.stderr.write("The signing key does not match the public key in release-verification.ts.\n");
  process.exit(1);
}
writeFileSync(join(folder, signatureFileName), `${signature}\n`);
process.stdout.write(`Signed ${join(folder, checksumsFileName)}.\n`);

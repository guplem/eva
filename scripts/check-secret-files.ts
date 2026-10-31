/**
 * Fails when this repository tracks a file that a default secret pattern of the vault matches, such
 * as a `.env.local` or a `.pem` file (#707). The vault encrypts such a file. A code repository has
 * no encryption, so such a file must stay out of it.
 */
import { defaultSecretPatterns, SecretMatcher } from "../src/core/vault/secret-files.ts";

const listed = Bun.spawnSync(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) {
  process.stderr.write(`git ls-files failed: ${listed.stderr.toString()}\n`);
  process.exit(1);
}
const matcher = new SecretMatcher(defaultSecretPatterns);
const found = listed.stdout
  .toString()
  .split("\0")
  .filter((path) => path.length > 0 && matcher.matches(path));

if (found.length > 0) {
  process.stderr.write(
    "These tracked files match a default secret pattern. Remove each one from git, and keep its secret out of the repository:\n" +
      found.map((path) => `  ${path}\n`).join(""),
  );
  process.exit(1);
}
process.stdout.write("No tracked file matches a secret pattern.\n");

/**
 * On 2026-10-31 Eva started to encrypt the secret files of the vault (#707). The vault's `.gitignore`
 * stops ignoring them, so Eva can commit them encrypted. It keeps ignoring the plain `.env` files of
 * an existing vault outside `Projects/`, since an old one can hold a password that no scan sees. The
 * vault map's secret rule says where a secret lives now. Both files are the person's own text, so
 * this migration replaces only the exact lines that Eva wrote. A block that the person changed
 * stays as it is: its secret files then stay on this computer, which is the safe side.
 *
 * The migration is frozen: it holds its own copy of the old and the new text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration, MigrationContext } from "./migration-runner.ts";

const oldIgnoreHead =
  "# Eva commits everything else, so anything secret, per-machine or generated must be listed here.";
const newIgnoreHead = [
  "# Eva commits everything else, so anything per-machine or generated must be listed here.",
  "# Eva encrypts each secret file, such as .env.local or a .pem file, before she commits it.",
].join("\n");

const oldIgnoreBlock = [
  "# Secrets and local settings. A project folder may hold its own secrets, so the secret",
  "# patterns apply only outside Projects/.",
  ".env",
  "*.env",
  "*.pem",
  "*.key",
  "!Projects/**/.env",
  "!Projects/**/*.env",
  "!Projects/**/*.pem",
  "!Projects/**/*.key",
].join("\n");
/**
 * A plain `.env` that this vault ignored before can hold a password with no token shape, which the
 * scan cannot see. So an existing vault keeps them on each computer. A new vault has no old ones.
 */
const newIgnoreBlock = [
  "# Plain .env files stay on each computer: an old one can hold a password. Eva encrypts the other",
  "# secret files, such as .env.local. Move a secret to .env.local to sync it.",
  ".env",
  "*.env",
  "!Projects/**/.env",
  "!Projects/**/*.env",
  "",
  "# Local settings of a tool on this machine.",
].join("\n");

const oldSecretRule =
  "- **Secrets** (keys, passwords) may live only in the folder of the project that uses them. Never copy one into a note outside that folder. One known place for each secret makes it possible to change it later.";
const newSecretRule =
  "- **Secrets** (keys, passwords) live only in secret files, such as `.env.local` or `server.pem`. Eva encrypts each one, so you see only her first line and encrypted text. Never copy a secret into a note. Tell the person which file holds it, and ask them to open it in Eva's Files page. One known place for each secret makes it possible to change it later.";

export const commitSecretFiles: Migration = {
  id: "2026-10-31-secret-files",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    replaceExact(context, join(vaultPath, ".gitignore"), [
      [oldIgnoreHead, newIgnoreHead],
      [oldIgnoreBlock, newIgnoreBlock],
    ]);
    replaceExact(context, join(vaultPath, "AGENTS.md"), [[oldSecretRule, newSecretRule]]);
    return "done";
  },
};

/** Replaces each old text that the file holds exactly, in the file's own line ends. */
function replaceExact(context: MigrationContext, path: string, pairs: readonly (readonly [string, string])[]): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf-8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const inStyle = (value: string): string => value.replaceAll("\n", newline);
  let next = text;
  for (const [before, after] of pairs) next = next.replace(inStyle(before), inStyle(after));
  if (next !== text) context.write(path, next);
}

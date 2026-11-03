/**
 * Writes the text of each version of the vault template's replaced files that Eva ever shipped, for
 * the `vault-upgrade` skill (#773). A person's computer has no git history of Eva, so the skill
 * finds the lines that the person wrote by comparing with these texts. Each version also goes
 * through the vault migrations, so a text that a migration wrote counts as Eva's.
 *
 * Run it after each change to one of these files: `bun run scripts/vault-template-history.ts`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { homePaths } from "../src/core/settings/home.ts";
import { migrations } from "../src/core/migrations/migrations.ts";
import { runMigrations } from "../src/core/migrations/migration-runner.ts";

/** The template files that the upgrade replaces, and whose lines a person may have changed. */
const replacedTemplateFiles = ["AGENTS.md", "README.md", ".eva/assistant.md", "Life/About me.md"];
const shippedTextsPath = "templates/eva-core/skills/vault-upgrade/shipped-texts.json";

const root = join(import.meta.dir, "..");

function git(...arguments_: string[]): string {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function textAt(commit: string, path: string): string | null {
  const result = Bun.spawnSync(["git", "show", `${commit}:templates/vault/${path}`], { cwd: root, stdout: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

const commits = git(
  "log",
  "--reverse",
  "--format=%H",
  "HEAD",
  "--",
  ...replacedTemplateFiles.map((path) => `templates/vault/${path}`),
)
  .split("\n")
  .filter((line) => line !== "");
const vaultMigrations = migrations
  .filter((migration) => migration.store === "vault")
  .sort((a, b) => a.id.localeCompare(b.id));
const texts = new Map<string, string[]>(replacedTemplateFiles.map((path) => [path, []]));
const keep = (vault: string): void => {
  for (const path of replacedTemplateFiles) {
    const file = join(vault, path);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf-8");
    const list = texts.get(path) ?? [];
    if (!list.includes(text)) list.push(text);
  }
};
const scratch = mkdtempSync(join(tmpdir(), "eva-template-history-"));
try {
  for (const [index, commit] of commits.entries()) {
    const vault = join(scratch, String(index), "vault");
    const paths = homePaths(join(scratch, String(index), "home"));
    for (const path of replacedTemplateFiles) {
      const text = textAt(commit, path);
      if (text === null) continue;
      mkdirSync(dirname(join(vault, path)), { recursive: true });
      writeFileSync(join(vault, path), text);
    }
    keep(vault);
    for (const migration of vaultMigrations) {
      runMigrations({
        store: "vault",
        migrations: [migration],
        paths,
        vaultPath: vault,
        version: "0.0.0",
        now: () => new Date(),
      });
      keep(vault);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(root, shippedTextsPath), `${JSON.stringify(Object.fromEntries(texts), null, 2)}\n`);
for (const [path, list] of texts) console.log(`${path}: ${String(list.length)} versions`);

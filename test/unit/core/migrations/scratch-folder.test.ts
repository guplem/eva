import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { migrations } from "../../../../src/core/migrations/migrations.ts";
import { ignoreEvaScratch } from "../../../../src/core/migrations/scratch-folder.ts";
import { commitSecretFiles } from "../../../../src/core/migrations/secret-files.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;

/** The vault's .gitignore that `2026-10-31-secret-files` leaves: the input of this migration. */
const secretFilesIgnore = [
  "# Eva commits everything else, so anything per-machine or generated must be listed here.",
  "# Eva encrypts each secret file, such as .env.local or a .pem file, before she commits it.",
  "",
  "# Cloned project repositories: each one is its own git repository.",
  "Projects/*/repos/",
  "",
  "# Files made only to send to a chat, and files received from it. Eva removes them after a week.",
  "Scratch/",
  "",
  "# Plain .env files stay on each computer: an old one can hold a password. Eva encrypts the other",
  "# secret files, such as .env.local. Move a secret to .env.local to sync it.",
  ".env",
  "*.env",
  "!Projects/**/.env",
  "!Projects/**/*.env",
  "",
  "# Local settings of a tool on this machine.",
  "settings.local.json",
  "",
].join("\n");

/** What the template's .gitignore ignored on 2026-11-02, frozen with the migration. */
const templateIgnoreLines = ["Projects/*/repos/", ".eva/scratch/", "settings.local.json", "desktop.ini", ".DS_Store"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-scratch-folder-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [ignoreEvaScratch],
    paths,
    vaultPath: vault,
    version: "1.60.0",
    now: () => new Date("2026-11-02T08:00:00.000Z"),
  });
}

const ignore = (): string => readFileSync(join(vault, ".gitignore"), "utf-8");

describe("ignoreEvaScratch (vault, #767)", () => {
  test("is in the list of migrations, and is recorded in the vault", () => {
    expect(migrations).toContain(ignoreEvaScratch);
    writeFileSync(join(vault, ".gitignore"), secretFilesIgnore);
    expect(migrate()).toMatchObject({ kind: "done", applied: [ignoreEvaScratch.id] });
    expect(readFileSync(join(vault, ".eva", "migrations.json"), "utf-8")).toContain(ignoreEvaScratch.id);
  });

  test("adds .eva/scratch/ under the old Scratch/ line, and keeps that line for good", () => {
    writeFileSync(join(vault, ".gitignore"), secretFilesIgnore);
    migrate();
    expect(ignore()).toBe(secretFilesIgnore.replace("Scratch/\n", "Scratch/\n.eva/scratch/\n"));
  });

  test("a migrated .gitignore ignores what the template ignores, plus the old Scratch/ and the plain .env files", () => {
    writeFileSync(
      join(vault, ".gitignore"),
      `${secretFilesIgnore}\n# Operating system leftovers.\ndesktop.ini\n.DS_Store\n`,
    );
    migrate();
    const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
    const kept = ["Scratch/", ".env", "*.env", "!Projects/**/.env", "!Projects/**/*.env"];
    expect(lines(ignore()).filter((line) => !kept.includes(line))).toEqual(templateIgnoreLines);
  });

  test("the whole chain from a .gitignore before 2026-10-31 ends with .eva/scratch/ listed", () => {
    const old = [
      "# Eva commits everything else, so anything secret, per-machine or generated must be listed here.",
      "",
      "# Cloned project repositories: each one is its own git repository.",
      "Projects/*/repos/",
      "",
      "# Files made only to send to a chat, and files received from it. Eva removes them after a week.",
      "Scratch/",
      "",
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
      "settings.local.json",
      "",
    ].join("\n");
    writeFileSync(join(vault, ".gitignore"), old);
    runMigrations({
      store: "vault",
      migrations: [commitSecretFiles, ignoreEvaScratch],
      paths,
      vaultPath: vault,
      version: "1.60.0",
      now: () => new Date("2026-11-02T08:00:00.000Z"),
    });
    expect(ignore()).toBe(secretFilesIgnore.replace("Scratch/\n", "Scratch/\n.eva/scratch/\n"));
  });

  test("a .gitignore that the person changed gets the line at its end, in its own line ends", () => {
    writeFileSync(join(vault, ".gitignore"), "my-notes.tmp\r\n*.log");
    migrate();
    expect(ignore()).toBe(
      "my-notes.tmp\r\n*.log\r\n\r\n# Files made only to send to a chat, and files received from it. Eva removes them after a week.\r\n.eva/scratch/\r\n",
    );
  });

  test("a .gitignore that lists the folder already stays as it is", () => {
    writeFileSync(join(vault, ".gitignore"), "/.eva/scratch\n");
    migrate();
    expect(ignore()).toBe("/.eva/scratch\n");
  });

  test("a vault with no .gitignore gets none", () => {
    expect(migrate()).toMatchObject({ kind: "done", applied: [ignoreEvaScratch.id] });
    expect(existsSync(join(vault, ".gitignore"))).toBe(false);
  });

  test("leaves the old Scratch/ folder and its files where they are", () => {
    mkdirSync(join(vault, "Scratch"));
    writeFileSync(join(vault, "Scratch", "answer.pdf"), "pdf");
    writeFileSync(join(vault, ".gitignore"), secretFilesIgnore);
    migrate();
    expect(readFileSync(join(vault, "Scratch", "answer.pdf"), "utf-8")).toBe("pdf");
  });
});

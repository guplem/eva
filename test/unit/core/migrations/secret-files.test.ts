import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { commitSecretFiles } from "../../../../src/core/migrations/secret-files.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;

/** The secret part of the vault's .gitignore before 2026-10-31. */
const oldIgnore = [
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

const oldSecretRule =
  "- **Secrets** (keys, passwords) may live only in the folder of the project that uses them. Never copy one into a note outside that folder. One known place for each secret makes it possible to change it later.";

const template = (path: string): string =>
  readFileSync(join(import.meta.dir, "../../../../templates/vault", path), "utf-8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-secret-files-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [commitSecretFiles],
    paths,
    vaultPath,
    version: "1.51.0",
    now: () => new Date("2026-10-31T08:00:00.000Z"),
  });
}

describe("commitSecretFiles (vault, #707)", () => {
  test("the .gitignore stops ignoring secret files and keeps the person's own lines", () => {
    writeFileSync(join(vault, ".gitignore"), `${oldIgnore}my-notes.tmp\n*.key\n`);
    expect(migrate().kind).toBe("done");
    const text = readFileSync(join(vault, ".gitignore"), "utf-8");
    for (const line of [".env", "*.env", "*.pem", "!Projects/**/.env", "!Projects/**/*.key"])
      expect(text.split("\n")).not.toContain(line);
    expect(text).toContain("Projects/*/repos/");
    expect(text).toContain("settings.local.json");
    expect(text).toContain("Eva encrypts each secret file");
    // A line that the person added after the template's block stays, even one that repeats a template line.
    expect(text).toEndWith("my-notes.tmp\n*.key\n");
  });

  test("the map's secret rule becomes the template's rule", () => {
    writeFileSync(join(vault, "AGENTS.md"), `# Map\n\n${oldSecretRule}\n- Another rule.\n`);
    migrate();
    const text = readFileSync(join(vault, "AGENTS.md"), "utf-8");
    const newRule = template("AGENTS.md")
      .split("\n")
      .find((line) => line.startsWith("- **Secrets**"));
    expect(newRule).toBeDefined();
    expect(text).toBe(`# Map\n\n${newRule ?? ""}\n- Another rule.\n`);
  });

  test("keeps Windows line ends, and a text that the person changed stays as it is", () => {
    writeFileSync(join(vault, ".gitignore"), oldIgnore.replaceAll("\n", "\r\n"));
    const edited = oldSecretRule.replace("may live only", "live");
    writeFileSync(join(vault, "AGENTS.md"), `${edited}\n`);
    migrate();
    const ignore = readFileSync(join(vault, ".gitignore"), "utf-8");
    expect(ignore.replaceAll("\r\n", "")).not.toContain("\n");
    expect(ignore).not.toContain("*.pem");
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe(`${edited}\n`);
  });

  test("a migrated .gitignore ignores what the template ignores", () => {
    writeFileSync(join(vault, ".gitignore"), `${oldIgnore}\n# Operating system leftovers.\ndesktop.ini\n.DS_Store\n`);
    migrate();
    const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
    expect(lines(readFileSync(join(vault, ".gitignore"), "utf-8"))).toEqual(lines(template(".gitignore")));
  });

  test("a vault with no .gitignore and no map has nothing to change", () => {
    expect(migrate()).toMatchObject({ kind: "done", applied: [commitSecretFiles.id] });
  });
});

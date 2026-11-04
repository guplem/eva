import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createVaultFromTemplate,
  defaultAssistantRules,
  vaultTemplateFiles,
} from "../../../../src/core/vault/vault-template.ts";
import { migrations } from "../../../../src/core/migrations/migrations.ts";
import { runMigrations } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths } from "../../../../src/core/settings/home.ts";
import { createVaultKey, type VaultKeyFile } from "../../../../src/core/vault/vault-crypto.ts";
import { defaultSecretPatterns } from "../../../../src/core/vault/secret-files.ts";
import { newestStructureVersion } from "../../../../src/core/vault/vault-structure.ts";
import { vaultFolders } from "../../../../src/core/vault/vault-folders.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";

/** A cheap key: the cost of a real one would only slow the tests. */
const testKey = (): Promise<VaultKeyFile> => createVaultKey("a long vault password", { logN: 10 });

let folder: string;
let environment: Record<string, string>;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-template-"));
  const emptyConfig = join(folder, "empty.gitconfig");
  writeFileSync(emptyConfig, "");
  // No git identity at all: the template must still make its first commit.
  environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => !entry[0].startsWith("GIT_") && entry[1] !== undefined,
      ),
    ),
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const answers = {
  name: "Alex",
  notesLanguage: "Spanish",
  topics: ["Work", "Music"],
};

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync(["git", ...args], { cwd, env: environment })
    .stdout.toString()
    .trim();
}

describe("the vault template", () => {
  test("holds the agent map, Eva's files and no personal data", () => {
    const files = vaultTemplateFiles(answers);
    expect(Object.keys(files).sort()).toEqual([
      ".eva/.claude-plugin/plugin.json",
      ".eva/AGENTS.md",
      ".eva/assistant.md",
      ".eva/migrations.json",
      ".eva/schedules.json",
      ".eva/settings/saved-prompts/Summary.md",
      ".eva/settings/text-actions/Polish.md",
      ".eva/vault-structure.json",
      ".gitignore",
      "AGENTS.md",
      "Library/.gitkeep",
      "Life/About me.md",
      "Life/Cases/AGENTS.md",
      "Life/Diary/AGENTS.md",
      "Life/Finances/AGENTS.md",
      "Life/Health/AGENTS.md",
      "Life/Health/Allergies and Diet.md",
      "Life/Objects/AGENTS.md",
      "Life/People/AGENTS.md",
      "Life/Periods/AGENTS.md",
      "Life/Pets/AGENTS.md",
      "Methods/.gitkeep",
      "Principles/.gitkeep",
      "Projects/.gitkeep",
      "README.md",
      "Toolbox/.gitkeep",
    ]);
    // The answer language and the time zone are settings now (#770): no line in the note.
    expect(files["Life/About me.md"]).toContain("# About Alex");
    expect(files["Life/About me.md"]).not.toContain("Language for answers");
    expect(files["Life/About me.md"]).not.toContain("Time zone");
    expect(files["Life/About me.md"]).toContain("\npinned: full ");
    expect(files["Life/Health/Allergies and Diet.md"]).toContain("pinned: full");
    expect(files["Life/Health/Allergies and Diet.md"]).toContain("None recorded.");
    // The header holds the name as one YAML value, and every other fact empty.
    expect(files["Life/About me.md"]).toStartWith("---\n");
    expect(files["Life/About me.md"]).toContain('\nname: "Alex"\n');
    expect(files["Life/About me.md"]).toContain("## Main topics\n\n- Work\n- Music\n");
    // The rules hold no setup answer, so the settings page can restore them as they are.
    expect(files[".eva/assistant.md"]).toBe(defaultAssistantRules);
    expect(vaultTemplateFiles({ ...answers, topics: [] })["Life/About me.md"]).toContain(
      "## Main topics\n\nNone yet.\n",
    );
    expect(Object.values(files).join("\n")).not.toContain("{{");
    expect(JSON.parse(files[".eva/schedules.json"] ?? "")).toEqual({ version: 1, schedules: [] });
    expect(files[".gitignore"]).toContain("Projects/*/repos/");
    expect(Object.keys(files).some((path) => path.endsWith("CLAUDE.md"))).toBe(false);
  });

  test("a new vault's rules hold only Style and Behaviour, and keep them after the hub's first start (#771)", async () => {
    const vault = join(folder, "vault");
    await createVaultFromTemplate({
      folder: vault,
      answers,
      key: await testKey(),
      runner: systemProcessRunner,
      environment,
    });
    const sections = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("## "));
    expect(sections(defaultAssistantRules)).toEqual(["## Style", "## Behaviour"]);
    // A new vault has no skill of its own: Eva's skills ship with Eva.
    expect(existsSync(join(vault, ".eva", "skills"))).toBe(false);
    // The frozen migration of 2026-10-20 would bring back the sections that the base prompt holds now.
    const paths = homePaths(join(folder, "home"));
    mkdirSync(paths.root, { recursive: true });
    const run = runMigrations({
      store: "vault",
      migrations,
      paths,
      vaultPath: vault,
      version: "1.0.0",
      now: () => new Date("2026-11-03T08:00:00.000Z"),
    });
    expect(run.kind).toBe("done");
    expect(readFileSync(join(vault, ".eva", "assistant.md"), "utf-8")).toBe(defaultAssistantRules);
    expect(git(vault, "status", "--porcelain", "--", ".eva/assistant.md")).toBe("");
  });

  test("a new vault keeps the files of the chats in .eva/scratch/, and never names Scratch/ (#767)", () => {
    const files = vaultTemplateFiles(answers);
    expect((files[".gitignore"] ?? "").split("\n")).toContain(".eva/scratch/");
    for (const text of Object.values(files)) expect(text).not.toContain("Scratch/");
  });

  test("the .gitignore ignores no secret file and no plain .env, since Eva commits them encrypted or checked (#707)", () => {
    const repository = join(folder, "ignore-check");
    mkdirSync(repository);
    git(repository, "init", "-q");
    writeFileSync(join(repository, ".gitignore"), vaultTemplateFiles(answers)[".gitignore"] ?? "");
    // A sample name for each default, in a note folder and in a project folder.
    const samples = defaultSecretPatterns.map((pattern) => pattern.replaceAll("*", "example"));
    const paths = [...samples, ".env", "app.env"].flatMap((name) => [
      `Life/${name}`,
      `Projects/2026-01-01-0900-example-app/${name}`,
    ]);
    expect(git(repository, "check-ignore", "--no-index", ...paths)).toBe("");
    expect(
      git(repository, "check-ignore", "--no-index", "Projects/2026-01-01-0900-example-app/repos/clone-0/.env"),
    ).not.toBe("");
  });

  test("the agent map lists each folder, the outside services and the person's own section (#772)", () => {
    const map = vaultTemplateFiles(answers)["AGENTS.md"] ?? "";
    for (const folder of ["Principles/", "Methods/", "Toolbox/", "Library/", "Projects/", ".eva/"]) {
      expect(map).toContain(`\`${folder}`);
    }
    for (const folder of ["Cases", "Objects", "People", "Pets", "Periods", "Health", "Finances", "Diary"]) {
      expect(map).toContain(`\`Life/${folder}/`);
    }
    for (const heading of ["## What is where", "## Outside the vault", "## Where things go", "## Entities"]) {
      expect(map).toContain(`\n${heading}\n`);
    }
    // The person's apps start unset, and the agent asks the first time a role matters.
    expect(map).toContain("## Personal rules\n");
    expect(map).toContain("| The calendar | not set |");
    // How pinning works is Eva's logic, in her docs, not in the vault.
    expect(map).toContain("Keep any key you do not know, such as `summary` or `pinned`.");
    expect(map).not.toContain("pinned:");
  });

  test("the agent map says apart whether the person works on a project and whether they use it (#859)", () => {
    const map = vaultTemplateFiles(answers)["AGENTS.md"] ?? "";
    expect(map).toContain("status: active # active, paused or closed\nin-use: true # optional");
    expect(map).toContain("`in-use: true` says that the person uses the project now, whatever its status");
    expect(map).not.toContain("Never add a second status field.");
    expect(map).not.toContain("status `idea`");
  });

  test("the agent map tells the agent to list Principles/ and Methods/ before it acts, never to grep them (#851)", () => {
    const map = vaultTemplateFiles(answers)["AGENTS.md"] ?? "";
    expect(map).toContain("Before you act on a request, list `Principles/` and `Methods/`.");
    expect(map).toContain("Never grep these two folders to decide:");
    expect(map).toContain("Follow each method that fits");
  });

  test("each folder of Life/ has its own rules, and Eva's folder has its guide (#772)", () => {
    const files = vaultTemplateFiles(answers);
    expect(files["Life/Cases/AGENTS.md"]).toContain("Case.md");
    expect(files["Life/Objects/AGENTS.md"]).toContain("Object.md");
    expect(files["Life/People/AGENTS.md"]).toContain("Person.md");
    expect(files["Life/Pets/AGENTS.md"]).toContain("Pet.md");
    expect(files["Life/Periods/AGENTS.md"]).toContain("Period.md");
    // About me's `work` and the periods rules name the same key, the one that the reader checks.
    expect(files["Life/About me.md"]).toContain("\nwork: # period: a link to the open job in Life/Periods/.");
    expect(files["Life/Periods/AGENTS.md"]).toContain("in its `period` key");
    expect(files[".eva/AGENTS.md"]).toStartWith("# .eva\n");
    expect(files[".eva/AGENTS.md"]).toContain("`schedules.json`");
    expect(files["README.md"]).not.toContain("Life/");
    // The repository is public: the template keeps neutral examples only.
    expect(files["Life/Finances/AGENTS.md"]).toContain("Example Bank");
    expect(Object.values(files).join("\n")).not.toMatch(/ES-CT|Barcelona/);
    // Review fixes where two texts disagreed (#772).
    expect(files["AGENTS.md"]).toContain("which win over them");
    expect(files["AGENTS.md"]).toContain("every other `AGENTS.md` in the vault");
    expect(files["AGENTS.md"]).not.toContain("offer status `gone`");
    expect(files["Life/Objects/AGENTS.md"]).toContain("A finished repair → a dated line here.");
    expect(files["Life/Finances/AGENTS.md"]).toContain("An online-banking login goes in the password manager.");
    expect(files[".eva/AGENTS.md"]).toContain("`settings/chat-names.md`");
    expect(files[".eva/AGENTS.md"]).toContain("`eva settings set`");
    expect(files["Life/Finances/AGENTS.md"]).toContain("**Closing:** When a contract or account ends");
    expect(files["AGENTS.md"]).toContain("any service, except the person's password manager.");
  });

  test("every vault migration leaves each file of a new vault as the template wrote it (#772)", () => {
    const files = vaultTemplateFiles(answers);
    const vault = join(folder, "migrated");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(vault, path)), { recursive: true });
      writeFileSync(join(vault, path), text);
    }
    const run = runMigrations({
      store: "vault",
      migrations,
      paths: homePaths(join(folder, "home")),
      vaultPath: vault,
      version: "1.0.0",
      now: () => new Date("2026-11-03T08:00:00.000Z"),
    });
    expect(run.kind).toBe("done");
    for (const [path, text] of Object.entries(files)) {
      // The runner writes its own record.
      if (path === ".eva/migrations.json") continue;
      expect([path, readFileSync(join(vault, path), "utf-8")]).toEqual([path, text]);
    }
  });

  test("a new vault records the newest structure version (#772)", () => {
    expect(JSON.parse(vaultTemplateFiles(answers)[".eva/vault-structure.json"] ?? "")).toEqual({
      version: newestStructureVersion,
    });
  });

  test("the agent map names the language that the person chose for notes", () => {
    const map = vaultTemplateFiles(answers)["AGENTS.md"] ?? "";
    expect(map).toContain("**Write all notes in Spanish,**");
    expect(map).not.toContain("{{");
  });

  test("each folder that setup describes is in the agent map and in the new vault", () => {
    const files = vaultTemplateFiles(answers);
    const map = files["AGENTS.md"] ?? "";
    for (const { path, purpose } of vaultFolders) {
      expect(map).toContain(`\`${path}/`);
      expect(purpose).not.toBe("");
      expect(Object.keys(files).some((file) => file.startsWith(`${path}/`))).toBe(true);
    }
  });

  test("a new vault is a git repository with one commit, even with no git identity", async () => {
    const vault = join(folder, "vault");
    await createVaultFromTemplate({
      folder: vault,
      answers,
      key: await testKey(),
      runner: systemProcessRunner,
      environment,
    });
    expect(readFileSync(join(vault, "Life", "About me.md"), "utf8")).toContain("Alex");
    expect(git(vault, "log", "--format=%an %s")).toBe("Eva Start the vault from Eva's template");
    expect(git(vault, "status", "--porcelain")).toBe("");
    expect(git(vault, "branch", "--show-current")).toBe("main");
  });

  test("a folder that already holds files is refused", async () => {
    mkdirSync(join(folder, "used"));
    writeFileSync(join(folder, "used", "note.md"), "mine");
    let caught: unknown;
    try {
      await createVaultFromTemplate({
        folder: join(folder, "used"),
        answers,
        key: await testKey(),
        runner: systemProcessRunner,
        environment,
      });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "vault_not_found")).toBe(true);
  });

  test("a failed git step is an error that names the step", async () => {
    const failing: ProcessRunner = { run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "no git here" }) };
    const failure = await createVaultFromTemplate({
      folder: join(folder, "other"),
      answers,
      key: await testKey(),
      runner: failing,
      environment,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("git init -q -b main failed: no git here");
  });
});

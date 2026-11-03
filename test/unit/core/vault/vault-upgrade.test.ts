import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { VaultSync } from "../../../../src/core/vault/vault-sync.ts";
import { VaultUpgrade } from "../../../../src/core/vault/vault-upgrade.ts";
import { readVaultStructure, structureChanges } from "../../../../src/core/vault/vault-structure.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let other: string;
let hub: boolean;
let syncOn: boolean;
let afterBranch: number;

const neededMigrations = structureChanges.flatMap((change) => change.migrations);

function upgrade(): { upgrade: VaultUpgrade; sync: VaultSync } {
  const sync = new VaultSync({
    vaultPath: vault,
    runner: systemProcessRunner,
    environment: gitEnvironment,
    now: () => new Date(2026, 10, 3, 12, 0),
  });
  return {
    sync,
    upgrade: new VaultUpgrade({
      vaultPath: vault,
      sync,
      isHub: () => hub,
      syncEnabled: () => syncOn,
      skillFolder: () => join(sandbox.root, "engines", "eva-core", "skills", "vault-upgrade"),
      afterBranch: () => {
        afterBranch += 1;
      },
    }),
  };
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (isEvaError(error, "vault_upgrade_refused")) return error.message;
    throw error;
  }
  throw new Error("The command did not refuse.");
}

const branch = (): string => sandbox.git(vault, "rev-parse", "--abbrev-ref", "HEAD");
const remoteFile = (path: string): string => sandbox.git(sandbox.remote, "show", `main:${path}`);

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  other = sandbox.clone("other");
  hub = true;
  syncOn = true;
  afterBranch = 0;
  sandbox.write(
    vault,
    ".eva/migrations.json",
    JSON.stringify({ applied: neededMigrations.map((id) => ({ id, at: "", version: "" })) }),
  );
  sandbox.write(vault, ".gitignore", ".env\n.eva/scratch/\n");
  sandbox.write(vault, "Life/Car/Car.md", "# Car\n");
  sandbox.write(vault, "Life/Car/.env", "PLATE_API=demo\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "an old vault");
  sandbox.git(vault, "push", "-q", "origin", "main");
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

/** The skill's own work: one moved note, in one commit that names only its paths. */
function moveTheCar(): void {
  sandbox.git(vault, "mv", "Life/Car/Car.md", "Life/Car-old.md");
  sandbox.git(vault, "commit", "-q", "-m", "Move the car", "--", "Life/Car/Car.md", "Life/Car-old.md");
}

describe("start", () => {
  test("tags the remote, opens the branch, pauses the sync and writes the inventory", async () => {
    sandbox.write(vault, "Methods/Unsaved.md", "Not saved yet.\n");
    sandbox.write(vault, ".eva/scratch/temp.txt", "temporary\n");
    const { upgrade: command, sync } = upgrade();
    const text = await command.run("start");
    expect(branch()).toBe("upgrade-v3");
    expect(sandbox.git(sandbox.remote, "tag", "--list")).toBe("before-v3");
    // The work starts from a saved vault.
    expect(remoteFile("Methods/Unsaved.md")).toBe("Not saved yet.");
    expect(sync.currentState.status).toBe("paused");
    // Inside the vault's ignored scratch folder, so the chat reads it with no permission question.
    const inventoryPath = join(vault, ".eva", "scratch", "vault-upgrade", "v3-inventory.tsv");
    expect(text).toContain(inventoryPath);
    const inventory = readFileSync(inventoryPath, "utf-8");
    const carHash = sandbox.git(vault, "rev-parse", "HEAD:Life/Car/Car.md");
    expect(inventory).toContain(`tracked\t${carHash}\tLife/Car/Car.md`);
    // A git-ignored file is listed with the hash git would give it, so it is never forgotten.
    const envHash = sandbox.git(vault, "hash-object", "Life/Car/.env");
    expect(inventory).toContain(`ignored\t${envHash}\tLife/Car/.env`);
    expect(inventory).not.toContain(".eva/scratch");
  });

  test("refuses on a satellite, and changes nothing", async () => {
    hub = false;
    expect(await refusal(upgrade().upgrade.run("start"))).toContain("Only the hub computer");
    expect(branch()).toBe("main");
  });

  test("refuses with the sync off: the backup must reach the remote", async () => {
    syncOn = false;
    expect(await refusal(upgrade().upgrade.run("start"))).toContain("Turn on the vault sync first");
    expect(branch()).toBe("main");
  });

  test("refuses while a migration that the upgrade needs has not run", async () => {
    sandbox.write(vault, ".eva/migrations.json", JSON.stringify({ applied: [] }));
    expect(await refusal(upgrade().upgrade.run("start"))).toContain(neededMigrations[0] ?? "");
    expect(sandbox.git(vault, "tag", "--list")).toBe("");
  });

  test("refuses while an upgrade is open, and when the vault is up to date", async () => {
    await upgrade().upgrade.run("start");
    expect(await refusal(upgrade().upgrade.run("start"))).toContain("An upgrade is open on the branch upgrade-v3");
    await upgrade().upgrade.run("finish");
    expect(await refusal(upgrade().upgrade.run("start"))).toContain("the newest structure");
  });
});

describe("finish", () => {
  test("merges the work and the notes written meanwhile, records the version and pushes", async () => {
    await upgrade().upgrade.run("start");
    moveTheCar();
    // Another chat writes a note while the upgrade runs.
    sandbox.write(vault, "Life/Diary/2026-11-03.md", "A day.\n");
    const text = await upgrade().upgrade.run("finish");
    expect(text).toContain("version 3");
    expect(text).toContain("committed apart: Life/Diary/2026-11-03.md");
    expect(branch()).toBe("main");
    expect(sandbox.git(vault, "branch", "--list", "upgrade-v3")).toBe("");
    expect(readVaultStructure(vault)).toBe(3);
    expect(remoteFile("Life/Car-old.md")).toBe("# Car");
    expect(remoteFile("Life/Diary/2026-11-03.md")).toBe("A day.");
    expect(JSON.parse(remoteFile(".eva/vault-structure.json"))).toEqual({ version: 3 });
    // git mv keeps the history of a moved note.
    expect(sandbox.git(vault, "log", "--follow", "--format=%s", "HEAD^2", "--", "Life/Car-old.md")).toContain(
      "an old vault",
    );
    expect(sandbox.git(vault, "tag", "--list")).toBe("before-v3");
    expect(afterBranch).toBe(1);
  });

  test("a vault that has the structure already only gets the record", async () => {
    await upgrade().upgrade.run("start");
    await upgrade().upgrade.run("finish");
    expect(sandbox.git(vault, "log", "-1", "--format=%s")).toBe("Upgrade the vault structure to v3");
    expect(readVaultStructure(vault)).toBe(3);
  });

  test("a conflict with the remote keeps both versions and names the copy", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/Car/Car.md", "# Car\n\nThe upgrade's text.\n");
    sandbox.git(vault, "commit", "-q", "-am", "Rewrite the car");
    sandbox.git(other, "pull", "-q");
    sandbox.write(other, "Life/Car/Car.md", "# Car\n\nA satellite's text.\n");
    sandbox.git(other, "commit", "-q", "-am", "A satellite edit");
    sandbox.git(other, "push", "-q", "origin", "main");
    const text = await upgrade().upgrade.run("finish");
    expect(text).toContain("Life/Car/Car (conflict copy).md");
    expect(branch()).toBe("main");
    expect(remoteFile("Life/Car/Car.md")).toContain("The upgrade's text.");
    expect(remoteFile("Life/Car/Car (conflict copy).md")).toContain("A satellite's text.");
  });

  test("refuses a branch that holds a secret in plain text, and changes nothing", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Toolbox/Keys.md", `key: sk-ant-${"a".repeat(30)}\n`);
    sandbox.git(vault, "add", "Toolbox/Keys.md");
    sandbox.git(vault, "commit", "-q", "-m", "A note with a key", "--", "Toolbox/Keys.md");
    expect(await refusal(upgrade().upgrade.run("finish"))).toContain("Toolbox/Keys.md");
    expect(branch()).toBe("upgrade-v3");
    expect(readVaultStructure(vault)).toBe(2);
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).not.toContain("Keys.md");
  });

  test("refuses on a satellite and with no upgrade open", async () => {
    expect(await refusal(upgrade().upgrade.run("finish"))).toContain("No vault upgrade is open");
    hub = false;
    expect(await refusal(upgrade().upgrade.run("finish"))).toContain("Only the hub computer");
  });
});

describe("drop", () => {
  test("goes back to the default branch, with the notes written meanwhile at their old place", async () => {
    await upgrade().upgrade.run("start");
    moveTheCar();
    // A chat edits the car note at its new path, and writes a new note.
    sandbox.write(vault, "Life/Car-old.md", "# Car\n\nNew tyres.\n");
    sandbox.write(vault, "Life/Diary/2026-11-03.md", "A day.\n");
    // The skill moved a git-ignored file by hand, and wrote the move down.
    renameSync(join(vault, "Life/Car/.env"), join(vault, "Life/Objects-car.env"));
    sandbox.write(vault, ".eva/scratch/vault-upgrade/v3-ignored-moves.tsv", "Life/Car/.env\tLife/Objects-car.env\n");
    const { upgrade: command, sync } = upgrade();
    expect(await command.run("drop")).toContain("dropped");
    expect(readFileSync(join(vault, "Life/Car/.env"), "utf-8")).toBe("PLATE_API=demo\n");
    expect(branch()).toBe("main");
    expect(sandbox.git(vault, "branch", "--list", "upgrade-v3")).toBe("");
    expect(existsSync(join(vault, "Life/Car-old.md"))).toBe(false);
    expect(remoteFile("Life/Car/Car.md")).toBe("# Car\n\nNew tyres.");
    expect(remoteFile("Life/Diary/2026-11-03.md")).toBe("A day.");
    expect(sync.currentState.status).toBe("ok");
    expect(readVaultStructure(vault)).toBe(2);
    expect(afterBranch).toBe(1);
  });
});

describe("drop with a conflict", () => {
  test("keeps both versions of a note that the upgrade and a chat both changed, and can run again", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/Car/Car.md", "# Car\n\nThe upgrade's text.\n");
    sandbox.git(vault, "commit", "-q", "-am", "Rewrite the car");
    sandbox.write(vault, "Life/Car/Car.md", "# Car\n\nThe upgrade's text, and a chat's line.\n");
    const text = await upgrade().upgrade.run("drop");
    expect(text).toContain("Life/Car/Car (conflict copy).md");
    expect(branch()).toBe("main");
    expect(remoteFile("Life/Car/Car.md")).toContain("a chat's line");
    expect(remoteFile("Life/Car/Car (conflict copy).md")).toBe("# Car");
    expect(await refusal(upgrade().upgrade.run("drop"))).toContain("No vault upgrade is open");
  });
});

describe("undo", () => {
  test("takes a move back when the note was edited after the merge, with the edit", async () => {
    await upgrade().upgrade.run("start");
    moveTheCar();
    await upgrade().upgrade.run("finish");
    sandbox.write(vault, "Life/Car-old.md", "# Car\n\nNew tyres.\n");
    await upgrade().sync.save();
    await upgrade().upgrade.run("undo");
    expect(remoteFile("Life/Car/Car.md")).toBe("# Car\n\nNew tyres.");
    expect(existsSync(join(vault, "Life/Car-old.md"))).toBe(false);
  });

  test("keeps the newest location of About me when the upgrade rewrote the note", async () => {
    const location = (at: string): string =>
      `lastLocation: { latitude: 41.4, longitude: 2.2, accuracy: null, at: "${at}", source: web }`;
    sandbox.write(
      vault,
      "Life/About me.md",
      `---\nname: Sam\ndiet: vegetarian\n${location("2026-10-20T10:00:00.000Z")}\n---\n`,
    );
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "About me");
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/About me.md", `---\nname: Sam\n${location("2026-10-20T10:00:00.000Z")}\n---\n`);
    sandbox.git(vault, "commit", "-q", "-am", "Slim About me");
    await upgrade().upgrade.run("finish");
    sandbox.write(vault, "Life/About me.md", `---\nname: Sam\n${location("2026-10-25T10:00:00.000Z")}\n---\n`);
    await upgrade().sync.save();
    expect(await upgrade().upgrade.run("undo")).not.toContain("conflict copy");
    const aboutMe = remoteFile("Life/About me.md");
    expect(aboutMe).toContain("diet: vegetarian");
    expect(aboutMe).toContain("2026-10-25T10:00:00.000Z");
  });

  test("refuses off the default branch", async () => {
    await upgrade().upgrade.run("start");
    await upgrade().upgrade.run("finish");
    sandbox.git(vault, "switch", "-q", "-c", "ideas");
    expect(await refusal(upgrade().upgrade.run("undo"))).toContain("Switch the vault to main first");
  });

  test("takes the upgrade back and keeps the notes written during and since it", async () => {
    await upgrade().upgrade.run("start");
    moveTheCar();
    sandbox.write(vault, ".eva/secret-files", "Life/Car-old.secrets\n");
    sandbox.git(vault, "add", ".eva/secret-files");
    sandbox.git(vault, "commit", "-q", "-m", "Keep the new secret path", "--", ".eva/secret-files");
    sandbox.write(vault, "Life/Diary/2026-11-03.md", "During.\n");
    await upgrade().upgrade.run("finish");
    sandbox.write(vault, "Life/Diary/2026-11-04.md", "Since.\n");
    expect(await upgrade().upgrade.run("undo")).toContain("undone");
    expect(readVaultStructure(vault)).toBe(2);
    expect(remoteFile("Life/Car/Car.md")).toBe("# Car");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).not.toContain("Car-old.md");
    expect(remoteFile("Life/Diary/2026-11-03.md")).toBe("During.");
    expect(remoteFile("Life/Diary/2026-11-04.md")).toBe("Since.");
    expect(remoteFile(".eva/secret-files")).toBe("Life/Car-old.secrets");
    // The upgrade can run again.
    expect(await refusal(upgrade().upgrade.run("undo"))).toContain("no upgrade to version 2");
    await upgrade().upgrade.run("start");
    expect(sandbox.git(vault, "tag", "--list")).toBe("before-v3\nbefore-v3-2");
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
      stateFolder: join(sandbox.root, "state", "vault-upgrade"),
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

  test("merges a moved file that was already on main, even one whose text matches a token shape", async () => {
    // A note that came in before the scan knew its shape: moving it is no new risk.
    sandbox.write(vault, "Life/Car/Old key.md", `key: sk-ant-${"a".repeat(30)}\n`);
    sandbox.git(vault, "add", "Life/Car/Old key.md");
    sandbox.git(vault, "commit", "-q", "-m", "An old note", "--", "Life/Car/Old key.md");
    await upgrade().upgrade.run("start");
    mkdirSync(join(vault, "Toolbox"), { recursive: true });
    sandbox.git(vault, "mv", "Life/Car/Old key.md", "Toolbox/Old key.md");
    sandbox.git(vault, "commit", "-q", "-m", "Move the note", "--", "Life/Car/Old key.md", "Toolbox/Old key.md");
    await upgrade().upgrade.run("finish");
    expect(readVaultStructure(vault)).toBe(3);
    expect(remoteFile("Toolbox/Old key.md")).toContain("sk-ant-");
  });

  test("merges a new binary file whose bytes happen to match a token shape", async () => {
    await upgrade().upgrade.run("start");
    const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(`sk-ant-${"b".repeat(30)}`)]);
    mkdirSync(join(vault, "Life/Cases"), { recursive: true });
    writeFileSync(join(vault, "Life/Cases/Photo.jpg"), photo);
    sandbox.git(vault, "add", "Life/Cases/Photo.jpg");
    sandbox.git(vault, "commit", "-q", "-m", "A photo", "--", "Life/Cases/Photo.jpg");
    await upgrade().upgrade.run("finish");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Life/Cases/Photo.jpg");
  });

  test("still refuses a plain binary file at a secret-file path", async () => {
    await upgrade().upgrade.run("start");
    writeFileSync(join(vault, "Life/Car/Key.bin"), Buffer.from([0x00, 0x01, 0x02]));
    sandbox.git(vault, "add", "Life/Car/Key.bin");
    sandbox.git(vault, "commit", "-q", "-m", "A key file", "--", "Life/Car/Key.bin");
    const { upgrade: command, sync } = upgrade();
    sync.isPlainSecret = (path) => path === "Life/Car/Key.bin";
    expect(await refusal(command.run("finish"))).toContain("Life/Car/Key.bin");
    expect(readVaultStructure(vault)).toBe(2);
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
  test("keeps the old note, and the version of the chat in a copy, and can run again", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/Car/Car.md", "# Car\n\nThe upgrade's text.\n");
    sandbox.git(vault, "commit", "-q", "-am", "Rewrite the car");
    sandbox.write(vault, "Life/Car/Car.md", "# Car\n\nThe upgrade's text, and a chat's line.\n");
    const text = await upgrade().upgrade.run("drop");
    expect(text).toContain("Life/Car/Car (conflict copy).md");
    expect(branch()).toBe("main");
    expect(remoteFile("Life/Car/Car.md")).toBe("# Car");
    expect(remoteFile("Life/Car/Car (conflict copy).md")).toContain("a chat's line");
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
    // The slim note differs in more than the location, so it stays in a copy too.
    expect(await upgrade().upgrade.run("undo")).toContain("Life/About me (conflict copy).md");
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

/** The scenarios of the second review: each one lost a note or a fact before. */
describe("nothing lost (second review)", () => {
  const aboutMe = (): string => readFileSync(join(vault, "Life/About me.md"), "utf-8");
  const writeAboutMe = (text: string): void => sandbox.write(vault, "Life/About me.md", text);
  const commitAll = (message: string): void => {
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", message);
  };
  /** The text of the copy that the output names. */
  const copyIn = (text: string): string => {
    const name = /(Life\/About me \(conflict copy[^)]*\)\.md)/.exec(text)?.[1];
    if (name === undefined) throw new Error(`No About me copy in: ${text}`);
    return readFileSync(join(vault, name), "utf-8");
  };

  test("A: a drop keeps the old About me, and the chat's edit in a named copy", async () => {
    writeAboutMe("---\nname: Sam\ndiet: vegetarian\nallergies: nuts\n---\n\nI sleep 7h.\n");
    commitAll("About me");
    await upgrade().upgrade.run("start");
    writeAboutMe("---\nname: Sam\npronouns: they\n---\n");
    sandbox.git(vault, "commit", "-q", "-am", "Slim About me");
    writeAboutMe("---\nname: Sam\npronouns: they\ncontact: sam@example.invalid\n---\n");
    const text = await upgrade().upgrade.run("drop");
    expect(aboutMe()).toContain("diet: vegetarian");
    expect(aboutMe()).toContain("I sleep 7h.");
    expect(copyIn(text)).toContain("contact: sam@example.invalid");
  });

  test("B and S7: an undo keeps the old About me, and the edits made since in a named copy", async () => {
    writeAboutMe("---\nname: Sam\ndiet: vegetarian\n---\nOld body.\n");
    commitAll("About me");
    await upgrade().upgrade.run("start");
    writeAboutMe("---\nname: Sam\npronouns: they\n---\nNew slim.\n");
    sandbox.git(vault, "commit", "-q", "-am", "Slim About me");
    await upgrade().upgrade.run("finish");
    writeAboutMe("---\nname: Sam\npronouns: they\nbirthDate: 1990-01-01\n---\nNew slim.\nAllergic to nuts.\n");
    await upgrade().sync.save();
    const text = await upgrade().upgrade.run("undo");
    expect(aboutMe()).toContain("diet: vegetarian");
    expect(copyIn(text)).toContain("Allergic to nuts.");
    expect(copyIn(text)).toContain("birthDate: 1990-01-01");
  });

  test("S8: a drop keeps a note that the person added to About me during the upgrade", async () => {
    writeAboutMe("---\nname: Sam\ndiet: veg\n---\nOld body.\n");
    commitAll("About me");
    await upgrade().upgrade.run("start");
    writeAboutMe("---\nname: Sam\n---\nNew slim.\n");
    sandbox.git(vault, "commit", "-q", "-am", "slim");
    writeAboutMe("---\nname: Sam\n---\nNew slim.\nAllergic to nuts.\n");
    const text = await upgrade().upgrade.run("drop");
    expect(aboutMe()).toContain("Old body.");
    expect(copyIn(text)).toContain("Allergic to nuts.");
  });

  test("C, D, S1 and N5: work that the skill staged but did not commit stops drop and finish, with its files", async () => {
    await upgrade().upgrade.run("start");
    sandbox.git(vault, "mv", "Life/Car/Car.md", "Life/Car-old.md");
    // A move committed under its new path only: the removal of the old path stays staged.
    sandbox.git(vault, "commit", "-q", "-m", "Move the car", "--", "Life/Car-old.md");
    for (const step of ["drop", "finish"] as const) {
      const refused = await refusal(upgrade().upgrade.run(step));
      expect(refused).toContain("Life/Car/Car.md");
      expect(branch()).toBe("upgrade-v3");
    }
  });

  test("a deleted note is no note written meanwhile: drop names it and stops", async () => {
    await upgrade().upgrade.run("start");
    rmSync(join(vault, "Life/Car/Car.md"));
    expect(await refusal(upgrade().upgrade.run("drop"))).toContain("Life/Car/Car.md");
    expect(branch()).toBe("upgrade-v3");
  });

  test("S2: an undo never leaves a moved note deleted, even after a full rewrite", async () => {
    await upgrade().upgrade.run("start");
    moveTheCar();
    await upgrade().upgrade.run("finish");
    sandbox.write(vault, "Life/Car-old.md", "Totally different long text here now. ".repeat(10));
    await upgrade().sync.save();
    await upgrade().upgrade.run("undo");
    expect(existsSync(join(vault, "Life/Car/Car.md"))).toBe(true);
    const files = sandbox.git(vault, "ls-files").split("\n");
    const rewritten = files.filter((file) =>
      readFileSync(join(vault, file), "utf-8").includes("Totally different long text"),
    );
    expect(rewritten.length).toBeGreaterThan(0);
  });

  test("S5: a merge that a local file blocks names the file", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/Objects/New.md", "from the branch\n");
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "new");
    sandbox.git(vault, "switch", "-q", "main");
    sandbox.write(vault, "Life/Objects/New.md", "from main, not committed\n");
    expect(await refusal(upgrade().upgrade.run("finish"))).toContain("Life/Objects/New.md");
    expect(readFileSync(join(vault, "Life/Objects/New.md"), "utf-8")).toBe("from main, not committed\n");
  });

  test("F1: a drop keeps the old About me when the skill's rewrite was never committed", async () => {
    const full = "---\nname: Sam\ndiet: vegetarian\nallergies: peanuts (severe)\n---\n\nI sleep 7h.\n";
    const slim = "---\nname: Sam\n---\n\nSee Life/Health for health facts.\n";
    writeAboutMe(full);
    commitAll("About me");
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/Health/Allergies and Diet.md", "diet: vegetarian\nallergies: peanuts (severe)\n");
    commitAll("File About me facts");
    // The chat stops before it commits the new About me.
    writeAboutMe(slim);
    const text = await upgrade().upgrade.run("drop");
    expect(aboutMe()).toBe(full);
    expect(copyIn(text)).toBe(slim);
  });

  test("F1b: the same with only the rewrite", async () => {
    const full = "---\nname: Sam\ndiet: vegetarian\n---\n";
    writeAboutMe(full);
    commitAll("About me");
    await upgrade().upgrade.run("start");
    writeAboutMe("---\nname: Sam\n---\n");
    const text = await upgrade().upgrade.run("drop");
    expect(aboutMe()).toBe(full);
    expect(copyIn(text)).toBe("---\nname: Sam\n---\n");
  });

  test("F2: finish refuses an uncommitted change to a file that the upgrade replaces", async () => {
    writeAboutMe("---\nname: Sam\ndiet: vegetarian\n---\n");
    commitAll("About me");
    await upgrade().upgrade.run("start");
    writeAboutMe("---\nname: Sam\n---\n");
    expect(await refusal(upgrade().upgrade.run("finish"))).toContain("Life/About me.md");
    expect(branch()).toBe("upgrade-v3");
    expect(readVaultStructure(vault)).toBe(2);
  });

  test("a drop puts back a file that only the upgrade made and a chat deleted", async () => {
    await upgrade().upgrade.run("start");
    sandbox.write(vault, "Life/People/AGENTS.md", "# People\n");
    commitAll("Add the folder rules");
    rmSync(join(vault, "Life/People/AGENTS.md"));
    expect(await upgrade().upgrade.run("drop")).toContain("dropped");
    expect(branch()).toBe("main");
  });

  test("an undo after the scratch folder was emptied moves the git-ignored files back from Eva's own copy", async () => {
    await upgrade().upgrade.run("start");
    renameSync(join(vault, "Life/Car/.env"), join(vault, "Life/car.env"));
    sandbox.write(vault, ".eva/scratch/vault-upgrade/v3-ignored-moves.tsv", "Life/Car/.env\tLife/car.env\n");
    await upgrade().upgrade.run("finish");
    rmSync(join(vault, ".eva", "scratch"), { recursive: true, force: true });
    await upgrade().upgrade.run("undo");
    expect(readFileSync(join(vault, "Life/Car/.env"), "utf-8")).toBe("PLATE_API=demo\n");
  });

  test("with no list at all, an undo names the git-ignored files that are not at their old place", async () => {
    await upgrade().upgrade.run("start");
    renameSync(join(vault, "Life/Car/.env"), join(vault, "Life/car.env"));
    await upgrade().upgrade.run("finish");
    rmSync(join(vault, ".eva", "scratch"), { recursive: true, force: true });
    rmSync(join(sandbox.root, "state", "vault-upgrade"), { recursive: true, force: true });
    expect(await upgrade().upgrade.run("undo")).toContain("may need to move back");
  });
});

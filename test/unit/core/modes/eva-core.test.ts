import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaCore, evaCoreFiles, evaCoreSkillNames } from "../../../../src/core/modes/eva-core.ts";
import { evaRepository } from "../../../../src/shared/version.ts";

let engines: string;
beforeEach(() => {
  engines = mkdtempSync(join(tmpdir(), "eva-core-"));
});
afterEach(() => {
  rmSync(engines, { recursive: true, force: true });
});

const skillsIn = (folder: string): string[] => readdirSync(join(folder, "skills")).sort();

describe("eva-core", () => {
  test("ships Eva's five skills and a manifest named eva-core", () => {
    expect(evaCoreSkillNames).toEqual(["about-me", "eva-issue", "eva-rules", "schedule", "vault-upgrade"]);
    const files = evaCoreFiles();
    expect(JSON.parse(files[".claude-plugin/plugin.json"] ?? "")).toMatchObject({ name: "eva-core" });
    for (const name of evaCoreSkillNames) expect(files[`skills/${name}/SKILL.md`]).toContain(`\nname: ${name}\n`);
    expect(Object.values(files).join("\n")).not.toContain("{{");
  });

  test("eva-issue holds the issue procedure, in Eva's own repository (#771)", () => {
    const skill = evaCoreFiles()["skills/eva-issue/SKILL.md"] ?? "";
    expect(skill).toContain(`gh issue create --repo ${evaRepository}`);
    expect(skill).toContain('the "Your own state" section of Eva\'s prompt');
    expect(skill).toContain("--body-file .eva/scratch/<name>.md");
    expect(skill).toContain("Done when");
    for (const fact of ["screen size", "phone, tablet or computer", "through Tailscale", "operating system"])
      expect(skill).toContain(fact);
    for (const placeholder of ["`<vault>`", "`<home>`", "`<machine>`", "`<person>`"])
      expect(skill).toContain(placeholder);
    expect(skill).toContain("Report a bug");
  });

  test("eva-rules adds a missing Personal rules section at the end of AGENTS.md (#771)", () => {
    const skill = evaCoreFiles()["skills/eva-rules/SKILL.md"] ?? "";
    expect(skill).toContain("`.eva/assistant.md`");
    expect(skill).toContain("`## Personal rules`");
    expect(skill).toContain("add that section at the end of the file");
    expect(skill).toContain("`eva settings set <key> <value>`");
  });

  test("writes eva-core into the engines folder at its first use", () => {
    const folder = new EvaCore(engines).folderFor([]);
    expect(folder).toBe(join(engines, "eva-core"));
    expect(skillsIn(folder)).toEqual([...evaCoreSkillNames]);
    expect(readFileSync(join(folder, ".claude-plugin", "plugin.json"), "utf-8")).toContain('"eva-core"');
  });

  test("a turn gets a copy without each skill that the vault replaces, written once", () => {
    const core = new EvaCore(engines);
    const folder = core.folderFor(["schedule", "about-me", "mine"]);
    expect(folder).toStartWith(join(engines, "eva-core-without-about-me-schedule-"));
    expect(skillsIn(folder)).toEqual(["eva-issue", "eva-rules", "vault-upgrade"]);
    // Another chat may read it: a later turn never rewrites it.
    writeFileSync(join(folder, "skills", "eva-rules", "SKILL.md"), "read by a running turn");
    expect(core.folderFor(["about-me", "schedule"])).toBe(folder);
    expect(readFileSync(join(folder, "skills", "eva-rules", "SKILL.md"), "utf-8")).toBe("read by a running turn");
    // The full plugin stays whole for a vault that replaces nothing.
    expect(skillsIn(core.folderFor([]))).toEqual([...evaCoreSkillNames]);
  });

  test("a new Eva process rewrites a changed eva-core, and removes the copies of the earlier one", () => {
    const first = new EvaCore(engines);
    const copy = first.folderFor(["schedule"]);
    const main = join(engines, "eva-core");
    writeFileSync(join(main, "skills", "schedule", "SKILL.md"), "an older Eva's text");
    mkdirSync(join(main, "skills", "retired-skill"));
    new EvaCore(engines).folderFor([]);
    expect(existsSync(copy)).toBe(false);
    expect(skillsIn(main)).toEqual([...evaCoreSkillNames]);
    expect(readFileSync(join(main, "skills", "schedule", "SKILL.md"), "utf-8")).toBe(
      evaCoreFiles()["skills/schedule/SKILL.md"] ?? "",
    );
  });

  test("leaves an eva-core with the same text as it is", () => {
    const main = new EvaCore(engines).folderFor([]);
    const before = statSync(join(main, "skills", "schedule", "SKILL.md")).ino;
    new EvaCore(engines).folderFor([]);
    expect(statSync(join(main, "skills", "schedule", "SKILL.md")).ino).toBe(before);
  });
});

describe("eva-core, when the folder is not as Eva left it", () => {
  test("a copy of an older Eva, left behind, never serves a turn", () => {
    const stale = join(engines, "eva-core-without-schedule");
    mkdirSync(join(stale, "skills", "eva-rules"), { recursive: true });
    const folder = new EvaCore(engines).folderFor(["schedule"]);
    expect(folder).not.toBe(stale);
    expect(skillsIn(folder)).toEqual(["about-me", "eva-issue", "eva-rules", "vault-upgrade"]);
  });

  test("a deleted eva-core comes back at the next turn", () => {
    const core = new EvaCore(engines);
    const main = core.folderFor([]);
    rmSync(main, { recursive: true });
    expect(core.folderFor([])).toBe(main);
    expect(skillsIn(main)).toEqual([...evaCoreSkillNames]);
  });

  test("the swap leaves no new or old folder behind", () => {
    const main = join(engines, "eva-core");
    new EvaCore(engines).folderFor([]);
    writeFileSync(join(main, "skills", "schedule", "SKILL.md"), "an older Eva's text");
    new EvaCore(engines).folderFor([]);
    expect(readdirSync(engines)).toEqual(["eva-core"]);
  });
});

describe("eva-core, when the system refuses a step", () => {
  const busy = (): Error => Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });

  test("a rebuilt eva-core keeps the copies that other chats read", () => {
    const core = new EvaCore(engines);
    const copy = core.folderFor(["schedule"]);
    rmSync(join(engines, "eva-core"), { recursive: true });
    core.folderFor([]);
    expect(skillsIn(copy)).toContain("eva-rules");
  });

  test("a failed swap keeps the older skills in use, and the next turn tries again", () => {
    new EvaCore(engines).folderFor([]);
    const main = join(engines, "eva-core");
    writeFileSync(join(main, "skills", "schedule", "SKILL.md"), "an older Eva's text");
    let refuse = true;
    let refused = 0;
    const logged: string[] = [];
    const core = new EvaCore(engines, { log: (_level, message) => logged.push(message) }, (from, to) => {
      if (refuse && from === main) {
        refused += 1;
        throw busy();
      }
      renameSync(from, to);
    });
    expect(core.folderFor([])).toBe(main);
    expect(readFileSync(join(main, "skills", "schedule", "SKILL.md"), "utf-8")).toBe("an older Eva's text");
    expect(refused).toBeGreaterThan(1);
    expect(logged).toContain("Eva could not update her own skills, so the chats use the older ones.");
    refuse = false;
    core.folderFor([]);
    expect(readFileSync(join(main, "skills", "schedule", "SKILL.md"), "utf-8")).toBe(
      evaCoreFiles()["skills/schedule/SKILL.md"] ?? "",
    );
  });

  test("a copy that Eva cannot write gives the turn the whole eva-core, and the log says why", () => {
    const logged: string[] = [];
    const core = new EvaCore(engines, { log: (_level, message) => logged.push(message) }, (from, to) => {
      if (to.includes("-without-")) throw busy();
      renameSync(from, to);
    });
    expect(core.folderFor(["schedule"])).toBe(join(engines, "eva-core"));
    expect(logged).toContain("Eva could not leave out the skills that the vault replaces.");
  });
});

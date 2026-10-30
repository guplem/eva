import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  alignmentProblem,
  contentHash,
  TemplateAlignment,
  templateHistory,
  templateRecordPath,
  type TemplatePart,
} from "../../../../src/core/vault/template-alignment.ts";
import { templateParts } from "../../../../src/core/vault/vault-template.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

const skill = ".eva/skills/demo/SKILL.md";
const oldText = "# Demo\n\nOld version.\n";
const newText = "# Demo\n\nNew version.\n";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-template-alignment-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function alignment(
  parts: Record<string, string> = { [skill]: newText },
  history: Record<string, string[]> = {},
): TemplateAlignment {
  return new TemplateAlignment({
    vaultPath: vault,
    parts,
    history,
    evaVersion: "1.0.0",
    now: () => new Date("2026-10-22T08:00:00.000Z"),
  });
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

function stateOf(parts: readonly TemplatePart[], path = skill): TemplatePart | undefined {
  return parts.find((part) => part.path === path);
}

describe("align", () => {
  test("installs a new part", () => {
    const parts = alignment().align();
    expect(read(skill)).toBe(newText);
    expect(stateOf(parts)).toEqual({
      path: skill,
      kind: "skill",
      name: "demo",
      state: "current",
      updatedAt: "2026-10-22T08:00:00.000Z",
      newText: null,
    });
  });

  test("leaves an up-to-date part as it is", () => {
    write(skill, newText);
    expect(stateOf(alignment().align())?.state).toBe("current");
    expect(read(skill)).toBe(newText);
  });

  test("updates a part that the person never changed", () => {
    alignment({ [skill]: oldText }).align();
    const parts = alignment().align();
    expect(read(skill)).toBe(newText);
    expect(stateOf(parts)?.state).toBe("current");
  });

  test("updates an old copy from before the record, when the template history knows it", () => {
    write(skill, oldText);
    alignment(undefined, { [skill]: [contentHash(oldText)] }).align();
    expect(read(skill)).toBe(newText);
  });

  test("reads a copy with Windows line ends as the same text", () => {
    write(skill, newText.replaceAll("\n", "\r\n"));
    expect(stateOf(alignment().align())?.state).toBe("current");
  });

  test("keeps a part that the person changed, and asks when Eva has a new version", () => {
    alignment({ [skill]: oldText }).align();
    write(skill, "# Demo\n\nMy version.\n");
    const parts = alignment().align();
    expect(read(skill)).toBe("# Demo\n\nMy version.\n");
    expect(stateOf(parts)?.state).toBe("differs");
  });

  test("calls a changed part 'yours' while Eva's version stays the same", () => {
    alignment().align();
    write(skill, "# Demo\n\nMy version.\n");
    expect(stateOf(alignment().align())?.state).toBe("yours");
  });

  test("asks about an unknown copy from before the record", () => {
    write(skill, "# Demo\n\nSomething else.\n");
    expect(stateOf(alignment().align())?.state).toBe("differs");
  });

  test("does not put back a part that the person deleted", () => {
    alignment().align();
    rmSync(join(vault, skill));
    expect(stateOf(alignment().align())?.state).toBe("missing");
    expect(existsSync(join(vault, skill))).toBe(false);
  });

  test("removes a retired part that the person never changed", () => {
    alignment({ [skill]: oldText, ".eva/skills/gone/SKILL.md": "# Gone\n" }).align();
    const parts = alignment().align();
    expect(existsSync(join(vault, ".eva/skills/gone"))).toBe(false);
    expect(parts.map((part) => part.path)).toEqual([skill]);
  });

  test("keeps a retired part that the person changed, as their own", () => {
    alignment({ [skill]: oldText, ".eva/skills/gone/SKILL.md": "# Gone\n" }).align();
    write(".eva/skills/gone/SKILL.md", "# Mine now\n");
    alignment().align();
    expect(read(".eva/skills/gone/SKILL.md")).toBe("# Mine now\n");
    const record = JSON.parse(readFileSync(templateRecordPath(vault), "utf-8")) as { parts: Record<string, unknown> };
    expect(Object.keys(record.parts)).toEqual([skill]);
  });

  test("never touches the person's own skills", () => {
    write(".eva/skills/mine/SKILL.md", "# Mine\n");
    alignment().align();
    expect(read(".eva/skills/mine/SKILL.md")).toBe("# Mine\n");
  });

  test("reads a damaged record as empty, and repairs it", () => {
    write(".eva/template.json", "{ not json");
    write(skill, newText);
    expect(stateOf(alignment().align())?.state).toBe("current");
    expect(JSON.parse(read(".eva/template.json"))).toMatchObject({ version: 1 });
  });
});

describe("list", () => {
  test("changes nothing", () => {
    write(skill, oldText);
    expect(stateOf(alignment().list())?.state).toBe("differs");
    expect(read(skill)).toBe(oldText);
    expect(existsSync(templateRecordPath(vault))).toBe(false);
  });

  test("shows a step that the hub takes by itself as pending", () => {
    expect(stateOf(alignment().list())?.state).toBe("pending");
    write(skill, oldText);
    expect(stateOf(alignment(undefined, { [skill]: [contentHash(oldText)] }).list())?.state).toBe("pending");
  });

  test("names a part after its folder, also for a file deeper inside", () => {
    const deep = ".eva/skills/demo/scripts/run.py";
    expect(stateOf(alignment({ [deep]: "print(1)\n" }).list(), deep)?.name).toBe("demo");
  });
});

describe("choices", () => {
  beforeEach(() => {
    alignment({ [skill]: oldText }).align();
    write(skill, "# Demo\n\nMy version.\n");
  });

  test("'use the new one' writes Eva's version", () => {
    const parts = alignment().useNew(skill);
    expect(read(skill)).toBe(newText);
    expect(stateOf(parts)?.state).toBe("current");
  });

  test("'keep mine' stops the question until Eva has another version", () => {
    expect(stateOf(alignment().keepMine(skill))?.state).toBe("kept");
    expect(stateOf(alignment().align())?.state).toBe("kept");
    expect(stateOf(alignment({ [skill]: "# Demo\n\nNewer.\n" }).align())?.state).toBe("differs");
  });

  test("'use the new one' also puts back a deleted part", () => {
    rmSync(join(vault, skill));
    alignment().useNew(skill);
    expect(read(skill)).toBe(newText);
  });

  test("refuses a path that is no template part", () => {
    try {
      alignment().useNew(".eva/assistant.md");
      throw new Error("no error");
    } catch (caught) {
      expect(isEvaError(caught) && caught.code === "file_not_found").toBe(true);
    }
  });
});

describe("alignmentProblem", () => {
  test("names each part that differs", () => {
    const problem = alignmentProblem([
      { path: skill, kind: "skill", name: "demo", state: "differs", updatedAt: null, newText: newText },
      { path: ".eva/skills/b/SKILL.md", kind: "skill", name: "b", state: "current", updatedAt: null, newText: null },
    ]);
    expect(problem?.level).toBe("warn");
    expect(problem?.message).toContain("demo");
    expect(problem?.message).toContain("Template alignment");
  });

  test("is null when nothing differs", () => {
    expect(
      alignmentProblem([{ path: skill, kind: "skill", name: "demo", state: "kept", updatedAt: null, newText: null }]),
    ).toBeNull();
  });
});

describe("templateParts", () => {
  test("holds each skill of the vault template", () => {
    expect(Object.keys(templateParts)).toContain(".eva/skills/schedule/SKILL.md");
  });
});

describe("templateHistory", () => {
  test("lists only older versions, never the current one", () => {
    for (const [path, hashes] of Object.entries(templateHistory)) {
      expect(hashes).not.toContain(contentHash(templateParts[path] ?? ""));
    }
  });
});

describe("newText", () => {
  test("comes only with a part that differs, so the person can merge it", () => {
    write(skill, "# Demo\n\nMine.\n");
    expect(stateOf(alignment().list())?.newText).toBe(newText);
    alignment().keepMine(skill);
    expect(stateOf(alignment().list())?.newText).toBeNull();
  });
});

describe("a newer Eva", () => {
  test("keeps an older Eva from writing the parts that it wrote", () => {
    alignment().align();
    const older = new TemplateAlignment({
      vaultPath: vault,
      parts: { [skill]: oldText },
      history: {},
      evaVersion: "0.9.0",
      now: () => new Date("2026-10-22T08:00:00.000Z"),
    });
    for (const step of [() => older.align(), () => older.useNew(skill), () => older.keepMine(skill)]) {
      try {
        step();
        throw new Error("no error");
      } catch (caught) {
        expect(isEvaError(caught, "vault_ahead")).toBe(true);
      }
    }
    expect(read(skill)).toBe(newText);
  });

  test("keeps an older Eva from writing a record of a newer format", () => {
    write(".eva/template.json", JSON.stringify({ version: 2, parts: {} }));
    expect(() => alignment().align()).toThrow("newer Eva");
  });
});

describe("the message box menu parts (#661)", () => {
  test("a text action and a saved prompt are parts with their own kind, named by the file", () => {
    const action = ".eva/settings/text-actions/Polish.md";
    const prompt = ".eva/settings/saved-prompts/Summary.md";
    const parts = alignment({ [action]: "Fix it.\n", [prompt]: "Sum it up.\n" }).align();
    expect(stateOf(parts, action)).toMatchObject({ kind: "text action", name: "Polish", state: "current" });
    expect(stateOf(parts, prompt)).toMatchObject({ kind: "saved prompt", name: "Summary", state: "current" });
  });

  test("the template holds Polish and Summary, so every vault gets them once", () => {
    expect(Object.keys(templateParts)).toContain(".eva/settings/text-actions/Polish.md");
    expect(Object.keys(templateParts)).toContain(".eva/settings/saved-prompts/Summary.md");
  });
});

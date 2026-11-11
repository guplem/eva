import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  discoverLifeEntities,
  maxBodyBytes,
  readLifeEntity,
  redactLifeEntity,
} from "../../../../src/core/life/life-catalog.ts";
import { createVaultKey, encryptFile } from "../../../../src/core/vault/vault-crypto.ts";

let vault: string;

function write(path: string, text: string | Uint8Array): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-life-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("discoverLifeEntities", () => {
  test("a case gives its keys, its title and its nested steps", () => {
    write(
      "Life/Cases/2026-05-15-phone-repair/Case.md",
      [
        "---",
        "opened: 2026-05-15",
        "closed:",
        "steps:",
        "  - { step: Send the photos, done-on: 2026-05-15 }",
        "  - { step: Get the answer, waiting-for: The shop, due-by: 2026-06-01 }",
        "deadline: { date: 2026-06-15, cost: The right to claim expires }",
        "aliases: [the phone claim]",
        "summary: The screen broke.",
        "---",
        "# Phone repair",
        "",
        "Text.",
        "",
      ].join("\n"),
    );
    expect(discoverLifeEntities(vault, "cases")).toEqual([
      {
        kind: "cases",
        id: "2026-05-15-phone-repair",
        folder: "Life/Cases/2026-05-15-phone-repair",
        path: "Life/Cases/2026-05-15-phone-repair/Case.md",
        title: "Phone repair",
        summary: "The screen broke.",
        aliases: ["the phone claim"],
        tags: [],
        fields: {
          opened: "2026-05-15",
          // The failsafe schema gives an empty text for an empty key: the client reads it as "not set".
          closed: "",
          steps: [
            { step: "Send the photos", "done-on": "2026-05-15" },
            { step: "Get the answer", "waiting-for": "The shop", "due-by": "2026-06-01" },
          ],
          deadline: { date: "2026-06-15", cost: "The right to claim expires" },
        },
        warnings: [],
      },
    ]);
  });

  test("each kind reads its own folder and main file, sorted by id", () => {
    write("Life/People/Sam Example/Person.md", "---\nrelation: friend\n---\n");
    write("Life/People/Alex Example/Person.md", "---\nrelation: sister of Life/People/Sam Example\n---\n");
    write("Life/Objects/Car - Example Model - 1234ABC/Object.md", "---\nstatus: in-use\ntype: car\n---\n");
    write("Life/Pets/Luna/Pet.md", "---\nspecies: dog\ndeath:\n---\n");
    write("Life/Periods/2024-09-01-example-corp-engineer/Period.md", "---\ntype: job\nfrom: 2024-09-01\nto:\n---\n");
    // The wrong main file for its kind is not an entity.
    write("Life/Pets/Max/Person.md", "---\nspecies: cat\n---\n");
    expect(discoverLifeEntities(vault, "people").map((entity) => [entity.id, entity.title, entity.fields])).toEqual([
      ["Alex Example", "Alex Example", { relation: "sister of Life/People/Sam Example" }],
      ["Sam Example", "Sam Example", { relation: "friend" }],
    ]);
    expect(discoverLifeEntities(vault, "objects")[0]).toMatchObject({
      title: "Car - Example Model - 1234ABC",
      path: "Life/Objects/Car - Example Model - 1234ABC/Object.md",
      fields: { status: "in-use", type: "car" },
    });
    expect(discoverLifeEntities(vault, "pets").map((entity) => entity.id)).toEqual(["Luna"]);
    expect(discoverLifeEntities(vault, "periods")[0]).toMatchObject({
      title: "Example corp engineer",
      fields: { type: "job", from: "2024-09-01", to: "" },
    });
  });

  test("an old case of a vault before structure v7 passes its keys through with no warning", () => {
    write(
      "Life/Cases/2025-01-10-old-claim/Case.md",
      "---\nstatus: waiting\nnext: { date: 2025-02-01, step: Call the shop }\n---\n# Old claim\n",
    );
    write("Life/Periods/2020-01-01-old-job/Period.md", "---\nkind: job\nstatus: open\n---\n");
    expect(discoverLifeEntities(vault, "cases")[0]).toMatchObject({
      fields: { status: "waiting", next: { date: "2025-02-01", step: "Call the shop" } },
      warnings: [],
    });
    expect(discoverLifeEntities(vault, "periods")[0]).toMatchObject({
      fields: { kind: "job", status: "open" },
      warnings: [],
    });
  });

  test("a bad file gives a warning and never hides the others", () => {
    write("Life/Cases/2026-01-01-bad-yaml/Case.md", "---\nsummary: [not closed\n---\n# Bad\n");
    write("Life/Cases/2026-01-02-no-front-matter/Case.md", "# Plain note\n\nNo keys.\n");
    write("Life/Cases/2026-01-03-a-list/Case.md", "---\n- one\n- two\n---\n");
    write("Life/Cases/2026-01-04-good/Case.md", "---\nsummary: Fine.\ntags: hobby\n---\n");
    write("Life/Cases/2026-01-05-odd-keys/Case.md", "---\nsummary: [a, b]\naliases: [one, { two: 2 }]\n---\n");
    const entities = discoverLifeEntities(vault, "cases");
    expect(entities.map((entity) => [entity.id, entity.title, entity.warnings.length])).toEqual([
      ["2026-01-01-bad-yaml", "Bad", 1],
      ["2026-01-02-no-front-matter", "Plain note", 1],
      ["2026-01-03-a-list", "A list", 1],
      ["2026-01-04-good", "Good", 0],
      ["2026-01-05-odd-keys", "Odd keys", 2],
    ]);
    expect(entities[0]?.fields).toEqual({});
    expect(entities[3]).toMatchObject({ summary: "Fine.", tags: ["hobby"] });
    expect(entities[4]).toMatchObject({ summary: null, aliases: ["one"] });
  });

  test("a folder with no main file, a linked folder, a dot folder and a linked main file are left out", () => {
    write("Life/Cases/2026-01-01-empty/notes.md", "# Notes\n");
    write("Life/Cases/.hidden/Case.md", "---\n---\n");
    const outside = mkdtempSync(join(tmpdir(), "eva-life-outside-"));
    try {
      mkdirSync(join(outside, "case"), { recursive: true });
      writeFileSync(join(outside, "case", "Case.md"), "---\nsummary: Outside.\n---\n");
      symlinkSync(join(outside, "case"), join(vault, "Life/Cases/2026-01-02-linked"), "junction");
      mkdirSync(join(vault, "Life/Cases/2026-01-03-linked-file"));
      symlinkSync(join(outside, "case", "Case.md"), join(vault, "Life/Cases/2026-01-03-linked-file/Case.md"));
      expect(discoverLifeEntities(vault, "cases")).toEqual([]);
    } catch (error) {
      // Windows without developer mode refuses a file link: the folder link alone was checked.
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a linked Life folder is not read", () => {
    const outside = mkdtempSync(join(tmpdir(), "eva-life-outside-"));
    try {
      mkdirSync(join(outside, "Cases", "2026-01-01-x"), { recursive: true });
      writeFileSync(join(outside, "Cases", "2026-01-01-x", "Case.md"), "---\n---\n");
      symlinkSync(outside, join(vault, "Life"), "junction");
      expect(discoverLifeEntities(vault, "cases")).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("an encrypted main file is left out", async () => {
    const key = await createVaultKey("a long test password", { logN: 10 });
    const path = "Life/Cases/2026-01-01-locked/Case.md";
    write(path, encryptFile(new TextEncoder().encode("---\nsummary: Hidden.\n---\n"), key, path));
    write("Life/Cases/2026-01-02-open/Case.md", "---\nsummary: Shown.\n---\n");
    expect(discoverLifeEntities(vault, "cases").map((entity) => entity.id)).toEqual(["2026-01-02-open"]);
  });

  test("a missing folder or vault gives no entity", () => {
    expect(discoverLifeEntities(vault, "pets")).toEqual([]);
    expect(discoverLifeEntities(join(vault, "gone"), "pets")).toEqual([]);
  });

  test("a front matter that the read limit cuts gives a warning", () => {
    write("Life/Pets/Big/Pet.md", `---\nspecies: dog\nnotes: ${"a".repeat(maxBodyBytes)}\n---\n`);
    expect(discoverLifeEntities(vault, "pets")[0]).toMatchObject({ fields: {}, warnings: [expect.any(String)] });
  });
});

describe("readLifeEntity", () => {
  test("adds the text and the files beside the main file, without secrets", () => {
    const folder = "Life/Objects/Home - Example Street 1 - 2020";
    write(`${folder}/Object.md`, "---\nstatus: in-use\n---\n# Home\n\nThe flat.\n");
    write(`${folder}/Invoice.pdf`, "pdf");
    write(`${folder}/Fixtures.md`, "# Fixtures\n");
    write(`${folder}/Photos/front.jpg`, "jpg");
    write(`${folder}/Wi-Fi.secrets`, "secret");
    write(`${folder}/.env`, "KEY=value");
    expect(readLifeEntity(vault, "objects", "Home - Example Street 1 - 2020")).toMatchObject({
      title: "Home",
      body: "# Home\n\nThe flat.\n",
      files: [
        { name: "Fixtures.md", path: `${folder}/Fixtures.md`, kind: "file" },
        { name: "Invoice.pdf", path: `${folder}/Invoice.pdf`, kind: "file" },
        { name: "Photos", path: `${folder}/Photos`, kind: "folder" },
      ],
    });
  });

  test("cuts a long text at the limit and says so", () => {
    write("Life/Pets/Luna/Pet.md", `---\nspecies: dog\n---\n${"word ".repeat(maxBodyBytes / 4)}`);
    const pet = readLifeEntity(vault, "pets", "Luna");
    expect(pet?.body.length).toBeLessThan(maxBodyBytes);
    expect(pet?.fields).toEqual({ species: "dog" });
    expect(pet?.warnings).toHaveLength(1);
  });

  test("an id that is not one folder name, or no entity, gives null", () => {
    write("Life/Cases/2026-01-01-claim/Case.md", "---\n---\n");
    write("Life/People/Alex Example/Person.md", "---\n---\n");
    expect(readLifeEntity(vault, "cases", "2026-01-01-claim")?.id).toBe("2026-01-01-claim");
    for (const id of ["..", ".", "", "../People/Alex Example", "2026-01-01-claim/..", "a\\b", "line\nbreak"])
      expect(readLifeEntity(vault, "cases", id)).toBeNull();
    expect(readLifeEntity(vault, "cases", "2026-01-02-gone")).toBeNull();
    expect(readLifeEntity(vault, "pets", "Luna")).toBeNull();
  });
});

describe("redactLifeEntity", () => {
  test("redacts every text, also inside nested fields", () => {
    write(
      "Life/Cases/2026-01-01-leak/Case.md",
      "---\nsummary: has SECRET\naliases: [SECRET alias]\nsteps:\n  - { step: send SECRET }\n---\n# SECRET title\n\nBody SECRET.\n",
    );
    const entity = readLifeEntity(vault, "cases", "2026-01-01-leak");
    if (entity === null) throw new Error("The case is missing.");
    const redacted = redactLifeEntity(entity, (text) => text.replaceAll("SECRET", "[redacted]"));
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
    expect(redacted).toMatchObject({ title: "[redacted] title", fields: { steps: [{ step: "send [redacted]" }] } });
    expect(redacted.body).toContain("Body [redacted].");
  });
});

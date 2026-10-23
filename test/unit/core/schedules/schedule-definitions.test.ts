import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  announcedFields,
  changedFields,
  editScheduleDefinition,
  parseScheduleEntry,
  readScheduleDefinitions,
  removeScheduleDefinition,
  saveScheduleDefinition,
  setScheduleEnabled,
  type Schedule,
} from "../../../../src/core/schedules/schedule-definitions.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let path: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-schedules-"));
  path = join(folder, "schedules.json");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const morning = { id: "morning", name: "Morning", at: "07:30", prompt: "Summarise my day." };
const interval = { id: "water", name: "Water", every: "2h", from: "2026-10-22T08:00", text: "Drink water." };

function writeFile(value: unknown): void {
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

describe("readScheduleDefinitions (lessons 64, 69)", () => {
  test("a missing file means no schedules and no problems", () => {
    expect(readScheduleDefinitions(path)).toEqual({ schedules: [], problems: [] });
  });

  test("a file that is not JSON is one problem, never a crash", () => {
    writeFile("{ not json");
    expect(readScheduleDefinitions(path).problems).toEqual(["The schedules file could not be read as JSON."]);
  });

  test("a deeply nested file is a problem, never a crash (lesson 69)", () => {
    writeFile("[".repeat(100_000) + "]".repeat(100_000));
    expect(readScheduleDefinitions(path).schedules).toEqual([]);
  });

  test("a wrong version or a missing list is one problem", () => {
    writeFile({ version: 2, schedules: [] });
    expect(readScheduleDefinitions(path).problems[0]).toContain("format version 1");
    writeFile({ version: 1 });
    expect(readScheduleDefinitions(path).problems).toEqual(["The schedules file holds no list."]);
  });

  test("a bad entry is skipped and the good ones still run", () => {
    writeFile({ version: 1, schedules: [morning, { id: "Bad Id" }, { ...morning, name: "Again" }] });
    const definitions = readScheduleDefinitions(path);
    expect(definitions.schedules.map((schedule) => schedule.id)).toEqual(["morning"]);
    expect(definitions.problems).toEqual([
      "Schedule 2 has no valid id: use 1 to 32 lowercase letters, digits or dashes.",
      "Schedule 3 uses the id morning twice, so it was skipped.",
    ]);
  });
});

describe("parseScheduleEntry", () => {
  test("days default to every day, and a valid entry keeps its steps", () => {
    expect(parseScheduleEntry({ ...morning, text: " Drink water ", model: "haiku" }, 1)).toEqual({
      id: "morning",
      name: "Morning",
      at: "07:30",
      days: [0, 1, 2, 3, 4, 5, 6],
      text: "Drink water",
      file: null,
      prompt: "Summarise my day.",
      model: "haiku",
      enabled: true,
      every: null,
      from: null,
    });
  });

  test("an interval schedule repeats every few hours, days or weeks from its first run", () => {
    const parsed = parseScheduleEntry(
      { id: "water", name: "Water", every: "3d", from: "2026-10-22T07:30", text: "Drink water." },
      1,
    ) as Schedule;
    expect([parsed.every, parsed.from, parsed.at, parsed.days]).toEqual(["3d", "2026-10-22T07:30", null, null]);
    for (const every of ["1h", "12h", "2w", "999d"])
      expect(typeof parseScheduleEntry({ ...interval, every }, 1)).toBe("object");
  });

  test("days are read in any case, without repeats, in week order", () => {
    const parsed = parseScheduleEntry({ ...morning, days: ["FRI", "mon", "fri"] }, 1) as Schedule;
    expect(parsed.days).toEqual([1, 5]);
  });

  test.each([
    [[], "is not an object"],
    [{ ...morning, name: " " }, "has no name"],
    [{ ...morning, at: "7:30" }, "no valid time"],
    [{ ...morning, at: "24:00" }, "no valid time"],
    [{ ...morning, days: [] }, "invalid days"],
    [{ ...morning, days: ["someday"] }, "invalid days"],
    [{ id: "x", name: "X", at: "07:00" }, "does nothing"],
    [{ ...morning, file: "Scratch/today.pdf" }, "from Scratch/"],
    [{ ...morning, file: "Scratch\\today.pdf" }, "from Scratch/"],
    // A typo must never run a schedule that the person turned off.
    [{ ...morning, enabled: "false" }, "invalid enabled"],
    [{ ...morning, enabled: null }, "invalid enabled"],
    [{ ...morning, enabled: 0 }, "invalid enabled"],
    [{ ...interval, every: "0d" }, "invalid every"],
    [{ ...interval, every: "3 days" }, "invalid every"],
    [{ ...interval, every: "30m" }, "invalid every"],
    [{ ...interval, every: 3 }, "invalid every"],
    [{ ...interval, from: undefined }, "no valid from"],
    [{ ...interval, from: "2026-10-22 07:30" }, "no valid from"],
    [{ ...interval, from: "2026-02-30T07:30" }, "no valid from"],
    [{ ...interval, at: "07:30" }, "both every and at or days"],
    [{ ...interval, days: ["mon"] }, "both every and at or days"],
    [{ ...morning, from: "2026-10-22T07:30" }, "from without every"],
  ])("entry %j is skipped: %s", (entry, reason) => {
    expect(parseScheduleEntry(entry, 4)).toContain(reason);
  });

  test("a schedule is on without the field, and off only with enabled false", () => {
    expect((parseScheduleEntry({ ...morning, enabled: true }, 1) as Schedule).enabled).toBe(true);
    expect((parseScheduleEntry({ ...morning, enabled: false }, 1) as Schedule).enabled).toBe(false);
  });

  test("a long name is cut to the Telegram topic limit", () => {
    expect((parseScheduleEntry({ ...morning, name: "n".repeat(200) }, 1) as Schedule).name).toHaveLength(128);
  });
});

describe("announced fields and changes (lesson 66)", () => {
  test("a card lists every field that is set, in a fixed order", () => {
    const schedule = parseScheduleEntry({ ...morning, days: ["mon", "tue"] }, 1) as Schedule;
    const fields = announcedFields(schedule);
    expect(Object.keys(fields)).toEqual(["id", "name", "at", "days", "prompt"]);
    expect(fields.days).toBe("mon, tue");
  });

  test("an interval schedule shows every and from, and no days", () => {
    const fields = announcedFields(parseScheduleEntry(interval, 1) as Schedule);
    expect(Object.keys(fields)).toEqual(["id", "name", "every", "from", "text"]);
    expect([fields.every, fields.from]).toEqual(["2h", "2026-10-22T08:00"]);
  });

  test("the on/off state is no announced field, so a pause never changes a card", () => {
    const on = announcedFields(parseScheduleEntry(morning, 1) as Schedule);
    const off = announcedFields(parseScheduleEntry({ ...morning, enabled: false }, 1) as Schedule);
    expect(changedFields(on, off)).toEqual([]);
  });

  test("a change names only the fields that differ", () => {
    const before = announcedFields(parseScheduleEntry(morning, 1) as Schedule);
    const after = announcedFields(parseScheduleEntry({ ...morning, at: "08:00", text: "Hi" }, 1) as Schedule);
    expect(changedFields(before, after)).toEqual(["at", "text"]);
  });
});

describe("saving and removing", () => {
  test("save adds a schedule to a missing file, then replaces it by id", () => {
    saveScheduleDefinition(path, morning);
    saveScheduleDefinition(path, { ...morning, at: "08:00" });
    const definitions = readScheduleDefinitions(path);
    expect(definitions.schedules.map((schedule) => schedule.at)).toEqual(["08:00"]);
    expect(readFileSync(path, "utf8")).toEndWith("\n");
  });

  test("save refuses an invalid entry and leaves the file as it is", () => {
    writeFile({ version: 1, schedules: [morning] });
    let caught: unknown;
    try {
      saveScheduleDefinition(path, { id: "x" });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "schedule_invalid")).toBe(true);
    expect(readScheduleDefinitions(path).schedules).toHaveLength(1);
  });

  test("remove keeps the other entries and their unknown keys", () => {
    writeFile({ version: 1, note: "keep me", schedules: [morning, { ...morning, id: "evening", extra: 1 }] });
    expect(removeScheduleDefinition(path, "morning")).toBe(true);
    expect(removeScheduleDefinition(path, "morning")).toBe(false);
    const file = JSON.parse(readFileSync(path, "utf8")) as { note: string; schedules: unknown[] };
    expect(file.note).toBe("keep me");
    expect(file.schedules).toEqual([{ ...morning, id: "evening", extra: 1 }]);
  });

  test("setScheduleEnabled changes only the enabled key, and turning on removes it", () => {
    writeFile({
      version: 1,
      schedules: [
        { ...morning, extra: 1 },
        { ...morning, id: "evening" },
      ],
    });
    expect(setScheduleEnabled(path, "morning", false)).toBe(true);
    let file = JSON.parse(readFileSync(path, "utf8")) as { schedules: unknown[] };
    expect(file.schedules).toEqual([
      { ...morning, extra: 1, enabled: false },
      { ...morning, id: "evening" },
    ]);
    expect(setScheduleEnabled(path, "morning", true)).toBe(true);
    file = JSON.parse(readFileSync(path, "utf8")) as { schedules: unknown[] };
    expect(file.schedules[0]).toEqual({ ...morning, extra: 1 });
    expect(setScheduleEnabled(path, "nobody", false)).toBe(false);
  });

  test("editScheduleDefinition changes the form's keys and keeps every other key", () => {
    writeFile({
      version: 1,
      schedules: [
        { ...morning, file: "Notes/daily.md", model: "sonnet", enabled: false, extra: 1 },
        { ...morning, id: "evening" },
      ],
    });
    const edited = editScheduleDefinition(path, "morning", { name: "Early", at: "06:00", days: ["mon"] });
    expect(edited?.at).toBe("06:00");
    const file = JSON.parse(readFileSync(path, "utf8")) as { schedules: unknown[] };
    expect(file.schedules).toEqual([
      {
        id: "morning",
        name: "Early",
        at: "06:00",
        file: "Notes/daily.md",
        model: "sonnet",
        enabled: false,
        extra: 1,
        days: ["mon"],
      },
      { ...morning, id: "evening" },
    ]);
  });

  test("editScheduleDefinition drops a form key that the edit leaves out, such as the old repeat", () => {
    writeFile({ version: 1, schedules: [{ ...morning, days: ["mon"], text: "Hi." }] });
    editScheduleDefinition(path, "morning", { name: "Morning", every: "1d", from: "2026-10-22T07:30", prompt: "P." });
    const file = JSON.parse(readFileSync(path, "utf8")) as { schedules: unknown[] };
    expect(file.schedules).toEqual([
      { id: "morning", name: "Morning", every: "1d", from: "2026-10-22T07:30", prompt: "P." },
    ]);
  });

  test("editScheduleDefinition keeps the id, refuses an invalid result, and knows no other id", () => {
    writeFile({ version: 1, schedules: [morning] });
    editScheduleDefinition(path, "morning", { ...morning, id: "other", name: "Renamed" });
    expect(readScheduleDefinitions(path).schedules.map((schedule) => schedule.id)).toEqual(["morning"]);
    let caught: unknown;
    try {
      editScheduleDefinition(path, "morning", { name: "Morning", at: "7" });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "schedule_invalid")).toBe(true);
    expect(readScheduleDefinitions(path).schedules[0]?.name).toBe("Renamed");
    expect(editScheduleDefinition(path, "nobody", morning)).toBeNull();
  });

  test("a broken file is never replaced by a guess", () => {
    writeFile("{ broken");
    expect(() => removeScheduleDefinition(path, "morning")).toThrow("not valid JSON");
    writeFile({ version: 1 });
    expect(() => saveScheduleDefinition(path, morning)).toThrow("holds no list");
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify({ version: 1 }));
  });
});

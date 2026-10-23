import { describe, expect, test } from "bun:test";
import type { Schedule } from "../../../../../src/core/schedules/schedule-definitions.ts";
import { emptyScheduleForm, entryOf, fieldsOf, formOf } from "../../../../../src/frontends/web/client/schedule-form.ts";

const morning: Schedule = {
  id: "morning",
  name: "Morning",
  at: "06:30",
  days: [1, 5],
  every: null,
  from: null,
  text: "Good morning.",
  file: null,
  prompt: null,
  model: null,
  enabled: true,
};

describe("emptyScheduleForm", () => {
  test("offers the next whole hour as the first run", () => {
    expect(emptyScheduleForm("2026-10-23T08:46").from).toBe("2026-10-23T09:00");
    expect(emptyScheduleForm(null).from).toBe("");
  });

  test("builds the entry of a new schedule on days", () => {
    const form = { ...emptyScheduleForm(null), id: " walk ", name: "Walk", at: "07:30", days: ["fri", "mon"] };
    expect(entryOf(form)).toEqual({ id: "walk", name: "Walk", at: "07:30", days: ["mon", "fri"] });
  });

  test("builds the entry of a new interval schedule", () => {
    const form = {
      ...emptyScheduleForm(null),
      id: "water",
      name: "Water",
      repeat: "every" as const,
      count: "3",
      from: "2030-01-02T07:30",
      text: "Water the plants.",
    };
    expect(entryOf(form)).toEqual({
      id: "water",
      name: "Water",
      every: "3d",
      from: "2030-01-02T07:30",
      text: "Water the plants.",
    });
  });
});

describe("formOf", () => {
  test("fills the form with a schedule on days, from Monday", () => {
    const form = formOf({ ...morning, days: [5, 1], prompt: "Plan my day." });
    expect(form).toMatchObject({ id: "morning", name: "Morning", repeat: "days", at: "06:30", days: ["mon", "fri"] });
    expect(form).toMatchObject({ text: "Good morning.", prompt: "Plan my day." });
  });

  test("picks no day for a schedule that runs every day, as the form shows every day", () => {
    expect(formOf({ ...morning, days: [0, 1, 2, 3, 4, 5, 6] }).days).toEqual([]);
  });

  test("offers the next whole hour as the first run, for a switch to an interval", () => {
    expect(formOf(morning, "2026-10-23T08:46").from).toBe("2026-10-23T09:00");
  });

  test("fills the form with an interval schedule", () => {
    const form = formOf(
      { ...morning, at: null, days: null, every: "12h", from: "2026-10-23T09:00" },
      "2026-10-23T08:46",
    );
    expect(form).toMatchObject({ repeat: "every", count: "12", unit: "h", from: "2026-10-23T09:00" });
  });

  test("gives back the same fields when nothing changes", () => {
    expect(fieldsOf(formOf(morning))).toEqual({
      name: "Morning",
      at: "06:30",
      days: ["mon", "fri"],
      text: "Good morning.",
    });
  });
});

describe("fieldsOf", () => {
  test("sends no id, as the id of an edited schedule never changes", () => {
    expect(fieldsOf({ ...formOf(morning), id: "other" })).not.toHaveProperty("id");
  });

  test("leaves out a text or a prompt that the person cleared", () => {
    expect(fieldsOf({ ...formOf(morning), text: " ", prompt: "Plan." })).toEqual({
      name: "Morning",
      at: "06:30",
      days: ["mon", "fri"],
      prompt: "Plan.",
    });
  });

  test("sends only the new repeat after a switch", () => {
    const form = {
      ...formOf(morning),
      repeat: "every" as const,
      count: "2",
      unit: "w" as const,
      from: "2026-10-26T06:30",
    };
    expect(fieldsOf(form)).toEqual({ name: "Morning", every: "2w", from: "2026-10-26T06:30", text: "Good morning." });
  });
});

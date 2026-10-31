import { describe, expect, test } from "bun:test";
import { mergeFormats, type FormatUser } from "../../../../src/core/widgets/data-formats.ts";

const habits: FormatUser = {
  widget: "example-owner/habits",
  name: "Habits",
  schema: {
    type: "object",
    required: ["name", "checks"],
    properties: {
      name: { type: "string", description: "The habit name." },
      kind: { enum: ["yesNo", "number"] },
      checks: {
        type: "array",
        items: {
          type: "object",
          required: ["date"],
          properties: { date: { type: "string", format: "date" }, value: { type: "number" } },
        },
      },
    },
  },
};

function user(widget: string, properties: Record<string, unknown>, required: string[] = []): FormatUser {
  return { widget, name: widget, schema: { type: "object", required, properties } };
}

describe("mergeFormats", () => {
  test("lists each field at every level, with its widget and whether it is required", () => {
    const { fields, conflicts } = mergeFormats([habits]);
    expect(conflicts).toEqual([]);
    expect(fields.map((field) => field.path)).toEqual([
      "name",
      "kind",
      "checks",
      "checks[]",
      "checks[].date",
      "checks[].value",
    ]);
    const name = fields.find((field) => field.path === "name");
    expect(name).toMatchObject({ types: ["string"], requiredBy: ["Habits"], usedBy: ["Habits"] });
    expect(name?.descriptions).toEqual([{ name: "Habits", text: "The habit name." }]);
    expect(fields.find((field) => field.path === "kind")).toMatchObject({
      values: ["yesNo", "number"],
      requiredBy: [],
    });
    expect(fields.find((field) => field.path === "checks[].date")).toMatchObject({
      format: "date",
      requiredBy: ["Habits"],
    });
  });

  test("adds up different fields, and merges the same field with the same type", () => {
    const first = user("a", { date: { type: "string", format: "date" }, location: { type: "object" } }, ["location"]);
    const second = user("b", { date: { type: "string" }, place: { type: "string" } }, ["place"]);
    const { fields, conflicts } = mergeFormats([first, second]);
    expect(conflicts).toEqual([]);
    expect(fields.map((field) => [field.path, field.usedBy, field.requiredBy])).toEqual([
      ["date", ["a", "b"], []],
      ["location", ["a"], ["a"]],
      ["place", ["b"], ["b"]],
    ]);
    // No field equivalence: `location` and `place` stay two fields.
    expect(fields.find((field) => field.path === "date")?.format).toBe("date");
  });

  test("finds a conflict for the same field with another type, at any level", () => {
    const first = user("a", { checks: { type: "array", items: { properties: { value: { type: "number" } } } } });
    const second = user("b", { checks: { type: "array", items: { properties: { value: { type: "string" } } } } });
    const { conflicts } = mergeFormats([first, second]);
    expect(conflicts).toEqual([
      { path: "checks[].value", first: "a", second: "b", reason: "number for a, and string for b" },
    ]);
  });

  test("finds a conflict for an object in one widget and a list in another", () => {
    const { conflicts } = mergeFormats([
      user("a", { tags: { type: "object" } }),
      user("b", { tags: { type: "array" } }),
    ]);
    expect(conflicts.map((conflict) => conflict.path)).toEqual(["tags"]);
  });

  test("finds a conflict for another format, and for other allowed values", () => {
    const { conflicts } = mergeFormats([
      user("a", { date: { type: "string", format: "date" }, kind: { enum: ["yesNo", "number"] } }),
      user("b", { date: { type: "string", format: "date-time" }, kind: { enum: ["yesNo"] } }),
    ]);
    expect(conflicts.map((conflict) => conflict.path)).toEqual(["date", "kind"]);
  });

  test("tells integer from number, and takes a list of types as a set", () => {
    expect(
      mergeFormats([user("a", { count: { type: "integer" } }), user("b", { count: { type: "number" } })]).conflicts,
    ).toHaveLength(1);
    expect(
      mergeFormats([
        user("a", { note: { type: ["string", "null"] } }),
        user("b", { note: { type: ["null", "string"] } }),
      ]).conflicts,
    ).toEqual([]);
  });

  test("a field with no type fits any type", () => {
    const { conflicts, fields } = mergeFormats([user("a", { value: {} }), user("b", { value: { type: "number" } })]);
    expect(conflicts).toEqual([]);
    expect(fields[0]?.types).toEqual(["number"]);
  });

  test("follows a local $ref and the parts of an allOf", () => {
    const schema = {
      type: "object",
      $defs: { check: { type: "object", properties: { date: { type: "string" } } } },
      allOf: [{ properties: { extra: { type: "boolean" } } }],
      properties: { checks: { type: "array", items: { $ref: "#/$defs/check" } } },
    };
    const paths = mergeFormats([{ widget: "a", name: "a", schema }]).fields.map((field) => field.path);
    expect(paths).toEqual(["checks", "checks[]", "checks[].date", "extra"]);
  });

  test("stops at a $ref that loops", () => {
    const schema = {
      type: "object",
      $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } } } },
      properties: { root: { $ref: "#/$defs/node" } },
    };
    const paths = mergeFormats([{ widget: "a", name: "a", schema }]).fields.map((field) => field.path);
    expect(paths.length).toBeLessThan(40);
    expect(paths[0]).toBe("root");
  });

  test("reads a broken schema as no fields", () => {
    expect(mergeFormats([{ widget: "a", name: "a", schema: null }]).fields).toEqual([]);
    expect(mergeFormats([{ widget: "a", name: "a", schema: { properties: [] } }]).fields).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { checkDataSchema, checkManifest, checkWidget } from "../../../../src/core/widgets/widget-contract.ts";

const manifest = {
  contract: 1,
  name: "Habits",
  size: "medium",
  inputs: [
    {
      id: "habits",
      type: "folder",
      label: "Habits folder",
      description: "One file for each habit.",
      why: "The widget shows and checks your habits.",
      required: true,
      access: "write",
      schema: "schemas/habits.json",
      files: "*.json",
    },
    {
      id: "place",
      type: "eva-location",
      label: "Location",
      description: "Your last location.",
      why: "The widget shows where you are.",
      required: false,
    },
  ],
  hosts: [{ url: "https://api.example.com", why: "The widget reads the weather." }],
};

function schema(properties: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
    ...extra,
  });
}

describe("checkManifest", () => {
  test("accepts a valid manifest", () => {
    const result = checkManifest(JSON.stringify(manifest));
    expect(result.problems).toEqual([]);
    expect(result.manifest?.inputs[0]?.id).toBe("habits");
  });

  test("refuses text that is not JSON", () => {
    expect(checkManifest("{").problems).toEqual(["eva-widget.json is not valid JSON."]);
  });

  test("refuses a contract that Eva does not know, and asks for an update", () => {
    const result = checkManifest(JSON.stringify({ ...manifest, contract: 2 }));
    expect(result.manifest).toBeNull();
    expect(result.problems).toEqual(["This widget follows contract 2. Update Eva to use this widget."]);
    expect(result.newerContract).toBe(true);
    expect(checkWidget(() => JSON.stringify({ ...manifest, contract: 2 })).newerContract).toBe(true);
  });

  test("a contract below 1 is a mistake of the manifest, not a newer widget", () => {
    const result = checkManifest(JSON.stringify({ ...manifest, contract: 0 }));
    expect(result.problems).toEqual(["eva-widget.json has the contract 0, which does not exist. Use 1."]);
    expect(result.newerContract).toBeUndefined();
  });

  test("refuses a manifest with no contract", () => {
    const { contract: _contract, ...rest } = manifest;
    expect(checkManifest(JSON.stringify(rest)).problems).toEqual(["eva-widget.json has no contract number."]);
  });

  test("names the key that fails", () => {
    const problems = checkManifest(JSON.stringify({ ...manifest, size: "huge", colour: "red" })).problems;
    expect(problems.some((problem) => problem.includes("/size"))).toBe(true);
    expect(problems.some((problem) => problem.includes("colour"))).toBe(true);
  });

  test("needs access for a folder, and a schema for a write", () => {
    const [folder] = manifest.inputs;
    const withoutSchema = { ...folder, schema: undefined };
    const problems = checkManifest(JSON.stringify({ ...manifest, inputs: [withoutSchema] })).problems;
    expect(problems.some((problem) => problem.includes("schema"))).toBe(true);
  });

  test("refuses a host that is not https", () => {
    const problems = checkManifest(
      JSON.stringify({ ...manifest, hosts: [{ url: "http://api.example.com", why: "x" }] }),
    ).problems;
    expect(problems.some((problem) => problem.includes("/hosts/0/url"))).toBe(true);
  });
});

describe("checkDataSchema", () => {
  test("accepts camelCase full words", () => {
    expect(
      checkDataSchema(
        "schemas/habits.json",
        schema({
          name: { type: "string" },
          durationMinutes: { type: "number" },
          location: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } },
          checks: {
            type: "array",
            items: { type: "object", properties: { date: { type: "string", format: "date" } } },
          },
        }),
      ),
    ).toEqual([]);
  });

  test("names an abbreviation", () => {
    expect(checkDataSchema("schemas/a.json", schema({ loc: { type: "string" } }))).toEqual([
      'schemas/a.json: the field name "loc" breaks the naming rules (camelCase, full English words, no abbreviation).',
    ]);
  });

  test("names a field that is not camelCase, at any depth", () => {
    const text = schema({
      checks: { type: "array", items: { type: "object", properties: { my_field: { type: "string" } } } },
    });
    expect(checkDataSchema("schemas/a.json", text)).toEqual([
      'schemas/a.json: the field name "my_field" breaks the naming rules (camelCase, full English words, no abbreviation).',
    ]);
  });

  test("names an abbreviation inside a camelCase name", () => {
    expect(checkDataSchema("schemas/a.json", schema({ maxTemp: { type: "number" } }))[0]).toContain('"maxTemp"');
    expect(checkDataSchema("schemas/a.json", schema({ maxTemperature: { type: "number" } }))).toEqual([]);
  });

  test("refuses a closed object at any level", () => {
    const text = schema(
      { note: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false } },
      {},
    );
    expect(checkDataSchema("schemas/a.json", text)).toEqual([
      "schemas/a.json: /properties/note closes the object (additionalProperties: false), so another widget cannot add its fields.",
    ]);
  });

  test("refuses a schema that is not an object schema of draft 2020-12", () => {
    const problems = checkDataSchema("schemas/a.json", JSON.stringify({ type: "array" }));
    expect(problems.length).toBeGreaterThan(0);
  });

  test("refuses text that is not JSON", () => {
    expect(checkDataSchema("schemas/a.json", "nope")).toEqual(["schemas/a.json is not valid JSON."]);
  });

  test("refuses a schema that a validator cannot compile", () => {
    const problems = checkDataSchema("schemas/a.json", schema({ name: { type: "text" } }));
    expect(problems[0]).toContain("schemas/a.json is not a valid JSON Schema");
  });
});

describe("checkWidget", () => {
  const habits = schema({ name: { type: "string" } });

  test("checks the manifest and each schema that it names", () => {
    const files: Record<string, string> = {
      "eva-widget.json": JSON.stringify(manifest),
      "schemas/habits.json": habits,
    };
    expect(checkWidget((path) => files[path] ?? null)).toEqual({ manifest: [], schemas: [] });
  });

  test("names a missing schema file", () => {
    const files: Record<string, string> = { "eva-widget.json": JSON.stringify(manifest) };
    expect(checkWidget((path) => files[path] ?? null).schemas).toEqual([
      "schemas/habits.json is missing. The input habits names it.",
    ]);
  });

  test("names a missing manifest", () => {
    expect(checkWidget(() => null)).toEqual({ manifest: ["eva-widget.json is missing."], schemas: [] });
  });

  test("names a schema field that fails", () => {
    const files: Record<string, string> = {
      "eva-widget.json": JSON.stringify(manifest),
      "schemas/habits.json": schema({ qty: { type: "number" } }),
    };
    expect(checkWidget((path) => files[path] ?? null).schemas[0]).toContain('"qty"');
  });
});

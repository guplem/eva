// The schema check of scripts/check-widget.js, on a copy of this widget with one change.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { checkWidget } from "../scripts/check-widget.js";

const widget = fileURLToPath(new URL("..", import.meta.url));
const copies = [];

after(async () => {
  await Promise.all(copies.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A copy of the widget files that the check reads, with `change` applied to the habits schema. */
async function copyWith(change) {
  const folder = await mkdtemp(join(tmpdir(), "widget-"));
  copies.push(folder);
  for (const path of ["eva-widget.json", "config.json", "schemas", "data"]) {
    await cp(join(widget, path), join(folder, path), { recursive: true });
  }
  const path = join(folder, "schemas", "habits.json");
  const schema = JSON.parse(await readFile(path, "utf8"));
  change(schema);
  await writeFile(path, JSON.stringify(schema));
  return folder;
}

test("the widget follows the contract", async () => {
  assert.deepEqual(await checkWidget(widget), []);
});

test("an abbreviation fails, with its name", async () => {
  const folder = await copyWith((schema) => {
    schema.properties.loc = { type: "string" };
  });
  assert.deepEqual(await checkWidget(folder), [
    'schemas/habits.json: the field name "loc" breaks the naming rules (camelCase, full English words, no abbreviation).',
  ]);
});

test("a name that is not camelCase fails, with its name", async () => {
  const folder = await copyWith((schema) => {
    schema.properties.my_field = { type: "string" };
  });
  const problems = await checkWidget(folder);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"my_field"/);
});

test("a closed object fails", async () => {
  const folder = await copyWith((schema) => {
    schema.additionalProperties = false;
  });
  assert.match((await checkWidget(folder))[0], /closes the object/);
});

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  architectureLayers,
  colourGroups,
  componentSamples,
} from "../../../../../src/frontends/web/client/design-reference.ts";

const webFolder = join(import.meta.dir, "../../../../../src/frontends/web");
const styles = readdirSync(webFolder)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(join(webFolder, name), "utf8"))
  .join("\n");

describe("the design reference", () => {
  test("every colour that it shows is a token of the stylesheet", () => {
    const tokens = colourGroups.flatMap((group) => group.tokens.map((token) => token.name));
    expect(tokens.length).toBeGreaterThan(10);
    for (const token of tokens) expect(styles, token).toContain(`${token}:`);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test("every class that it names is a rule of the stylesheet", () => {
    const classes = componentSamples.flatMap((sample) => sample.classes);
    expect(classes.length).toBeGreaterThan(10);
    for (const name of classes) expect(styles, name).toMatch(new RegExp(`\\.${name}(?![\\w-])`));
  });

  test("each layer of the map names a folder of the source", () => {
    const sourceFolder = join(webFolder, "../../..");
    for (const layer of architectureLayers) {
      expect(existsSync(join(sourceFolder, layer.path)), layer.path).toBe(true);
    }
  });
});

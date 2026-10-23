import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { iconNames } from "../../../../../src/frontends/web/client/icons.tsx";
import { visorClassName } from "../../../../../src/frontends/web/client/visor-faces.ts";
import {
  architectureLayers,
  colourGroups,
  componentSamples,
  iconUses,
  typeStyles,
  visorSizes,
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

  test("every text style that it shows is a token of the stylesheet", () => {
    const tokens = typeStyles.map((style) => style.name);
    for (const token of ["--font", "--mono", "--text-xs", "--text-xl"]) expect(tokens).toContain(token);
    for (const token of tokens) expect(styles, token).toContain(`${token}:`);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test("every link has one look: the stylesheet colours links once, with a token", () => {
    expect(styles).toMatch(/^a \{[^}]*color: var\(--accent-ink\);/m);
    expect(styles).not.toMatch(/\.access-address|\.answer-body a \{/);
  });

  test("every class that it names is a rule of the stylesheet", () => {
    const classes = componentSamples.flatMap((sample) => sample.classes);
    expect(classes.length).toBeGreaterThan(10);
    for (const name of classes) expect(styles, name).toMatch(new RegExp(`\\.${name}(?![\\w-])`));
  });

  test("it shows the standard waits: the progress bar, the button spinner and the skeletons", () => {
    const parts = componentSamples.map((sample) => sample.part);
    expect(parts).toContain("ProgressBar");
    expect(parts).toContain("ButtonSpinner");
    expect(parts.some((part) => part?.includes("Skeleton") === true)).toBe(true);
  });

  test("each icon has one use, so the page shows when to take it", () => {
    for (const name of iconNames) expect(iconUses[name], name).not.toBe("");
    expect(Object.keys(iconUses).sort()).toEqual([...iconNames].sort());
  });

  test("a visor size has the shell ring exactly when its rule draws one", () => {
    expect(visorSizes.map((entry) => entry.size)).toEqual([28, 36, 76, 128]);
    for (const entry of visorSizes) {
      const sizeClass = visorClassName("neutral", entry.size).split(" ")[1];
      const rule =
        sizeClass === undefined ? "" : (new RegExp(`^\\.mk\\.${sizeClass} \\{[^}]*\\}`, "m").exec(styles)?.[0] ?? "");
      expect(rule.includes("var(--shell)"), String(entry.size)).toBe(entry.shell);
    }
  });

  test("each layer of the map names a folder of the source", () => {
    const sourceFolder = join(webFolder, "../../..");
    for (const layer of architectureLayers) {
      expect(existsSync(join(sourceFolder, layer.path)), layer.path).toBe(true);
    }
  });
});

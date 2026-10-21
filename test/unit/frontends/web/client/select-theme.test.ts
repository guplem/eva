import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "../../../../../src/frontends/web/styles.css"), "utf8");

describe("the open list of a select", () => {
  test("the browser draws the list with the page's own styles", () => {
    expect(styles).toMatch(/select,\s*::picker\(select\)\s*\{[^}]*appearance: base-select;/);
  });

  test("the list takes the theme's panel and line colours", () => {
    const picker = [...styles.matchAll(/^\s*::picker\(select\) \{[^}]*\}/gm)].join("\n");
    expect(picker).toContain("var(--panel)");
    expect(picker).toContain("var(--line)");
  });

  test("the chosen option takes the theme's soft colour, not the system blue", () => {
    expect(styles).toMatch(/option:checked[^{]*\{[^}]*var\(--soft\)/);
  });
});

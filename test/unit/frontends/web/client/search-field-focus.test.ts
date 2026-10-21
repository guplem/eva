import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "../../../../../src/frontends/web/styles.css"), "utf8");

describe("the focus of the settings search field", () => {
  test("the pill shows the focus in the accent colour", () => {
    expect(styles).toMatch(/\.search-field:focus-within \{[^}]*outline: 2px solid var\(--accent\);/);
  });

  test("the input inside the pill draws no ring of its own", () => {
    expect(styles).toMatch(/\.search-field input:focus \{[^}]*outline: none;/);
  });
});

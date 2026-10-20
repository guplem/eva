import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "../../../../../src/frontends/web/styles.css"), "utf8");

describe("the tap feedback on a phone", () => {
  test("the browser draws no blue box on a tap", () => {
    const body = /^body \{[^}]*\}/m.exec(styles)?.[0] ?? "";
    expect(body).toContain("-webkit-tap-highlight-color: transparent;");
  });

  test("a pressed button shows its own feedback instead", () => {
    expect(styles).toMatch(/^button:active:not\(:disabled\)[^{]*\{[^}]*transform:/m);
  });
});

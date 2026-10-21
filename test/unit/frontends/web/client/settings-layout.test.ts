import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "../../../../../src/frontends/web/styles.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped} \\{[^}]*\\}`, "m").exec(styles)?.[0] ?? "";
}

describe("the settings layout on a wide screen", () => {
  test("the header and the page sit in the middle, as on the Schedules page", () => {
    expect(rule(".settings-header")).toContain("margin-inline: auto;");
    expect(rule(".settings-page")).toContain("margin-inline: auto;");
  });
});

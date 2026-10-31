import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "../../../../src/frontends/web");
const styles = readFileSync(join(web, "styles.css"), "utf8");
const firefoxQuery = "@supports not selector(::-webkit-scrollbar) {";

/** The text of the first block that starts with this prelude, up to its closing brace. */
function block(css: string, prelude: string): string {
  const start = css.indexOf(prelude);
  if (start === -1) return "";
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    const char = css.charAt(index);
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  return css.slice(start);
}

describe("the pearl scrollbar (issue 741)", () => {
  test("the thumb is a pill in the scrollbar tokens, with no arrow buttons", () => {
    expect(styles).toMatch(/::-webkit-scrollbar-button \{[^}]*display: none;/);
    expect(styles).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background: transparent;/);
    expect(styles).toMatch(/::-webkit-scrollbar-thumb \{[^}]*background-color: var\(--scrollbar-thumb\);/);
    expect(styles).toMatch(/::-webkit-scrollbar-thumb \{[^}]*border-radius: var\(--radius-pill\);/);
    expect(styles).toMatch(/::-webkit-scrollbar-thumb:hover \{[^}]*background-color: var\(--scrollbar-thumb-hover\);/);
    expect(styles).toMatch(/::-webkit-scrollbar-thumb:active \{[^}]*background-color: var\(--accent\);/);
  });

  test("only a mouse gets it, so a phone keeps its floating scrollbar", () => {
    const outside = styles.replace(
      block(styles, "@media (hover: hover) and (pointer: fine) {\n  ::-webkit-scrollbar {"),
      "",
    );
    expect(outside).not.toContain("::-webkit-scrollbar");
    expect(outside).not.toContain(firefoxQuery);
  });

  test("each theme defines the scrollbar tokens", () => {
    const light = block(styles, ":root {");
    const dark = block(block(styles, "@media (prefers-color-scheme: dark) {"), ':root:not([data-theme="light"]) {');
    const picked = block(styles, ':root[data-theme="dark"] {');
    for (const theme of [light, dark, picked]) {
      expect(theme).toContain("--scrollbar-thumb:");
      expect(theme).toContain("--scrollbar-thumb-hover:");
    }
  });

  test("Firefox gets the same colours", () => {
    const firefox = block(styles, firefoxQuery);
    expect(firefox).toContain("scrollbar-width: thin;");
    expect(firefox).toContain("scrollbar-color: var(--scrollbar-thumb) transparent;");
  });

  test("no style sheet sets a standard scrollbar property outside the Firefox query", () => {
    // Chromium 121 and later ignore every ::-webkit-scrollbar rule on a box with one of these properties.
    for (const file of readdirSync(web).filter((name) => name.endsWith(".css"))) {
      const css = readFileSync(join(web, file), "utf8").replace(block(styles, firefoxQuery), "");
      expect(css, file).not.toMatch(/scrollbar-(width|color)\s*:/);
    }
  });
});

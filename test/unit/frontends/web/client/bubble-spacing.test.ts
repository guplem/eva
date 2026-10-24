import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "../../../../../src/frontends/web");
const styles = readFileSync(join(web, "styles.css"), "utf8");
const conversation = readFileSync(join(web, "conversation.css"), "utf8");

function rules(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`^\\s*${escaped} \\{[^}]*\\}`, "gm"))].map((match) => match[0]);
}

/** The text of the phone media query, up to the next rule at the top level. */
function phoneRules(css: string): string {
  const start = css.indexOf("@media (max-width: 760px) {");
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

describe("the space inside a chat bubble (issue 477)", () => {
  test("both bubbles take their space from the bubble tokens", () => {
    const padding = "padding: var(--bubble-padding-block) var(--bubble-padding-inline);";
    expect(rules(conversation, ".message.answer")[0]).toContain(padding);
    expect(rules(conversation, ".message.user")[0]).toContain(padding);
  });

  test("compact density changes the space on every side, from the space scale", () => {
    const compact = rules(styles, ':root[data-density="compact"]').join("\n");
    expect(compact).toContain("--bubble-padding-block: var(--space-2);");
    expect(compact).toContain("--bubble-padding-inline: var(--space-4);");
    // A rule for only the top and the bottom left the sides wide.
    expect(styles).not.toMatch(/data-density="compact"\] \.message/);
  });

  test("the first icon of the action row lines up with the answer text", () => {
    expect(rules(conversation, "button.ghost")[0]).toContain("padding: 5px 12px;");
    expect(rules(conversation, ".answer-actions")[0]).toContain("margin-left: -12px;");
  });

  test("on a phone, the tall action buttons fill the bottom padding but stay inside the bubble", () => {
    expect(rules(phoneRules(conversation), ".answer-actions")[0]).toContain(
      "margin-bottom: calc(-1 * var(--bubble-padding-block));",
    );
  });
});

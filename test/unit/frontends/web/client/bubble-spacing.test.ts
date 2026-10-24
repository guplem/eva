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

describe("the space inside a chat bubble (issue 477)", () => {
  test("both bubbles take their space from one token", () => {
    expect(rules(conversation, ".message.answer")[0]).toContain("padding: var(--bubble-padding);");
    expect(rules(conversation, ".message.user")[0]).toContain("padding: var(--bubble-padding);");
  });

  test("compact density changes the space on every side, from the space scale", () => {
    const compact = rules(styles, ':root[data-density="compact"]').join("\n");
    expect(compact).toContain("--bubble-padding: var(--space-2) var(--space-4);");
    // A rule for only the top and the bottom left the sides wide.
    expect(styles).not.toMatch(/data-density="compact"\] \.message/);
  });

  test("the first icon of the action row lines up with the answer text", () => {
    expect(rules(conversation, ".answer-actions")[0]).toContain("margin-left: -12px;");
  });

  test("on a phone, the tall action buttons add no empty band under the answer", () => {
    expect(rules(conversation, ".answer-actions")[1]).toContain("margin-bottom: -12px;");
  });
});

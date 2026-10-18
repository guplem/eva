/** Cases ported from Wall-I v1 (`server/tests/test_telegram_format.py` at tag server-final, lesson 58). */
import { describe, expect, test } from "bun:test";
import {
  keepFencesWhole,
  splitForTelegram,
  toTelegramHtml,
} from "../../../../src/frontends/telegram/telegram-format.ts";

describe("toTelegramHtml", () => {
  test("plain text passes through, and the three reserved characters are escaped", () => {
    expect(toTelegramHtml("Just a sentence.")).toBe("Just a sentence.");
    expect(toTelegramHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });

  test("emphasis: bold, italic, strikethrough", () => {
    expect(toTelegramHtml("a **bold** word")).toBe("a <b>bold</b> word");
    expect(toTelegramHtml("an *italic* and _italic_ word")).toBe("an <i>italic</i> and <i>italic</i> word");
    expect(toTelegramHtml("~~old~~ new")).toBe("<s>old</s> new");
  });

  test("underscores inside words, dunder names and lone asterisks stay as they are", () => {
    expect(toTelegramHtml("snake_case_name here")).toBe("snake_case_name here");
    expect(toTelegramHtml("edit __init__.py")).toBe("edit __init__.py");
    expect(toTelegramHtml("2 * 3 = 6, and 4 * 5 = 20")).toBe("2 * 3 = 6, and 4 * 5 = 20");
  });

  test("inline code keeps its markers literal", () => {
    expect(toTelegramHtml("run `a_b *c*` now")).toBe("run <code>a_b *c*</code> now");
  });

  test("a web link becomes an anchor, with no italics in its address", () => {
    expect(toTelegramHtml("[the docs](https://example.com/a_b_c)")).toBe(
      '<a href="https://example.com/a_b_c">the docs</a>',
    );
    expect(toTelegramHtml("[x](javascript:alert)")).toBe("[x](javascript:alert)");
    expect(toTelegramHtml('[x](https://example.com/"onclick)')).toBe(
      '<a href="https://example.com/&quot;onclick">x</a>',
    );
  });

  test("quotes stay readable outside a link", () => {
    expect(toTelegramHtml('the "README"\'s rule')).toBe('the "README"\'s rule');
  });

  test("block elements: heading, bullets, quote, rule", () => {
    expect(toTelegramHtml("## Next steps\ntext")).toBe("<b>Next steps</b>\ntext");
    expect(toTelegramHtml("- one\n* two\n  - nested")).toBe("• one\n• two\n  • nested");
    expect(toTelegramHtml("> first\n> second")).toBe("<blockquote>first\nsecond</blockquote>");
    expect(toTelegramHtml("above\n---\nbelow")).toBe("above\n──────\nbelow");
  });

  test("fenced blocks become pre, with their language, and an open fence runs to the end", () => {
    expect(toTelegramHtml("```ts\nconst a = 1 < 2;\n```")).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
    expect(toTelegramHtml("```\n_x_\n```")).toBe("<pre>_x_</pre>");
    expect(toTelegramHtml("```\nline")).toBe("<pre>line</pre>");
  });

  test("a longer fence shows a shorter fence inside it as code (issue #37)", () => {
    expect(toTelegramHtml("````md\n```js\nx\n```\n````\nafter")).toBe(
      '<pre><code class="language-md">```js\nx\n```</code></pre>\nafter',
    );
  });

  test("only a bare fence of the same character, at least as long, closes a block", () => {
    expect(toTelegramHtml("```\n```js\n~~~\n```")).toBe("<pre>```js\n~~~</pre>");
    expect(toTelegramHtml("```\na\n`````\nafter")).toBe("<pre>a</pre>\nafter");
  });

  test("a table becomes aligned columns in pre; a pipe line alone is no table", () => {
    expect(toTelegramHtml("| Name | Age |\n|---|---|\n| **Ann** | 30 |")).toBe(
      "<pre>Name  Age\n----  ---\nAnn   30</pre>",
    );
    expect(toTelegramHtml("| just a line |")).toBe("| just a line |");
  });
});

describe("keepFencesWhole", () => {
  test("chunks with no fence are unchanged", () => {
    expect(keepFencesWhole(["a", "b"])).toEqual(["a", "b"]);
  });

  test("a block cut in two is closed and reopened", () => {
    expect(keepFencesWhole(["text\n```ts\nline 1", "line 2\n```\nafter"])).toEqual([
      "text\n```ts\nline 1\n```",
      "```ts\nline 2\n```\nafter",
    ]);
  });

  test("a block that spans three chunks is reopened in each", () => {
    expect(keepFencesWhole(["```\na", "b", "c\n```"])).toEqual(["```\na\n```", "```\nb\n```", "```\nc\n```"]);
  });

  test("a reopened block keeps its fence length, so a shorter inner fence stays code", () => {
    expect(keepFencesWhole(["````md\n```js\nx", "```\n````\nafter"])).toEqual([
      "````md\n```js\nx\n````",
      "````md\n```\n````\nafter",
    ]);
  });
});

describe("splitForTelegram", () => {
  test("a short message is one chunk", () => {
    expect(splitForTelegram("hello", 4000)).toEqual(["hello"]);
  });

  test("a long message splits at line ends, and each chunk stays under the limit", () => {
    const text = Array.from({ length: 50 }, (_, index) => `line ${String(index)} ${"x".repeat(80)}`).join("\n");
    const chunks = splitForTelegram(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
    expect(chunks.join("\n")).toBe(text);
  });

  test("a single line longer than the limit is cut hard", () => {
    const chunks = splitForTelegram("y".repeat(2500), 1000);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 500]);
  });
});

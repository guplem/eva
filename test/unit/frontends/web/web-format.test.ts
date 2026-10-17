import { describe, expect, test } from "bun:test";
import { toWebHtml } from "../../../../src/frontends/web/client/web-format.ts";

describe("toWebHtml", () => {
  test("a single line break shows as a line break, and a blank line starts a new paragraph", () => {
    expect(toWebHtml("first line\nsecond line\n\nnew paragraph")).toBe(
      "<p>first line<br>second line</p><p>new paragraph</p>",
    );
  });

  test("Windows line ends and extra blank lines change nothing", () => {
    expect(toWebHtml("\r\none\r\n\r\n\r\ntwo\r\n")).toBe("<p>one</p><p>two</p>");
    expect(toWebHtml("")).toBe("");
  });

  test("a Markdown hard break gives one line break, not two", () => {
    expect(toWebHtml("one  \ntwo\\\nthree")).toBe("<p>one<br>two<br>three</p>");
  });

  test("text is escaped and inline Markdown becomes HTML", () => {
    expect(toWebHtml("<b>x</b> & **bold** `a<b`")).toBe(
      "<p>&lt;b&gt;x&lt;/b&gt; &amp; <b>bold</b> <code>a&lt;b</code></p>",
    );
  });

  test("headings keep their level", () => {
    expect(toWebHtml("# Title\n## Next *steps* ##\ntext")).toBe("<h1>Title</h1><h2>Next <i>steps</i></h2><p>text</p>");
  });

  test("a bullet list is a real list, also right after a paragraph", () => {
    expect(toWebHtml("Steps:\n- one\n* two\n+ **three**")).toBe(
      "<p>Steps:</p><ul><li>one</li><li>two</li><li><b>three</b></li></ul>",
    );
  });

  test("a numbered list keeps its first number", () => {
    expect(toWebHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(toWebHtml("3) three\n4) four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });

  test("an indented list nests inside the item above it", () => {
    expect(toWebHtml("1. one\n   - a\n   - b\n2. two")).toBe(
      "<ol><li>one<ul><li>a</li><li>b</li></ul></li><li>two</li></ol>",
    );
    expect(toWebHtml("- one\n  - a\n    - deep\n- two")).toBe(
      "<ul><li>one<ul><li>a<ul><li>deep</li></ul></li></ul></li><li>two</li></ul>",
    );
  });

  test("an indented line continues the item, and a lazy line too", () => {
    expect(toWebHtml("- one\n  more\n- two\nlazy")).toBe("<ul><li>one<br>more</li><li>two<br>lazy</li></ul>");
  });

  test("blank lines between items keep one list, with a paragraph in each item", () => {
    expect(toWebHtml("1. one\n\n2. two\n\n   more")).toBe("<ol><li><p>one</p></li><li><p>two</p><p>more</p></li></ol>");
  });

  test("a list of another kind, or a blank line before text, ends the list", () => {
    expect(toWebHtml("- one\n1. two")).toBe("<ul><li>one</li></ul><ol><li>two</li></ol>");
    expect(toWebHtml("- one\n\nafter")).toBe("<ul><li>one</li></ul><p>after</p>");
  });

  test("a code block keeps its lines, escaped, with no Markdown inside", () => {
    expect(toWebHtml("before\n```ts\nconst a = 1 < 2;\n\n**x**\n```\nafter")).toBe(
      '<p>before</p><pre><code class="language-ts">const a = 1 &lt; 2;\n\n**x**</code></pre><p>after</p>',
    );
  });

  test("a code block that is still streaming runs to the end", () => {
    expect(toWebHtml("```\nline")).toBe("<pre><code>line</code></pre>");
  });

  test("a code block inside a list item stays in the item", () => {
    expect(toWebHtml("- run:\n  ```\n  bun test\n  ```\n- done")).toBe(
      "<ul><li>run:<pre><code>bun test</code></pre></li><li>done</li></ul>",
    );
  });

  test("a table becomes an HTML table with inline Markdown in the cells", () => {
    expect(toWebHtml("| Name | Age |\n|---|---:|\n| **Ann** | 30 |\n| Bo |")).toBe(
      "<table><thead><tr><th>Name</th><th>Age</th></tr></thead>" +
        "<tbody><tr><td><b>Ann</b></td><td>30</td></tr><tr><td>Bo</td><td></td></tr></tbody></table>",
    );
    expect(toWebHtml("| just a line |")).toBe("<p>| just a line |</p>");
  });

  test("a quote can hold any block", () => {
    expect(toWebHtml("> first\n> second\n>\n> - item")).toBe(
      "<blockquote><p>first<br>second</p><ul><li>item</li></ul></blockquote>",
    );
  });

  test("a rule is a horizontal line", () => {
    expect(toWebHtml("above\n\n---\nbelow\n* * *")).toBe("<p>above</p><hr><p>below</p><hr>");
  });

  test("a link keeps only http and https", () => {
    expect(toWebHtml("[docs](https://example.com) [x](javascript:alert)")).toBe(
      '<p><a href="https://example.com">docs</a> [x](javascript:alert)</p>',
    );
  });
});

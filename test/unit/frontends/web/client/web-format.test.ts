import { describe, expect, test } from "bun:test";
import { nestedWebHtml, toWebHtml } from "../../../../../src/frontends/web/client/web-format.ts";

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

  test("a link keeps only http and https, and opens in a new tab so the chat stays open", () => {
    expect(toWebHtml("[docs](https://example.com) [x](javascript:alert)")).toBe(
      '<p><a target="_blank" rel="noreferrer" href="https://example.com">docs</a> [x](javascript:alert)</p>',
    );
  });

  test("a bare URL in a list item or a table cell is a link too", () => {
    expect(toWebHtml("- https://example.com/a\n\n| Site |\n| --- |\n| https://example.com/b |")).toBe(
      '<ul><li><a target="_blank" rel="noreferrer" href="https://example.com/a">https://example.com/a</a></li></ul>' +
        '<table><thead><tr><th>Site</th></tr></thead><tbody><tr><td><a target="_blank" rel="noreferrer" href="https://example.com/b">https://example.com/b</a></td></tr></tbody></table>',
    );
  });

  test("a longer fence holds a shorter one, and only a bare fence closes it", () => {
    expect(toWebHtml("````md\n```js\nx\n```\n````\nafter")).toBe(
      '<pre><code class="language-md">```js\nx\n```</code></pre><p>after</p>',
    );
    expect(toWebHtml("```\n```js\n```")).toBe("<pre><code>```js</code></pre>");
  });

  test("only a list that starts at 1 breaks a paragraph, so a number in the text stays text", () => {
    expect(toWebHtml("It costs\n100. Then more")).toBe("<p>It costs<br>100. Then more</p>");
    expect(toWebHtml("Steps:\n1. one")).toBe("<p>Steps:</p><ol><li>one</li></ol>");
    expect(toWebHtml("- one\n2024. was good")).toBe("<ul><li>one<br>2024. was good</li></ul>");
  });

  test("a table cell keeps an escaped pipe and a pipe in code", () => {
    expect(toWebHtml("| a \\| b | `x|y` |\n|---|---|")).toBe(
      "<table><thead><tr><th>a | b</th><th><code>x|y</code></th></tr></thead><tbody></tbody></table>",
    );
  });

  test("a blank line inside a nested list or a code block keeps the outer list tight", () => {
    expect(toWebHtml("- a\n  - b\n\n  - c\n- d")).toBe(
      "<ul><li>a<ul><li><p>b</p></li><li><p>c</p></li></ul></li><li>d</li></ul>",
    );
    expect(toWebHtml("- run:\n  ```\n  a\n\n  b\n  ```\n- next")).toBe(
      "<ul><li>run:<pre><code>a\n\nb</code></pre></li><li>next</li></ul>",
    );
  });

  test("a tab in a code block stays a tab, and a tab indent still nests a list", () => {
    expect(toWebHtml("```make\nall:\n\tbun test\n```")).toBe(
      '<pre><code class="language-make">all:\n\tbun test</code></pre>',
    );
    expect(toWebHtml("- a\n\t- b")).toBe("<ul><li>a<ul><li>b</li></ul></li></ul>");
  });

  test("a paragraph indented deeper than the item's text still makes its own paragraph", () => {
    expect(toWebHtml("1. Step one\n\n    More detail.\n2. Step two")).toBe(
      "<ol><li><p>Step one</p><p>More detail.</p></li><li><p>Step two</p></li></ol>",
    );
  });

  test("triple backticks with code on one line are inline code, not a fence", () => {
    expect(toWebHtml("```npm install``` first\nmore text")).toBe("<p><code>npm install</code> first<br>more text</p>");
  });

  test("a fence that opens on a list item keeps the tabs in its code", () => {
    expect(toWebHtml("- ```make\n  all:\n  \tbun test\n  ```")).toBe(
      '<ul><li><pre><code class="language-make">all:\n\tbun test</code></pre></li></ul>',
    );
  });
});

describe("nestedWebHtml", () => {
  test("moves each heading down, stops at h6, and leaves an escaped tag in the text alone", () => {
    expect(nestedWebHtml("# Title\n\n## Part\n\n###### Deep", 2)).toBe("<h3>Title</h3><h4>Part</h4><h6>Deep</h6>");
    expect(nestedWebHtml("A <h1> tag", 2)).toBe(toWebHtml("A <h1> tag"));
  });
});

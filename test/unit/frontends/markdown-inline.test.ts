import { describe, expect, test } from "bun:test";
import { escapeHtml, inlineHtml } from "../../../src/frontends/markdown-inline.ts";

describe("inlineHtml", () => {
  test("escapes raw HTML in the text, so a reply cannot inject a tag", () => {
    expect(inlineHtml("<script>alert(1)</script> & **bold**")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; <b>bold</b>",
    );
  });

  test("keeps code spans and links whole while emphasis runs", () => {
    expect(inlineHtml("see `**a**` and [**b**](https://example.com/x_y_z)")).toBe(
      'see <code>**a**</code> and <a href="https://example.com/x_y_z">**b**</a>',
    );
  });

  test("a link keeps one level of parentheses in its URL, and stops at the closing one", () => {
    expect(inlineHtml("[Foo](https://example.com/wiki/Foo_(bar)) and (more)")).toBe(
      '<a href="https://example.com/wiki/Foo_(bar)">Foo</a> and (more)',
    );
    expect(inlineHtml("(see [Foo](https://example.com/a))")).toBe('(see <a href="https://example.com/a">Foo</a>)');
  });

  test("a bare URL becomes a link, so a person can tap it", () => {
    expect(inlineHtml("The repository is at https://github.com/example/example-app")).toBe(
      'The repository is at <a href="https://github.com/example/example-app">https://github.com/example/example-app</a>',
    );
  });

  test("a bare URL leaves the punctuation that ends a sentence outside the link", () => {
    expect(inlineHtml("Open https://example.com/a.")).toBe(
      'Open <a href="https://example.com/a">https://example.com/a</a>.',
    );
    expect(inlineHtml("(see https://example.com/a), then go")).toBe(
      '(see <a href="https://example.com/a">https://example.com/a</a>), then go',
    );
    expect(inlineHtml("https://example.com/wiki/Foo_(bar)!")).toBe(
      '<a href="https://example.com/wiki/Foo_(bar)">https://example.com/wiki/Foo_(bar)</a>!',
    );
  });

  test("a bare URL keeps its underscores and query, and emphasis around it still works", () => {
    expect(inlineHtml("**https://example.com/a_b_c?x=1&y=2** and _https://example.com/d_e_")).toBe(
      '<b><a href="https://example.com/a_b_c?x=1&amp;y=2">https://example.com/a_b_c?x=1&amp;y=2</a></b> and <i><a href="https://example.com/d_e">https://example.com/d_e</a></i>',
    );
  });

  test("an autolink in angle brackets becomes a link, and a URL in code stays code", () => {
    expect(inlineHtml("<https://example.com/a> and `https://example.com/b`")).toBe(
      '<a href="https://example.com/a">https://example.com/a</a> and <code>https://example.com/b</code>',
    );
  });

  test("a Markdown link whose label is a URL stays one link", () => {
    expect(inlineHtml("[https://example.com/a](https://example.com/b)")).toBe(
      '<a href="https://example.com/b">https://example.com/a</a>',
    );
  });

  test("a bare URL leaves a closing bracket and non-ASCII punctuation outside the link", () => {
    expect(inlineHtml("[https://example.com/a] and «https://example.com/b»…")).toBe(
      '[<a href="https://example.com/a">https://example.com/a</a>] and «<a href="https://example.com/b">https://example.com/b</a>»…',
    );
    expect(inlineHtml("（https://example.com/a）。")).toBe(
      '（<a href="https://example.com/a">https://example.com/a</a>）。',
    );
    expect(inlineHtml("https://example.com/a[1]")).toBe(
      '<a href="https://example.com/a[1]">https://example.com/a[1]</a>',
    );
  });

  test("a bare URL with a long tail of punctuation does not stall the page", () => {
    const tail = ".)".repeat(30_000);
    expect(inlineHtml(`https://example.com/a${tail}`)).toBe(
      `<a href="https://example.com/a">https://example.com/a</a>${tail}`,
    );
  });

  test("a bare URL needs the http or https scheme and a host", () => {
    expect(inlineHtml("javascript:alert(1), https:// alone, https://. and xhttps://example.com")).toBe(
      "javascript:alert(1), https:// alone, https://. and xhttps://example.com",
    );
  });
});

describe("escapeHtml", () => {
  test("escapes the three reserved characters", () => {
    expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });
});

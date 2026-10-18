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
});

describe("escapeHtml", () => {
  test("escapes the three reserved characters", () => {
    expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });
});

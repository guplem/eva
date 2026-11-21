import { describe, expect, test } from "bun:test";
import { plainDescription } from "../../../../src/core/google/calendar-text.ts";

describe("plainDescription", () => {
  test("keeps a plain text as it is, with its line breaks", () => {
    expect(plainDescription("Bring the notes.\nAsk about a < b.")).toBe("Bring the notes.\nAsk about a < b.");
    expect(plainDescription("Line one\r\nLine two")).toBe("Line one\nLine two");
  });

  test("turns Google's HTML into plain text", () => {
    expect(plainDescription("Daily sync.<br>Bring <b>notes</b> &amp; questions.")).toBe(
      "Daily sync.\nBring notes & questions.",
    );
    expect(plainDescription("<p>First</p><p>Second&nbsp;part</p>")).toBe("First\nSecond part");
    expect(plainDescription("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
    expect(plainDescription('See <a href="https://example.com/doc">the doc</a>.')).toBe("See the doc.");
    expect(plainDescription("A &lt;b&gt; tag &#39;quoted&#39; &#x263A; &quot;here&quot;")).toBe(
      "A <b> tag 'quoted' ☺ \"here\"",
    );
  });

  test("never keeps a script or a style, even with a broken tag", () => {
    expect(plainDescription("Hi<script>alert(1)</script> there<style>p{}</style>")).toBe("Hi there");
    expect(plainDescription("Hi <img src=x onerror=alert(1)>")).toBe("Hi");
    // An entity never becomes a tag that runs: the result is text for textContent.
    expect(plainDescription("&lt;script&gt;")).toBe("<script>");
  });

  test("gives null for no text, and folds many empty lines into one", () => {
    expect(plainDescription(undefined)).toBeNull();
    expect(plainDescription(5)).toBeNull();
    expect(plainDescription("  <br> ")).toBeNull();
    expect(plainDescription("One<br><br><br><br>Two")).toBe("One\n\nTwo");
  });
});

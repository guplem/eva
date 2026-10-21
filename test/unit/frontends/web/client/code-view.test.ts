import { describe, expect, test } from "bun:test";
import {
  codeTokens,
  maxColouredLength,
  prettyJson,
  viewOf,
} from "../../../../../src/frontends/web/client/code-view.ts";

describe("viewOf: how the Files page shows a file (issue 308)", () => {
  test("each format gets its own view, and an unknown one shows as plain text", () => {
    expect(viewOf("Methods/Plan.md")).toBe("markdown");
    expect(viewOf("README.MARKDOWN")).toBe("markdown");
    expect(viewOf("md")).toBe("plain");
    expect(viewOf("data/list.JSON")).toBe("json");
    expect(viewOf("main.py")).toBe("code");
    expect(viewOf("page.html")).toBe("code");
    expect(viewOf("notes.txt")).toBe("plain");
    expect(viewOf("Makefile")).toBe("plain");
  });
});

describe("prettyJson", () => {
  test("JSON gets two spaces of indent", () => {
    expect(prettyJson('{"a":[1,2],"b":{"c":null}}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}',
    );
  });

  test("the indent keeps each value and key as written, so the view never changes the data", () => {
    expect(prettyJson('{"2":12345678901234567890,"1":1.50,"1":"a, b: [c]"}')).toBe(
      '{\n  "2": 12345678901234567890,\n  "1": 1.50,\n  "1": "a, b: [c]"\n}',
    );
  });

  test("an empty object or list stays on one line, and an escaped quote stays in its string", () => {
    expect(prettyJson('{ "a" : { }, "b": [ ], "c": "say \\"hi\\"" }')).toBe(
      '{\n  "a": {},\n  "b": [],\n  "c": "say \\"hi\\""\n}',
    );
  });

  test("a broken file stays as it is, so the person sees the real text", () => {
    expect(prettyJson('{"a":')).toBeNull();
  });
});

describe("codeTokens", () => {
  const kinds = (path: string, text: string): string[] =>
    codeTokens(path, text)
      .filter((token) => token.kind !== "plain")
      .map((token) => `${token.kind}:${token.text}`);

  test("the tokens hold the whole text, in order", () => {
    const text = 'const name = "Eva"; // the name\nreturn 42;\n';
    expect(
      codeTokens("main.ts", text)
        .map((token) => token.text)
        .join(""),
    ).toBe(text);
  });

  test("TypeScript marks keywords, strings, numbers and comments", () => {
    expect(kinds("main.ts", 'const name = "Eva"; // the name\nreturn 42; /* end */')).toEqual([
      "keyword:const",
      'string:"Eva"',
      "comment:// the name",
      "keyword:return",
      "number:42",
      "comment:/* end */",
    ]);
  });

  test("a word inside a string or a comment is not a keyword", () => {
    expect(kinds("main.py", "# if not\nprint('for you')")).toEqual(["comment:# if not", "string:'for you'"]);
  });

  test("Python keeps a triple-quoted string over many lines", () => {
    expect(kinds("main.py", 'def f():\n    """One\n    two"""')).toEqual(["keyword:def", 'string:"""One\n    two"""']);
  });

  test("HTML marks its tags, its attribute values and its comments", () => {
    expect(kinds("page.html", '<!-- top --><p class="x">if</p>')).toEqual([
      "comment:<!-- top -->",
      "tag:<p",
      'string:"x"',
      "tag:>",
      "tag:</p",
      "tag:>",
    ]);
  });

  test("JSON marks keys apart from string values", () => {
    expect(kinds("a.json", '{"on": true, "name": "Eva"}')).toEqual([
      'key:"on"',
      "keyword:true",
      'key:"name"',
      'string:"Eva"',
    ]);
  });

  test("a large file stays plain, so the page stays fast", () => {
    const text = "x".repeat(maxColouredLength + 1);
    expect(codeTokens("main.ts", text)).toEqual([{ kind: "plain", text }]);
  });

  test("a Rust lifetime and an apostrophe in HTML text start no string", () => {
    expect(kinds("main.rs", "fn f<'a>(x: &'a str) {}")).toEqual(["keyword:fn"]);
    expect(kinds("page.html", "<p>don't</p>")).toEqual(["tag:<p", "tag:>", "tag:</p", "tag:>"]);
  });

  test("an unclosed string ends at its line, so one quote does not colour the whole file", () => {
    expect(kinds("main.js", 'let a = "open\nlet b = 1')).toEqual([
      "keyword:let",
      'string:"open',
      "keyword:let",
      "number:1",
    ]);
  });
});

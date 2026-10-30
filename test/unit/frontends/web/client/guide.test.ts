import { describe, expect, test } from "bun:test";
import {
  guideHeadingId,
  guideItem,
  guidePageOf,
  guidePages,
  headingSlug,
  parseGuideItem,
  renderGuide,
  renderedGuide,
  searchGuide,
  type GuideSource,
} from "../../../../../src/frontends/web/client/guide.ts";

const repository = "https://github.com/guplem/eva/blob/main";

function source(markdown: string, path = "docs/guide/setup.md"): GuideSource {
  return { id: "setup", title: "Install Eva", summary: "", path, markdown };
}

describe("headingSlug", () => {
  test("follows GitHub: lower case, no punctuation, a dash for each space", () => {
    expect(headingSlug("Vault sync")).toBe("vault-sync");
    expect(headingSlug("1. Run the install command")).toBe("1-run-the-install-command");
    expect(headingSlug("Connect Telegram (optional)")).toBe("connect-telegram-optional");
    expect(headingSlug("Eva's rules: a_b")).toBe("evas-rules-a_b");
  });
});

describe("renderGuide", () => {
  test("leaves out the title, which the page header shows", () => {
    expect(renderGuide(source("# Install Eva\n\nSome text.")).html).toBe("<p>Some text.</p>");
  });

  test("leaves out raw HTML, which would show as text", () => {
    const html = renderGuide(source('# T\n\n<p align="center"><img src="x.svg"></p>\n\nText.')).html;
    expect(html).toBe("<p>Text.</p>");
  });

  test("keeps a line of HTML inside a code block", () => {
    expect(renderGuide(source("```html\n<p>x</p>\n```")).html).toContain("&lt;p&gt;x&lt;/p&gt;");
  });

  test("gives each heading the GitHub id, with a number when a heading repeats", () => {
    const html = renderGuide(source("## Before you start\n\n## Notes\n\n### Notes")).html;
    expect(html).toBe(
      `<h2 id="${guideHeadingId("before-you-start")}">Before you start</h2>` +
        `<h2 id="${guideHeadingId("notes")}">Notes</h2>` +
        `<h3 id="${guideHeadingId("notes-1")}">Notes</h3>`,
    );
  });

  test("builds the id from the heading's text, without its Markdown", () => {
    expect(renderGuide(source("## Set up `eva` **now**")).html).toContain(`id="${guideHeadingId("set-up-eva-now")}"`);
  });

  test("a link to a heading of the same doc stays in the app", () => {
    expect(renderGuide(source("See [Updates](#updates).")).html).toBe(
      '<p>See <a href="#/settings/guide/setup/updates">Updates</a>.</p>',
    );
  });

  test("a link to another doc of the guide opens it in the app", () => {
    const html = renderGuide(source("[A](reference.md#chats) and [B](../../README.md).")).html;
    expect(html).toContain('<a href="#/settings/guide/reference/chats">A</a>');
    expect(html).toContain('<a href="#/settings/guide/overview">B</a>');
  });

  test("a link from the README into the guide folder opens the guide page", () => {
    const html = renderGuide(source("[Setup](docs/guide/setup.md#remove-eva)", "README.md")).html;
    expect(html).toContain('<a href="#/settings/guide/setup/remove-eva">Setup</a>');
  });

  test("a link to another file of the repository opens it on GitHub in a new tab", () => {
    expect(renderGuide(source("Read [install.sh](../../install/install.sh).")).html).toBe(
      `<p>Read <a target="_blank" rel="noreferrer" href="${repository}/install/install.sh">install.sh</a>.</p>`,
    );
  });

  test("an outside link stays as it is", () => {
    expect(renderGuide(source("[Rufus](https://rufus.ie)")).html).toBe(
      '<p><a target="_blank" rel="noreferrer" href="https://rufus.ie">Rufus</a></p>',
    );
  });

  test("a link in a code block stays as code", () => {
    expect(renderGuide(source("```\n[x](#y)\n```")).html).toContain("[x](#y)");
  });

  test("cuts the doc into sections at each heading, with plain text", () => {
    const { sections } = renderGuide(
      source("# Install Eva\n\nIntro *text*.\n\n## First\n\n- one\n- two\n\n### Deep\n\nA & B"),
    );
    expect(sections).toEqual([
      { page: "setup", slug: null, title: "Install Eva", level: 1, text: "Intro text." },
      { page: "setup", slug: "first", title: "First", level: 2, text: "one two" },
      { page: "setup", slug: "deep", title: "Deep", level: 3, text: "A & B" },
    ]);
  });
});

describe("the guide pages", () => {
  test("hold the docs for people, and only those", () => {
    expect(guidePages.map((page) => page.path)).toEqual([
      "README.md",
      "docs/guide/setup.md",
      "docs/guide/reference.md",
    ]);
  });

  test("every link between the docs points to a heading that exists", () => {
    const ids = new Set(
      guidePages.flatMap((page) => renderedGuide(page.id).sections.map((each) => guideItem(page.id, each.slug))),
    );
    for (const page of guidePages) {
      const links = [...renderedGuide(page.id).html.matchAll(/href="#\/settings\/guide\/([^"]+)"/g)];
      for (const [, item] of links) expect(ids, `${page.path} links to ${String(item)}`).toContain(item ?? "");
    }
  });

  test("no doc shows a relative link as raw Markdown", () => {
    for (const page of guidePages) expect(renderedGuide(page.id).html).not.toMatch(/\]\((?!https?:)[^)]*\)/);
  });

  test("a page's address names the doc, and a heading after it", () => {
    expect(guideItem("reference", "vault-sync")).toBe("reference/vault-sync");
    expect(guideItem("setup", null)).toBe("setup");
    expect(parseGuideItem("reference/vault-sync")).toEqual({ page: "reference", slug: "vault-sync" });
    expect(parseGuideItem("setup")).toEqual({ page: "setup", slug: null });
    expect(parseGuideItem("unknown/x")).toBeNull();
    expect(guidePageOf("reference")?.path).toBe("docs/guide/reference.md");
    expect(guidePageOf("nope")).toBeUndefined();
  });
});

describe("searchGuide", () => {
  test("an empty query finds nothing", () => {
    expect(searchGuide("  ")).toEqual([]);
  });

  test("finds a section by the words of its text, in any case and order", () => {
    const found = searchGuide("CONFLICT vault");
    expect(found.map((each) => each.slug)).toContain("vault-conflicts");
  });

  test("puts a section whose title matches first", () => {
    expect(searchGuide("vault conflicts")[0]?.slug).toBe("vault-conflicts");
  });

  test("ignores accents, so a word typed with or without them matches", () => {
    expect(searchGuide("TAILSCÁLE").length).toBeGreaterThan(0);
  });

  test("shows a short piece of text with each typed word marked", () => {
    const [first] = searchGuide("hub");
    const marked = first?.snippet.filter((part) => part.marked).map((part) => part.text.toLowerCase());
    expect(marked?.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set(["hub"]));
    expect(first?.snippet.map((part) => part.text).join("").length).toBeLessThanOrEqual(200);
  });

  test("names the doc of each result", () => {
    const [first] = searchGuide("vault conflicts");
    expect(first?.pageTitle).toBe(guidePageOf("reference")?.title);
  });

  test("finds nothing for a word that no doc holds", () => {
    expect(searchGuide("banana")).toEqual([]);
  });
});

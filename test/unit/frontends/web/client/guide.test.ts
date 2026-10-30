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

  test("reads a file with Windows line ends", () => {
    expect(renderGuide(source("# T\r\n\r\n## A\r\n\r\ntext")).html).toBe(
      `<h2 id="${guideHeadingId("a")}">A</h2><p>text</p>`,
    );
  });

  test("leaves out raw HTML, which would show as text", () => {
    const html = renderGuide(source('# T\n\n<p align="center"><img src="x.svg"></p>\n\nText.')).html;
    expect(html).toBe("<p>Text.</p>");
  });

  test("keeps a line of text that starts with a placeholder in angle brackets", () => {
    expect(renderGuide(source("<code> is the code that the page shows.")).html).toContain("&lt;code&gt; is the code");
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

  test("gives a repeated slug the next free number, as GitHub does", () => {
    const html = renderGuide(source("## A\n\n### A\n\n## A-1")).html;
    expect([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      guideHeadingId("a"),
      guideHeadingId("a-1"),
      guideHeadingId("a-1-1"),
    ]);
  });

  test("counts the title, as GitHub does, so a heading with the same text gets a number", () => {
    expect(renderGuide(source("# Eva\n\n## Eva")).html).toBe(`<h2 id="${guideHeadingId("eva-1")}">Eva</h2>`);
  });

  test("builds the id from the heading's text, without its Markdown", () => {
    expect(renderGuide(source("## Set up `eva` **now**")).html).toContain(`id="${guideHeadingId("set-up-eva-now")}"`);
    expect(renderGuide(source("## Keep the `.env` file")).html).toContain(
      `id="${guideHeadingId("keep-the-env-file")}"`,
    );
    expect(renderGuide(source("## **Bold**ness")).html).toContain(`id="${guideHeadingId("boldness")}"`);
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

  test("a link to a heading with an accent keeps the heading's id", () => {
    expect(renderGuide(source("[w](reference.md#caf%C3%A9) [x](#100%)")).html).toBe(
      '<p><a href="#/settings/guide/reference/caf%C3%A9">w</a> <a href="#/settings/guide/setup/100%25">x</a></p>',
    );
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

  test("a link in a code block or a code span stays as code", () => {
    expect(renderGuide(source("```\n[x](#y)\n```")).html).toContain("[x](#y)");
    expect(renderGuide(source("Type `[y](setup.md)` and [z](#z).")).html).toBe(
      '<p>Type <code>[y](setup.md)</code> and <a href="#/settings/guide/setup/z">z</a>.</p>',
    );
  });

  test("a code block that opens on a list item stays code", () => {
    expect(renderGuide(source("- ```\n  [x](#y)\n  ```")).html).toContain("[x](#y)");
  });

  test("cuts the doc into sections at each heading, with plain text", () => {
    const { sections } = renderGuide(
      source("# Install Eva\n\nIntro *text*.\n\n## First\n\n- one\n- two\n\n### Deep\n\nA & B in (`~/.config`)."),
    );
    expect(sections).toEqual([
      { page: "setup", slug: null, title: "Install Eva", level: 1, text: "Intro text." },
      { page: "setup", slug: "first", title: "First", level: 2, text: "one two" },
      { page: "setup", slug: "deep", title: "Deep", level: 3, text: "A & B in (~/.config)." },
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

  // These tests read the real docs: a doc edit that breaks a link fails here, on purpose.
  test("every link between the docs points to a heading that exists", () => {
    const items = new Set(
      guidePages.flatMap((page) => renderedGuide(page).sections.map((each) => guideItem(page.id, each.slug))),
    );
    for (const page of guidePages) {
      const links = [...renderedGuide(page).html.matchAll(/href="#\/settings\/guide\/([^"]+)"/g)];
      for (const [, item] of links) expect(items, `${page.path} links to ${String(item)}`).toContain(item ?? "");
    }
  });

  test("no doc shows a relative link as raw Markdown", () => {
    for (const page of guidePages) {
      const text = renderedGuide(page).html.replace(/<code>.*?<\/code>/g, "");
      expect(text, page.path).not.toMatch(/\]\((?!https?:)[^)]*\)/);
    }
  });

  test("a page's address names the doc, and a heading after it", () => {
    expect(guideItem("reference", "vault-sync")).toBe("reference/vault-sync");
    expect(guideItem("setup", null)).toBe("setup");
    expect(parseGuideItem("reference/vault-sync")).toEqual({ page: "reference", slug: "vault-sync" });
    expect(parseGuideItem("setup")).toEqual({ page: "setup", slug: null });
    expect(parseGuideItem("setup/")).toEqual({ page: "setup", slug: null });
    expect(parseGuideItem("unknown/x")).toBeNull();
    expect(guidePageOf("reference")?.path).toBe("docs/guide/reference.md");
    expect(guidePageOf("nope")).toBeUndefined();
  });

  test("the search finds a part of the real docs", () => {
    expect(searchGuide("vault").length).toBeGreaterThan(0);
  });
});

describe("searchGuide", () => {
  const install = source(
    "# Install Eva\n\nEva lives at home.\n\n## Phone\n\nOpen Eva with Tailscale on a phone.\n\n## Tailscale\n\nA free app for the phone.\n\n## Café\n\nNothing here.",
  );
  const reference: GuideSource = {
    id: "reference",
    title: "Eva reference",
    summary: "",
    path: "docs/guide/reference.md",
    markdown: "# Eva reference\n\n## Several computers\n\nThe hub runs Telegram.",
  };
  const pages = [install, reference];

  test("an empty query finds nothing", () => {
    expect(searchGuide("  ", pages)).toEqual([]);
  });

  test("finds every section that holds each typed word, in any case and order", () => {
    expect(searchGuide("PHONE tailscale", pages).map((each) => each.slug)).toEqual(["phone", "tailscale"]);
  });

  test("puts a section whose title matches first, and keeps the order of the docs for the others", () => {
    expect(searchGuide("tailscale", pages).map((each) => each.slug)).toEqual(["tailscale", "phone"]);
  });

  test("the text before the first heading has the doc's title", () => {
    expect(searchGuide("home", pages)[0]).toMatchObject({ slug: null, title: "Install Eva" });
  });

  test("ignores accents, both in the query and in the docs", () => {
    expect(searchGuide("CAFE", pages).map((each) => each.slug)).toEqual(["café"]);
    expect(searchGuide("hüb", pages).map((each) => each.slug)).toEqual(["several-computers"]);
  });

  test("names the doc of each result", () => {
    expect(searchGuide("hub", pages)[0]?.pageTitle).toBe("Eva reference");
  });

  test("marks each typed word in the text", () => {
    expect(searchGuide("hub", pages)[0]?.snippet).toEqual([
      { text: "The ", marked: false },
      { text: "hub", marked: true },
      { text: " runs Telegram.", marked: false },
    ]);
  });

  test("cuts a long text at spaces around the first match", () => {
    const filler = "word ".repeat(60);
    const long = source(`## Long\n\n${filler}needle ${filler}`);
    const parts = searchGuide("needle", [long])[0]?.snippet ?? [];
    expect(parts[0]).toEqual({ text: "…", marked: false });
    expect(parts[parts.length - 1]).toEqual({ text: "…", marked: false });
    expect(parts.filter((part) => part.marked).map((part) => part.text)).toEqual(["needle"]);
    // Some words come before the match, so the person sees where it is.
    expect(parts[1]?.text.trim().split(" ").length).toBeGreaterThan(3);
    expect(parts.map((part) => part.text).join("").length).toBeLessThanOrEqual(170);
  });

  test("keeps the match when the text before it has no space, as in a long address", () => {
    const address = source(`## Install\n\nRun curl https://example.com/${"x".repeat(80)}/install.sh | sh to install.`);
    const parts = searchGuide("install", [address])[0]?.snippet ?? [];
    expect(parts.some((part) => part.marked)).toBe(true);
  });

  test("finds nothing for a word that no doc holds", () => {
    expect(searchGuide("banana", pages)).toEqual([]);
  });

  test("gives at most twelve results", () => {
    const many = source(Array.from({ length: 20 }, (_, index) => `## Part ${String(index)}\n\nsame`).join("\n\n"));
    expect(searchGuide("same", [many])).toHaveLength(12);
  });
});

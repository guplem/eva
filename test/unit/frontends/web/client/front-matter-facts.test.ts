import { describe, expect, test } from "bun:test";
import {
  dateText,
  factValue,
  factsOf,
  frontMatterFacts,
  keyLabel,
  linkOf,
  type FactFormat,
} from "../../../../../src/frontends/web/client/front-matter-facts.ts";
import type { Project } from "../../../../../src/frontends/web/client/api.ts";

const format: FactFormat = { locale: "en-GB", clock: null };

function frontMatter(overrides: Partial<Project["frontMatter"]> = {}): Project["frontMatter"] {
  return {
    created: null,
    status: null,
    inUse: false,
    closed: null,
    repos: [],
    tags: [],
    aliases: [],
    legacyId: null,
    repoTypes: {},
    type: "software",
    summary: null,
    pinned: null,
    result: null,
    extra: {},
    ...overrides,
  };
}

describe("keyLabel", () => {
  test("starts with a capital letter and splits the words", () => {
    expect(keyLabel("deadline")).toBe("Deadline");
    expect(keyLabel("next_step")).toBe("Next step");
    expect(keyLabel("release-date")).toBe("Release date");
    expect(keyLabel("lastReview")).toBe("Last review");
  });

  test("writes a known short form in capitals", () => {
    expect(keyLabel("legacy_id")).toBe("Legacy ID");
    expect(keyLabel("docs_url")).toBe("Docs URL");
    expect(keyLabel("api")).toBe("API");
  });

  test("keeps a word that the person wrote in capitals", () => {
    expect(keyLabel("MVP_date")).toBe("MVP date");
  });

  test("shows a key with no letters as it is", () => {
    expect(keyLabel("__")).toBe("__");
  });
});

describe("linkOf", () => {
  test("names a known site and shows a short path", () => {
    expect(linkOf("https://github.com/example/example-app")).toEqual({
      href: "https://github.com/example/example-app",
      site: "GitHub",
      label: "example/example-app",
    });
  });

  test("names an unknown site by its host", () => {
    expect(linkOf("https://www.example.com/docs/")).toEqual({
      href: "https://www.example.com/docs/",
      site: "example.com",
      label: "docs",
    });
  });

  test("keeps the subdomain of a site that hosts many pages", () => {
    expect(linkOf("https://example-app.vercel.app/")?.label).toBe("example-app");
    expect(linkOf("https://example.github.io/example-app")).toMatchObject({
      site: "GitHub Pages",
      label: "example/example-app",
    });
  });

  test("reads a Markdown link and keeps its text", () => {
    expect(linkOf("[Design](https://www.figma.com/file/abc)")).toEqual({
      href: "https://www.figma.com/file/abc",
      site: "Figma",
      label: "Design",
    });
  });

  test("adds the scheme to an address that starts with www", () => {
    expect(linkOf("www.example.com")?.href).toBe("https://www.example.com");
  });

  test("makes an e-mail link", () => {
    expect(linkOf("person@example.com")).toEqual({
      href: "mailto:person@example.com",
      site: "E-mail",
      label: "person@example.com",
    });
  });

  test("cuts a long path", () => {
    const link = linkOf(`https://example.com/${"a".repeat(80)}`);
    expect(link?.label.length).toBeLessThanOrEqual(40);
    expect(link?.label.endsWith("…")).toBe(true);
  });

  test("drops the query, which can hold a token", () => {
    expect(linkOf("https://example.com/page?token=secret")?.label).toBe("page");
  });

  test("gives no link for plain text or another scheme", () => {
    expect(linkOf("just words")).toBeNull();
    expect(linkOf("javascript:alert(1)")).toBeNull();
    expect(linkOf("[x](javascript:alert(1))")).toBeNull();
  });
});

describe("factValue", () => {
  test("shows a day in the person's language", () => {
    expect(factValue("2026-09-28", format)).toEqual({ kind: "date", text: "28 Sept 2026", raw: "2026-09-28" });
  });

  test("shows a month", () => {
    expect(factValue("2026-09", format)).toMatchObject({ kind: "date", text: "Sept 2026" });
  });

  test("shows a time as written, with the clock of the settings", () => {
    expect(factValue("2026-09-28T17:38", format)).toMatchObject({ kind: "date", text: "28 Sept 2026, 17:38" });
    expect(factValue("2026-09-28 17:38", { ...format, clock: "12h" })).toMatchObject({
      text: "28 Sept 2026, 5:38 PM",
    });
  });

  test("shows a time with a zone in the zone of the browser", () => {
    const moment = new Date("2026-09-28T17:38:00Z");
    const clock = `${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`;
    const value = factValue("2026-09-28T17:38:00Z", format);
    expect(value).toMatchObject({ kind: "date", raw: "2026-09-28T17:38:00Z" });
    expect(value?.kind === "date" ? value.text.endsWith(`, ${clock}`) : false).toBe(true);
  });

  test("keeps a zone with no colon as text, since not every browser reads it", () => {
    expect(factValue("2026-09-28T17:38+0200", format)?.kind).toBe("text");
  });

  test("keeps a day that is not on the calendar as text", () => {
    expect(factValue("2026-02-30", format)).toEqual({ kind: "text", parts: [{ text: "2026-02-30" }] });
  });

  test("shows true and false as Yes and No", () => {
    expect(factValue("true", format)).toEqual({ kind: "text", parts: [{ text: "Yes" }] });
    expect(factValue("False", format)).toEqual({ kind: "text", parts: [{ text: "No" }] });
  });

  test("makes a link of a value that is a link", () => {
    expect(factValue("https://github.com/example/example-app", format)).toMatchObject({ kind: "link" });
  });

  test("makes links of the addresses in a text", () => {
    expect(factValue("See https://example.com/a. Then rest.", format)).toEqual({
      kind: "text",
      parts: [
        { text: "See " },
        { text: "https://example.com/a", href: "https://example.com/a" },
        { text: ". Then rest." },
      ],
    });
  });

  test("shows a list and drops its empty items", () => {
    expect(factValue(["one", "", null, "two"], format)).toEqual({
      kind: "list",
      items: [
        { kind: "text", parts: [{ text: "one" }] },
        { kind: "text", parts: [{ text: "two" }] },
      ],
    });
  });

  test("shows a map as facts", () => {
    expect(factValue({ due_date: "2026-12-01", note: "" }, format)).toEqual({
      kind: "map",
      facts: [{ key: "due_date", label: "Due date", value: { kind: "date", text: "1 Dec 2026", raw: "2026-12-01" } }],
    });
  });

  test("gives nothing for an empty value", () => {
    expect(factValue("", format)).toBeNull();
    expect(factValue("   ", format)).toBeNull();
    expect(factValue(null, format)).toBeNull();
    expect(factValue([], format)).toBeNull();
    expect(factValue({}, format)).toBeNull();
  });

  test("shows a number as text", () => {
    expect(factValue(3, format)).toEqual({ kind: "text", parts: [{ text: "3" }] });
  });
});

describe("dateText", () => {
  test("shows a date as the project card does, and any other text as written", () => {
    const created = "2026-01-31T09:15+01:00";
    const card = frontMatterFacts(frontMatter({ created }), format)[1]?.value;
    expect(card?.kind === "date" ? card.text : null).toBe(dateText(created, format));
    expect(dateText(created, format)).not.toBe(created);
    expect(dateText("2013-07-31", format)).toBe("31 Jul 2013");
    expect(dateText("some day", format)).toBe("some day");
  });
});

describe("frontMatterFacts", () => {
  test("shows the known keys first, then every other key in the order of the file", () => {
    const facts = frontMatterFacts(
      frontMatter({
        created: "2026-09-28T17:38",
        closed: "2026-10-01",
        tags: ["tool"],
        aliases: ["the tool"],
        legacyId: "old-1",
        pinned: "false",
        type: "general",
        // An old `started` key has no place of its own: it shows where the file has it.
        extra: { objective: "Ship it", started: "2026-09-29", deadline: "2026-12-01" },
      }),
      format,
    );
    expect(facts.map((fact) => fact.label)).toEqual([
      "Type",
      "Created",
      "Closed",
      "Tags",
      "Aliases",
      "Objective",
      "Started",
      "Deadline",
      "Legacy ID",
      "Pinned",
    ]);
    expect(facts[0]?.value).toEqual({ kind: "text", parts: [{ text: "General" }] });
    expect(facts[3]?.value).toEqual({ kind: "list", items: [{ kind: "text", parts: [{ text: "#tool" }] }] });
  });

  test("shows a created time with its UTC offset as a date", () => {
    const facts = frontMatterFacts(frontMatter({ created: "2026-01-31T09:15+01:00" }), format);
    expect(facts[1]).toMatchObject({ key: "created", value: { kind: "date", raw: "2026-01-31T09:15+01:00" } });
  });

  test("leaves out the keys that the page shows elsewhere and the empty keys", () => {
    const facts = frontMatterFacts(
      frontMatter({ summary: "A line", result: "https://example.com/app", extra: { note: "" } }),
      format,
    );
    expect(facts.map((fact) => fact.key)).toEqual(["type"]);
  });
});

describe("factsOf", () => {
  test("gives a fact for each key of any front matter, and none for an empty value", () => {
    const facts = factsOf(
      [
        ["opened", "2026-09-01"],
        ["closed", ""],
        ["deadline", { date: "2026-12-01", cost: "A fee" }],
      ],
      format,
    );
    expect(facts.map((fact) => fact.label)).toEqual(["Opened", "Deadline"]);
    expect(facts[1]?.value.kind).toBe("map");
  });
});

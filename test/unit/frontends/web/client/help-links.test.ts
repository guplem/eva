import { describe, expect, test } from "bun:test";
import { guidePageOf, guideItem, renderedGuide } from "../../../../../src/frontends/web/client/guide.ts";
import {
  cardHelp,
  helpOfCard,
  helpRoute,
  helpTargets,
  helpTitle,
  type HelpTopic,
} from "../../../../../src/frontends/web/client/help-links.ts";
import { searchEntries } from "../../../../../src/frontends/web/client/settings-routes.ts";

describe("help links", () => {
  // A renamed heading in a doc fails here, so no "?" ever opens a doc at its top by mistake.
  test.each(Object.keys(helpTargets) as HelpTopic[])("%s points to a heading of the guide", (topic) => {
    const target = helpTargets[topic];
    const page = guidePageOf(target.page);
    expect(page).toBeDefined();
    const slugs = page === undefined ? [] : renderedGuide(page).sections.map((section) => section.slug);
    expect(slugs).toContain(target.slug);
  });

  test("a topic opens its heading in the Guide section of Settings", () => {
    expect(helpRoute("vault-sync")).toEqual({ section: "guide", item: guideItem("reference", "vault-sync") });
  });

  test("the name of a topic is the title of its heading", () => {
    expect(helpTitle("vault-sync")).toBe("Vault sync");
    expect(helpTitle("connect-telegram")).toBe("Connect Telegram (optional)");
  });

  test("each card with help is a card of a Settings section", () => {
    const cards = new Set(searchEntries.filter((entry) => entry.section !== "setup").map((entry) => entry.item));
    for (const item of Object.keys(cardHelp)) expect(cards, item).toContain(item);
  });

  test("a card without help gets none", () => {
    expect(helpOfCard("vault-sync")).toBe("vault-sync");
    expect(helpOfCard("appearance")).toBeNull();
    expect(helpOfCard(undefined)).toBeNull();
  });
});

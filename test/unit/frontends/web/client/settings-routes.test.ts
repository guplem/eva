import { describe, expect, test } from "bun:test";
import {
  cardId,
  designReferenceItem,
  isSettingsHash,
  parentRoute,
  parseSettingsHash,
  sameSettingsPage,
  searchEntries,
  searchSettings,
  sectionOfStep,
  settingsHash,
  settingsHome,
  settingsSections,
  settingPlaces,
} from "../../../../../src/frontends/web/client/settings-routes.ts";
import { isSettingKey, sharedSettingKeys } from "../../../../../src/core/settings/settings.ts";

describe("sameSettingsPage", () => {
  test("a link to a card keeps the section's page", () => {
    expect(sameSettingsPage("#/settings/engines", "#/settings/engines/pi")).toBe(true);
    expect(sameSettingsPage("#/settings/vault/vault-sync", "#/settings/vault")).toBe(true);
  });

  test("another section, the home or another destination is another page", () => {
    expect(sameSettingsPage("#/settings/engines", "#/settings/vault")).toBe(false);
    expect(sameSettingsPage("#/settings", "#/settings")).toBe(false);
    expect(sameSettingsPage("#/settings/engines", "#/chats")).toBe(false);
    expect(sameSettingsPage("#/projects", "#/projects")).toBe(false);
  });

  test("each setup step and the design reference are pages of their own", () => {
    expect(sameSettingsPage("#/settings/setup", "#/settings/setup/github")).toBe(false);
    expect(sameSettingsPage("#/settings/setup/github", "#/settings/setup/github")).toBe(true);
    expect(sameSettingsPage("#/settings/developer", `#/settings/developer/${designReferenceItem}`)).toBe(false);
  });
});

describe("settings addresses", () => {
  test("the home, a section and a step go to an address and back", () => {
    for (const route of [
      settingsHome,
      { section: "vault" as const, item: null },
      { section: "setup" as const, item: "remoteAccess" },
      { section: "connections" as const, item: "github" },
    ]) {
      expect(parseSettingsHash(settingsHash(route))).toEqual(route);
    }
    expect(settingsHash({ section: "setup", item: "engine" })).toBe("#/settings/setup/engine");
  });

  test("an unknown section, or another page's address, opens the home page", () => {
    expect(parseSettingsHash("#/settings/old-section/x")).toEqual(settingsHome);
    expect(parseSettingsHash("#/chat/abc")).toEqual(settingsHome);
    expect(parseSettingsHash("#/settings/")).toEqual(settingsHome);
  });

  test("only a settings address counts as one", () => {
    expect(isSettingsHash("#/settings")).toBe(true);
    expect(isSettingsHash("#/settings/vault")).toBe(true);
    expect(isSettingsHash("#/settingsx")).toBe(false);
    expect(isSettingsHash("#/chat/abc")).toBe(false);
    expect(isSettingsHash("")).toBe(false);
  });

  test("the page one level up: a step goes to its section, a section goes home", () => {
    expect(parentRoute({ section: "setup", item: "engine" })).toEqual({ section: "setup", item: null });
    expect(parentRoute({ section: "vault", item: null })).toEqual(settingsHome);
    expect(parentRoute(settingsHome)).toEqual(settingsHome);
  });

  test("each setup step has a section that holds its controls", () => {
    expect(sectionOfStep("engine")).toBe("engines");
    expect(sectionOfStep("device")).toBe("access");
    expect(sectionOfStep("google")).toBe("connections");
    const owned = settingsSections.flatMap((section) => section.steps);
    expect(new Set(owned).size).toBe(owned.length);
  });

  test("a card id never clashes with the page's own ids", () => {
    expect(cardId("github")).toBe("setting-github");
  });
});

describe("settings search", () => {
  test("an empty query finds nothing", () => {
    expect(searchSettings("   ")).toEqual([]);
  });

  test("every typed word must match, in any case", () => {
    expect(searchSettings("DARK").map((entry) => entry.item)).toEqual(["appearance"]);
    expect(searchSettings("token telegram").map((entry) => entry.item)).toEqual(["telegram"]);
    expect(searchSettings("telegram banana")).toEqual([]);
  });

  test("the search finds the permission mode and the permission lists", () => {
    expect(searchSettings("bypass permissions").map((entry) => entry.item)).toEqual(["default-engine", "permissions"]);
    expect(searchSettings("deny rules").map((entry) => entry.item)).toEqual(["permissions"]);
  });

  test("a section's title finds its entries", () => {
    const found = searchSettings("updates");
    expect(found.map((entry) => entry.item)).toEqual(["versions", "eva-updates", "restart"]);
  });

  test("a search for a tool's version finds the Versions card", () => {
    expect(searchSettings("claude version").map((entry) => entry.item)).toContain("versions");
    expect(searchSettings("pi").map((entry) => entry.item)).toContain("versions");
  });

  test("the project folders sit with the vault, because they are paths on this machine", () => {
    const found = searchSettings("project folders").map((entry) => `${entry.section}/${entry.item}`);
    expect(found).toEqual(["vault/project-folders"]);
    const personalize = settingsSections.find((section) => section.id === "personalize");
    expect(personalize?.summary).not.toContain("project");
  });

  test("each entry names a known section, and no two entries share a place", () => {
    const sections = new Set(settingsSections.map((section) => section.id));
    const places = searchEntries.map((entry) => `${entry.section}/${entry.item}`);
    expect(searchEntries.every((entry) => sections.has(entry.section))).toBe(true);
    expect(new Set(places).size).toBe(places.length);
  });
});

describe("the development section", () => {
  test("the design reference has its own address, and Back goes to the section", () => {
    const route = parseSettingsHash("#/settings/developer/design");
    expect(route).toEqual({ section: "developer", item: designReferenceItem });
    expect(parentRoute(route)).toEqual({ section: "developer", item: null });
  });

  test("the search finds the report link and the design reference", () => {
    expect(searchSettings("bug").map((entry) => entry.item)).toEqual(["report-problem"]);
    expect(searchSettings("colours components").map((entry) => entry.item)).toEqual([designReferenceItem]);
  });
});

describe("the guide section", () => {
  test("a heading of a doc has its own address, and Back goes to the guide", () => {
    const route = parseSettingsHash("#/settings/guide/reference/vault-sync");
    expect(route).toEqual({ section: "guide", item: "reference/vault-sync" });
    expect(settingsHash(route)).toBe("#/settings/guide/reference/vault-sync");
    expect(parentRoute(route)).toEqual({ section: "guide", item: null });
  });

  test("each part of the address is encoded on its own", () => {
    expect(settingsHash({ section: "guide", item: "setup/a b" })).toBe("#/settings/guide/setup/a%20b");
    expect(parseSettingsHash("#/settings/guide/setup/a%20b")).toEqual({ section: "guide", item: "setup/a b" });
  });

  test("each doc is a page of its own, and a heading of it keeps the same page", () => {
    expect(sameSettingsPage("#/settings/guide/setup", "#/settings/guide/setup/remove-eva")).toBe(true);
    expect(sameSettingsPage("#/settings/guide/setup/a", "#/settings/guide/setup/b")).toBe(true);
    expect(sameSettingsPage("#/settings/guide/setup", "#/settings/guide/reference")).toBe(false);
    expect(sameSettingsPage("#/settings/guide", "#/settings/guide/setup")).toBe(false);
  });
});

describe("where each setting lives", () => {
  test("every setting that the vault holds shows in the vault list", () => {
    const covered = settingPlaces.filter((place) => place.home === "vault").flatMap((place) => place.keys);
    for (const key of sharedSettingKeys) expect(covered).toContain(key);
  });

  test("a row of another list names no vault setting", () => {
    const others = settingPlaces.filter((place) => place.home !== "vault").flatMap((place) => place.keys);
    expect(others.filter((key) => sharedSettingKeys.includes(key))).toEqual([]);
  });

  test("each link opens a card that the search also finds", () => {
    const places = new Set(searchEntries.map((entry) => `${entry.section}/${entry.item}`));
    for (const place of settingPlaces) {
      if (place.link !== null) expect(places.has(`${place.link.section}/${place.link.item}`)).toBe(true);
    }
  });

  test("a row with no page names its key, so the person can still find it", () => {
    for (const place of settingPlaces.filter((each) => each.link === null))
      expect(place.keys.length).toBeGreaterThan(0);
  });

  test("the browser keeps the appearance", () => {
    const appearance = settingPlaces.find((place) => place.link?.item === "appearance");
    expect(appearance?.home).toBe("browser");
  });
});

test("each key of a setting home is a real setting key", () => {
  const unknown = settingPlaces.flatMap((place) => place.keys).filter((key) => !isSettingKey(key));
  expect(unknown).toEqual([]);
});

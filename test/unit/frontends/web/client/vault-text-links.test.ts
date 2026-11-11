import { describe, expect, test } from "bun:test";
import {
  lifeKindsNamed,
  withEntityNames,
  vaultTextParts,
  type KnownLifeIds,
} from "../../../../../src/frontends/web/client/vault-text-links.ts";

const known: KnownLifeIds = {
  people: ["Sam Example", "Sam", "Alex Example", "Marta Example", "A & B"],
  objects: ["Car - Example - 1234ABC"],
  pets: ["Luna"],
  cases: ["2026-05-15-phone-repair"],
};

const sam = { text: "Sam Example", href: "#/people/Sam%20Example", title: "Life/People/Sam Example" };

describe("vaultTextParts", () => {
  test("links the longest known entity that the path starts with, and leaves the rest of the sentence as text", () => {
    expect(vaultTextParts("- 2025-04-12: Called Life/People/Sam Example about the keys.", known)).toEqual([
      { text: "- 2025-04-12: Called " },
      sam,
      { text: " about the keys." },
    ]);
    expect(vaultTextParts("Ask Life/People/Sam Example and Life/People/Alex Example.", known)).toEqual([
      { text: "Ask " },
      sam,
      { text: " and " },
      { text: "Alex Example", href: "#/people/Alex%20Example", title: "Life/People/Alex Example" },
      { text: "." },
    ]);
  });

  test("ends a path at the end of a sentence, at a comma, and at the main file", () => {
    expect(vaultTextParts("Lent to Life/People/Sam Example", known)).toEqual([{ text: "Lent to " }, sam]);
    expect(vaultTextParts("partner of Life/People/Marta Example, since 2020", known)).toEqual([
      { text: "partner of " },
      { text: "Marta Example", href: "#/people/Marta%20Example", title: "Life/People/Marta Example" },
      { text: ", since 2020" },
    ]);
    expect(vaultTextParts("About Life/Objects/Car - Example - 1234ABC.", known)).toEqual([
      { text: "About " },
      {
        text: "Car - Example - 1234ABC",
        href: "#/objects/Car%20-%20Example%20-%201234ABC",
        title: "Life/Objects/Car - Example - 1234ABC",
      },
      { text: "." },
    ]);
    expect(vaultTextParts("Life/Pets/Luna/Pet.md", known)).toEqual([
      { text: "Luna", href: "#/pets/Luna", title: "Life/Pets/Luna/Pet.md" },
    ]);
  });

  test("an id must end at a word boundary", () => {
    expect(vaultTextParts("Life/People/Samuel Other", known)).toEqual([{ text: "Life/People/Samuel Other" }]);
  });

  test("shows a Life entity path that names no known entity as text", () => {
    expect(vaultTextParts("Called Life/People/Nobody Here today.", known)).toEqual([
      { text: "Called Life/People/Nobody Here today." },
    ]);
    expect(vaultTextParts("Called Life/People/Sam Example.")).toEqual([{ text: "Called Life/People/Sam Example." }]);
  });

  test("links another vault path when it has no space or ends with a file extension", () => {
    expect(vaultTextParts("See Life/Health/Habits and Projects/2026-01-01-0900-example-app/Plan.md.")).toEqual([
      { text: "See " },
      { text: "Life/Health/Habits", href: "#/files/Life/Health/Habits", title: "Life/Health/Habits" },
      { text: " and " },
      {
        text: "Projects/2026-01-01-0900-example-app/Plan.md",
        href: "#/files/Projects/2026-01-01-0900-example-app/Plan.md",
        title: "Projects/2026-01-01-0900-example-app/Plan.md",
      },
      { text: "." },
    ]);
    expect(vaultTextParts("Read Library/Some Book.md, then rest.")[1]?.href).toBe("#/files/Library/Some%20Book.md");
    // A file beside the main file of an entity opens in Files.
    expect(vaultTextParts("Life/Cases/2026-05-15-phone-repair/Repair quote.md", known)[0]?.href).toBe(
      "#/files/Life/Cases/2026-05-15-phone-repair/Repair%20quote.md",
    );
    // With spaces and no extension, the end of the name is unknown: the text stays as it is.
    expect(vaultTextParts("Read Library/Some Book about it")).toEqual([
      { text: "Read " },
      { text: "Library/Some", href: "#/files/Library/Some", title: "Library/Some" },
      { text: " Book about it" },
    ]);
  });

  test("leaves a text with no vault path, or a path under another folder, as it is", () => {
    expect(vaultTextParts("friend", known)).toEqual([{ text: "friend" }]);
    expect(vaultTextParts("", known)).toEqual([{ text: "" }]);
    expect(vaultTextParts("src/main.ts and MyLife/Cases/x", known)).toEqual([
      { text: "src/main.ts and MyLife/Cases/x" },
    ]);
    expect(vaultTextParts("Life/", known)).toEqual([{ text: "Life/" }]);
  });
});

describe("lifeKindsNamed", () => {
  test("names each Life kind that a text points into, once", () => {
    expect(lifeKindsNamed("Life/People/Sam and Life/People/Alex, Life/Pets/Luna, Life/Health/x")).toEqual([
      "people",
      "pets",
    ]);
    expect(lifeKindsNamed("nothing")).toEqual([]);
  });
});

describe("withEntityNames", () => {
  test("shows a Life path that ends a value as the name of its folder, for a card that holds no link", () => {
    expect(withEntityNames("sister of Life/People/Alex Example")).toBe("sister of Alex Example");
    expect(withEntityNames("Life/People/Sam Example/Person.md")).toBe("Sam Example");
    expect(withEntityNames("friend")).toBe("friend");
  });
});

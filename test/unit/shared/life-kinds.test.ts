import { describe, expect, test } from "bun:test";
import { isLifeKind, lifeKindPlaces, lifeKinds } from "../../../src/shared/life-kinds.ts";

describe("life kinds", () => {
  test("each kind has its folder and its main file", () => {
    expect(lifeKinds.map((kind) => `${lifeKindPlaces[kind].folder}/*/${lifeKindPlaces[kind].mainFile}`)).toEqual([
      "Life/Cases/*/Case.md",
      "Life/People/*/Person.md",
      "Life/Objects/*/Object.md",
      "Life/Pets/*/Pet.md",
      "Life/Periods/*/Period.md",
    ]);
  });

  test("only a known kind is a kind", () => {
    expect(isLifeKind("cases")).toBe(true);
    expect(isLifeKind("Cases")).toBe(false);
    expect(isLifeKind("health")).toBe(false);
    expect(isLifeKind("toString")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { vaultTextParts } from "../../../../../src/frontends/web/client/vault-text-links.ts";

describe("vaultTextParts", () => {
  test("links the path of a Life entity to its page, named by its folder", () => {
    expect(vaultTextParts("partner of Life/People/Marta Example, since 2020")).toEqual([
      { text: "partner of " },
      { text: "Marta Example", href: "#/people/Marta%20Example", title: "Life/People/Marta Example" },
      { text: ", since 2020" },
    ]);
    expect(vaultTextParts("About Life/Objects/Car - Example - 1234ABC.")).toEqual([
      { text: "About " },
      {
        text: "Car - Example - 1234ABC",
        href: "#/objects/Car%20-%20Example%20-%201234ABC",
        title: "Life/Objects/Car - Example - 1234ABC",
      },
      { text: "." },
    ]);
    expect(vaultTextParts("Life/Pets/Luna/Pet.md")).toEqual([
      { text: "Luna", href: "#/pets/Luna", title: "Life/Pets/Luna/Pet.md" },
    ]);
  });

  test("links any other path under a root folder of the vault to the Files page", () => {
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
    // A Life entity file beside the main file opens in Files.
    expect(vaultTextParts("Life/Cases/2026-05-15-phone-repair/Repair quote.md")[0]?.href).toBe(
      "#/files/Life/Cases/2026-05-15-phone-repair/Repair%20quote.md",
    );
  });

  test("leaves a text with no vault path, or a path under another folder, as it is", () => {
    expect(vaultTextParts("friend")).toEqual([{ text: "friend" }]);
    expect(vaultTextParts("")).toEqual([{ text: "" }]);
    expect(vaultTextParts("src/main.ts and MyLife/Cases/x")).toEqual([{ text: "src/main.ts and MyLife/Cases/x" }]);
    expect(vaultTextParts("Life/")).toEqual([{ text: "Life/" }]);
  });
});

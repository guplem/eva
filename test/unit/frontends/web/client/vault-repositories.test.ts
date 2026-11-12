import { describe, expect, test } from "bun:test";
import {
  chosenRepository,
  defaultVaultRepository,
  firstVaultMatch,
  matchingRepositories,
  vaultFirst,
} from "../../../../../src/frontends/web/client/vault-repositories.ts";

function repository(fullName: string): { fullName: string; cloneUrl: string; private: boolean } {
  return { fullName, cloneUrl: `https://github.com/${fullName}.git`, private: true };
}

const app = repository("you/example-app");
const notes = repository("team/notes");
const vault = repository("you/Vault");
const vaultTools = repository("you/vault-tools");

describe("vaultFirst", () => {
  test("puts a repository with the default name first, and keeps the order of the others", () => {
    expect(vaultFirst([app, vaultTools, vault, notes])).toEqual([vault, app, vaultTools, notes]);
  });

  test("matches only the name without the owner, so an owner named vault does not count", () => {
    const owner = repository("vault/example-app");
    expect(vaultFirst([owner, app])).toEqual([owner, app]);
  });

  test("the default name is the one of a new vault", () => {
    expect(defaultVaultRepository).toBe("vault");
  });
});

describe("firstVaultMatch", () => {
  test("picks the first repository with the default name, in any case", () => {
    expect(firstVaultMatch([app, vault, repository("team/vault")])).toBe(vault);
  });

  test("picks nothing when no repository has the default name", () => {
    expect(firstVaultMatch([app, vaultTools])).toBeNull();
  });
});

describe("matchingRepositories", () => {
  test("an empty search shows every repository", () => {
    expect(matchingRepositories([app, notes], "  ")).toEqual([app, notes]);
  });

  test("shows the repositories whose name holds the search, in any case", () => {
    expect(matchingRepositories([app, notes, vault, vaultTools], "VAULT")).toEqual([vault, vaultTools]);
  });

  test("matches the owner too, and ignores a copied .git ending", () => {
    expect(matchingRepositories([app, notes], "team/")).toEqual([notes]);
    expect(matchingRepositories([app, notes], "you/example-app.git")).toEqual([app]);
  });

  test("an address that names no listed repository matches nothing", () => {
    expect(matchingRepositories([app, notes], "https://example.com/other.git")).toEqual([]);
  });
});

describe("chosenRepository", () => {
  test("the picked repository, while the search shows it", () => {
    expect(chosenRepository([vault, vaultTools], vault.cloneUrl, "vault")).toBe(vault.cloneUrl);
  });

  test("the only match of the search, when the pick is hidden or empty", () => {
    expect(chosenRepository([app], vault.cloneUrl, "example")).toBe(app.cloneUrl);
    expect(chosenRepository([app], null, "example")).toBe(app.cloneUrl);
  });

  test("nothing while several matches show and none is picked", () => {
    expect(chosenRepository([vault, vaultTools], null, "vault")).toBe("");
    expect(chosenRepository([vault, vaultTools], app.cloneUrl, "vault")).toBe("");
  });

  test("the typed text, when no listed repository matches it", () => {
    expect(chosenRepository([], null, " other/vault ")).toBe("other/vault");
  });

  test("nothing with no search and no pick", () => {
    expect(chosenRepository([], null, "")).toBe("");
  });
});

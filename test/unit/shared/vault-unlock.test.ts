import { describe, expect, test } from "bun:test";
import { newPasswordProblem } from "../../../src/shared/vault-unlock.ts";

describe("a new vault password (#707)", () => {
  test("needs 12 characters as a person sees them, and the same text twice", () => {
    expect(newPasswordProblem("short", "short")).toContain("at least 12");
    // Each flag is one character, though it is four UTF-16 units.
    expect(newPasswordProblem("🇪🇸🇪🇸🇪🇸🇪🇸🇪🇸🇪🇸", "🇪🇸🇪🇸🇪🇸🇪🇸🇪🇸🇪🇸")).toContain("at least 12");
    expect(newPasswordProblem("a long password", "a long passw0rd")).toBe("The two passwords are not the same.");
    expect(newPasswordProblem("a long password", "a long password")).toBeNull();
    // The core trims a password, so outer spaces never make two copies differ.
    expect(newPasswordProblem("a long password ", "a long password")).toBeNull();
  });
});

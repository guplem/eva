import { describe, expect, test } from "bun:test";
import { errorFix } from "../../../../../src/frontends/web/client/error-fixes.ts";
import { setupBlock } from "../../../../../src/frontends/web/client/new-chat.ts";

describe("errorFix", () => {
  test("a missing vault opens the vault step of the setup, as the new chat does", () => {
    const vault = setupBlock("vault");
    expect(errorFix("vault_not_found")).toEqual({ label: vault.action, address: vault.address });
    expect(errorFix("vault_not_found")?.address).toBe("#/settings/setup/vault");
  });

  test("a failed login or install opens Settings", () => {
    expect(errorFix("engine_failed")).toEqual({ label: "Open Settings", address: "#/settings" });
    expect(errorFix("github_failed")?.label).toBe("Open Settings");
  });

  test("a failure that Settings cannot fix has no button", () => {
    expect(errorFix("session_not_found")).toBeNull();
    expect(errorFix(null)).toBeNull();
  });
});

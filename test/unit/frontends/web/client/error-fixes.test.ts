import { describe, expect, test } from "bun:test";
import { errorFix } from "../../../../../src/frontends/web/client/error-fixes.ts";
import { setupBlock } from "../../../../../src/frontends/web/client/new-chat.ts";

describe("errorFix", () => {
  test("a missing vault opens the vault step of the setup, as the new chat does", () => {
    const vault = setupBlock("vault");
    expect(errorFix("vault_not_found")).toEqual({ label: vault.action, address: vault.address });
    expect(errorFix("vault_not_found")?.address).toBe("#/settings/setup/vault");
  });

  test("a failed login or install opens the Settings card that fixes it (#799)", () => {
    expect(errorFix("engine_failed")).toEqual({ label: "Open Settings", address: "#/settings/engines" });
    expect(errorFix("engine_install_failed")?.address).toBe("#/settings/updates/versions");
    expect(errorFix("github_failed")).toEqual({ label: "Open Settings", address: "#/settings/connections/github" });
    expect(errorFix("google_failed")?.address).toBe("#/settings/connections/google");
    expect(errorFix("tailscale_install_failed")?.address).toBe("#/settings/access/remote-access");
    expect(errorFix("update_failed")?.address).toBe("#/settings/updates/eva-updates");
  });

  test("a failure that Settings cannot fix has no button", () => {
    expect(errorFix("session_not_found")).toBeNull();
    expect(errorFix(null)).toBeNull();
  });
});

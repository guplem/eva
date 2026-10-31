import { describe, expect, test } from "bun:test";
import {
  activeSecretPatterns,
  signedPayload,
  type SignedSecretState,
} from "../../../../src/core/vault/secret-policy.ts";

const defaults = ["*.pem", "*.key"];
const none = { added: [], off: [] };

function signed(known: string[], active: string[], sequence = 1): SignedSecretState {
  return { sequence, fingerprint: "0123456789abcdef", known, active };
}

describe("the secret patterns that apply (#707)", () => {
  test("with no change, every default applies, and nothing waits", () => {
    expect(activeSecretPatterns({ defaults, retired: [], changes: none, signed: null, applied: [] })).toEqual({
      active: ["*.key", "*.pem"],
      waiting: [],
    });
  });

  test("an added pattern applies at once, from any source", () => {
    const changes = { added: ["Life/Health/**"], off: [] };
    expect(activeSecretPatterns({ defaults, retired: [], changes, signed: null, applied: [] }).active).toContain(
      "Life/Health/**",
    );
  });

  test("a default that the file turns off still applies, and waits for a signed removal", () => {
    const changes = { added: [], off: ["*.key"] };
    expect(activeSecretPatterns({ defaults, retired: [], changes, signed: null, applied: [] })).toEqual({
      active: ["*.key", "*.pem"],
      waiting: ["*.key"],
    });
    const confirmed = signed(["*.key", "*.pem"], ["*.pem"]);
    expect(activeSecretPatterns({ defaults, retired: [], changes, signed: confirmed, applied: [] })).toEqual({
      active: ["*.pem"],
      waiting: [],
    });
  });

  test("a pattern that an agent deletes from the file still applies on a machine that applied it", () => {
    expect(
      activeSecretPatterns({ defaults, retired: [], changes: none, signed: null, applied: ["Life/Health/**"] }),
    ).toEqual({ active: ["*.key", "*.pem", "Life/Health/**"], waiting: ["Life/Health/**"] });
  });

  test("a new default applies at once, even when an older signed record does not name it", () => {
    const older = signed(["*.pem"], ["*.pem"]);
    expect(activeSecretPatterns({ defaults, retired: [], changes: none, signed: older, applied: [] }).active).toEqual([
      "*.key",
      "*.pem",
    ]);
  });

  test("a default that a release retires still applies, until a signed removal", () => {
    expect(
      activeSecretPatterns({ defaults: ["*.pem"], retired: ["*.key"], changes: none, signed: null, applied: [] }),
    ).toEqual({
      active: ["*.key", "*.pem"],
      waiting: ["*.key"],
    });
  });

  test("the payload to sign names every pattern that Eva knows, and the ones that stay", () => {
    const changes = { added: ["Life/Health/**"], off: ["*.key"] };
    expect(
      signedPayload({ defaults, retired: [], changes, signed: null, applied: ["Notes/old/**"] }, 4, "0123456789abcdef"),
    ).toEqual({
      sequence: 4,
      fingerprint: "0123456789abcdef",
      known: ["*.key", "*.pem", "Life/Health/**", "Notes/old/**"],
      active: ["*.pem", "Life/Health/**"],
    });
  });
});

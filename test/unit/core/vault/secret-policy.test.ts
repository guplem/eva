import { describe, expect, test } from "bun:test";
import {
  activeSecretPatterns,
  addedBack,
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
    expect(
      activeSecretPatterns({ defaults, retired: [], fixed: [], changes: none, signed: null, applied: [] }),
    ).toEqual({
      active: ["*.key", "*.pem"],
      waiting: [],
    });
  });

  test("an added pattern applies at once, from any source", () => {
    const changes = { added: ["Life/Health/**"], off: [] };
    expect(
      activeSecretPatterns({ defaults, retired: [], fixed: [], changes, signed: null, applied: [] }).active,
    ).toContain("Life/Health/**");
  });

  test("a default that the file turns off still applies, and waits for a signed removal", () => {
    const changes = { added: [], off: ["*.key"] };
    expect(activeSecretPatterns({ defaults, retired: [], fixed: [], changes, signed: null, applied: [] })).toEqual({
      active: ["*.key", "*.pem"],
      waiting: ["*.key"],
    });
    const confirmed = signed(["*.key", "*.pem"], ["*.pem"]);
    expect(activeSecretPatterns({ defaults, retired: [], fixed: [], changes, signed: confirmed, applied: [] })).toEqual(
      {
        active: ["*.pem"],
        waiting: [],
      },
    );
  });

  test("a pattern that an agent deletes from the file still applies on a machine that applied it", () => {
    expect(
      activeSecretPatterns({
        defaults,
        retired: [],
        fixed: [],
        changes: none,
        signed: null,
        applied: ["Life/Health/**"],
      }),
    ).toEqual({ active: ["*.key", "*.pem", "Life/Health/**"], waiting: ["Life/Health/**"] });
  });

  test("a new default applies at once, even when an older signed record does not name it", () => {
    const older = signed(["*.pem"], ["*.pem"]);
    expect(
      activeSecretPatterns({ defaults, retired: [], fixed: [], changes: none, signed: older, applied: [] }).active,
    ).toEqual(["*.key", "*.pem"]);
  });

  test("a default that a release retires still applies, until a signed removal", () => {
    expect(
      activeSecretPatterns({
        defaults: ["*.pem"],
        retired: ["*.key"],
        fixed: [],
        changes: none,
        signed: null,
        applied: [],
      }),
    ).toEqual({
      active: ["*.key", "*.pem"],
      waiting: ["*.key"],
    });
  });

  test("the payload to sign names every pattern that Eva knows, and the ones that stay", () => {
    const changes = { added: ["Life/Health/**"], off: ["*.key"] };
    expect(
      signedPayload(
        { defaults, retired: [], fixed: [], changes, signed: null, applied: ["Notes/old/**"] },
        ["*.pem", "Life/Health/**"],
        4,
        "0123456789abcdef",
      ),
    ).toEqual({
      sequence: 4,
      fingerprint: "0123456789abcdef",
      known: ["*.key", "*.pem", "Life/Health/**", "Notes/old/**"],
      active: ["*.pem", "Life/Health/**"],
    });
  });
});

describe("signed records, after the review of #707", () => {
  const signed = { sequence: 1, fingerprint: "0123456789abcdef", known: ["*.key", "*.pem"], active: ["*.pem"] };

  test("a pattern that the record keeps stays active, though its line and the machine's memory are gone", () => {
    const kept = { ...signed, known: [...signed.known, "Life/**"], active: [...signed.active, "Life/**"] };
    const changes = { added: [], off: [] };
    expect(
      activeSecretPatterns({ defaults, retired: [], fixed: [], changes, signed: kept, applied: [] }).waiting,
    ).toEqual(["Life/**"]);
  });

  test("a pattern that the record took out and that the file asks for again is added back", () => {
    expect(
      addedBack({ defaults, retired: [], fixed: [], changes: { added: [], off: [] }, signed, applied: [] }),
    ).toEqual(["*.key"]);
    expect(
      addedBack({ defaults, retired: [], fixed: [], changes: { added: [], off: ["*.key"] }, signed, applied: [] }),
    ).toEqual([]);
  });

  test("a new record keeps knowing what an old record took out, so that removal holds", () => {
    const payload = signedPayload(
      { defaults: ["*.pem"], retired: [], fixed: [], changes: { added: [], off: [] }, signed, applied: [] },
      ["*.pem"],
      2,
      "0123456789abcdef",
    );
    expect(payload.known).toContain("*.key");
    expect(payload.active).toEqual(["*.pem"]);
  });
});

describe("a fixed secret pattern (#1108)", () => {
  const fixed = ["*.eva-secret"];

  test("applies with no line in the file, and never waits", () => {
    expect(activeSecretPatterns({ defaults, retired: [], fixed, changes: none, signed: null, applied: [] })).toEqual({
      active: ["*.eva-secret", "*.key", "*.pem"],
      waiting: [],
    });
  });

  test("an off line or a signed removal does not take it out", () => {
    const changes = { added: [], off: ["*.eva-secret"] };
    const removed = signed(["*.eva-secret", "*.key", "*.pem"], ["*.key", "*.pem"]);
    expect(activeSecretPatterns({ defaults, retired: [], fixed, changes, signed: removed, applied: [] })).toEqual({
      active: ["*.eva-secret", "*.key", "*.pem"],
      waiting: [],
    });
  });
});

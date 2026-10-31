import { describe, expect, test } from "bun:test";
import {
  forgetUnlockSecret,
  keepUnlockSecret,
  onUnlockForgotten,
  unlockHeaders,
  unlockSecret,
  type UnlockStorage,
} from "../../../../../src/frontends/web/client/vault-unlock.ts";

function memory(): UnlockStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const broken: UnlockStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("the unlock secret of a tab (#707)", () => {
  test("a kept secret goes in the header of each request, until the tab forgets it", () => {
    const store = memory();
    expect(unlockHeaders(store)).toEqual({});
    keepUnlockSecret("abc", store);
    expect(unlockSecret(store)).toBe("abc");
    expect(unlockHeaders(store)).toEqual({ "x-eva-unlock": "abc" });
    forgetUnlockSecret(store);
    expect(unlockHeaders(store)).toEqual({});
  });

  test("a store that fails, as in a private window, means no secret and no crash", () => {
    keepUnlockSecret("abc", broken);
    forgetUnlockSecret(broken);
    expect(unlockSecret(broken)).toBeNull();
    expect(unlockHeaders(null)).toEqual({});
  });
});

describe("what goes when the tab forgets its unlock (review of #707)", () => {
  test("each listener hears it, so a draft of decrypted text goes too", () => {
    const store = memory();
    let heard = 0;
    const stop = onUnlockForgotten(() => (heard += 1));
    keepUnlockSecret("abc", store);
    forgetUnlockSecret(store);
    expect(heard).toBe(1);
    stop();
    forgetUnlockSecret(store);
    expect(heard).toBe(1);
  });
});

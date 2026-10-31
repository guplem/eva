import { beforeEach, describe, expect, test } from "bun:test";
import {
  draftOf,
  dropEncryptedDrafts,
  forgetAllDrafts,
  hasEncryptedDraft,
  keepDraft,
  moveDrafts,
  sameText,
} from "../../../../../src/frontends/web/client/file-drafts.ts";
import { forgetUnlockSecret } from "../../../../../src/frontends/web/client/vault-unlock.ts";

beforeEach(() => {
  forgetAllDrafts();
});

describe("drafts of the Files page", () => {
  test("a draft that matches the file goes, and a Windows file does not look changed", () => {
    keepDraft("Notes/a.md", { text: "new\n", version: "1" }, "old\n");
    expect(draftOf("Notes/a.md")?.text).toBe("new\n");
    keepDraft("Notes/a.md", { text: "old\n", version: "1" }, "old\r\n");
    expect(draftOf("Notes/a.md")).toBeUndefined();
    expect(sameText("a\r\nb", "a\nb")).toBe(true);
  });

  test("a rename takes the drafts inside the folder to the new path", () => {
    keepDraft("Notes/a.md", { text: "new", version: "1" }, "old");
    moveDrafts("Notes", "Archive");
    expect(draftOf("Notes/a.md")).toBeUndefined();
    expect(draftOf("Archive/a.md")?.text).toBe("new");
  });
});

describe("drafts of encrypted files (#707)", () => {
  test("a lock drops each draft of decrypted text, and only those", () => {
    keepDraft("Private/a.secrets", { text: "KEY=2", version: "1", encrypted: true }, "KEY=1");
    keepDraft("Notes/a.md", { text: "new", version: "1" }, "old");
    expect(hasEncryptedDraft()).toBe(true);
    forgetUnlockSecret(null);
    expect(draftOf("Private/a.secrets")).toBeUndefined();
    expect(draftOf("Notes/a.md")?.text).toBe("new");
    expect(hasEncryptedDraft()).toBe(false);
  });

  test("a renamed encrypted draft is still dropped at a lock", () => {
    keepDraft("Private/a.secrets", { text: "KEY=2", version: "1", encrypted: true }, "KEY=1");
    moveDrafts("Private", "Keys");
    dropEncryptedDrafts();
    expect(draftOf("Keys/a.secrets")).toBeUndefined();
  });
});

describe("the leave guard of the drafts", () => {
  test("asks the browser to stop a reload while a draft waits, and only then", () => {
    let listener: ((event: { preventDefault: () => void }) => void) | null = null;
    const stand = globalThis as unknown as { window?: unknown };
    stand.window = { addEventListener: (_type: string, added: typeof listener) => (listener = added) };
    try {
      keepDraft("Notes/a.md", { text: "new", version: "1" }, "old");
      let stopped = 0;
      const event = { preventDefault: () => (stopped += 1) };
      listener?.(event);
      expect(stopped).toBe(1);
      forgetAllDrafts();
      listener?.(event);
      expect(stopped).toBe(1);
    } finally {
      delete stand.window;
    }
  });
});

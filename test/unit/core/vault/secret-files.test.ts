import { describe, expect, test } from "bun:test";
import {
  defaultSecretPatterns,
  isNeverEncrypted,
  parseSecretFiles,
  SecretMatcher,
} from "../../../../src/core/vault/secret-files.ts";

const defaults = new SecretMatcher(defaultSecretPatterns);

describe("the default secret files (#707)", () => {
  test("cover the files that hold secrets, in any folder", () => {
    for (const path of [
      ".env.local",
      "Projects/2025-03-02-1015-coach/.env.local",
      "Projects/app/.env.production.local",
      "Life/.env.secrets",
      "Notes/bank.secrets",
      "Toolbox/server.pem",
      "deploy/id.key",
      "certs/me.p12",
      "certs/me.pfx",
      ".npmrc",
      "Projects/app/.pypirc",
      ".netrc",
      "Projects/app/secrets.json",
      "credentials.json",
      "client_secret_123.json",
    ])
      expect([path, defaults.matches(path)]).toEqual([path, true]);
  });

  test("leave out the plain .env and the example files, which hold values that are safe to share", () => {
    for (const path of [
      ".env",
      "Projects/app/.env",
      ".env.example",
      ".env.sample",
      ".env.template",
      ".env.dist",
      "Notes/keys.md",
      "Notes/secrets-of-cooking.md",
    ])
      expect([path, defaults.matches(path)]).toEqual([path, false]);
  });

  test("ignore case, and the trailing dots and spaces that Windows drops", () => {
    expect(defaults.matches("Certs/ME.PEM")).toBe(true);
    expect(defaults.matches("deploy/id.key.")).toBe(true);
    expect(defaults.matches("deploy/id.key ")).toBe(true);
  });
});

describe("the person's patterns (#707)", () => {
  test("a line adds a pattern, a ! line turns a default off, and comments and blanks are skipped", () => {
    expect(parseSecretFiles("# My secrets\nLife/Health/**\n\n!*.key\n  Notes/bank.md  \n")).toEqual({
      added: ["Life/Health/**", "Notes/bank.md"],
      off: ["*.key"],
    });
  });

  test("a pattern with a slash starts at the vault root, and a folder pattern covers its files", () => {
    const matcher = new SecretMatcher(["Life/Health/**", "/top.txt", "private/"]);
    expect(matcher.matches("Life/Health/blood.md")).toBe(true);
    expect(matcher.matches("Life/Health/2026/blood.md")).toBe(true);
    expect(matcher.matches("Notes/Life/Health/blood.md")).toBe(false);
    expect(matcher.matches("top.txt")).toBe(true);
    expect(matcher.matches("Notes/top.txt")).toBe(false);
    expect(matcher.matches("private/a.md")).toBe(true);
    expect(matcher.matches("Notes/private/a.md")).toBe(true);
  });

  test("a later ! line wins over an earlier pattern", () => {
    const matcher = new SecretMatcher(["Life/**", "!Life/Diary/**"]);
    expect(matcher.matches("Life/Health/a.md")).toBe(true);
    expect(matcher.matches("Life/Diary/a.md")).toBe(false);
  });
});

describe("the files that Eva never encrypts (#707)", () => {
  test("Eva's settings, each AGENTS.md, .gitignore and .gitattributes stay plain, whatever the list says", () => {
    for (const path of [
      ".eva/assistant.md",
      ".eva/vault-key.json",
      "AGENTS.md",
      "Projects/coach/AGENTS.md",
      ".gitignore",
      "Notes/.gitignore",
      ".gitattributes",
    ])
      expect([path, isNeverEncrypted(path)]).toEqual([path, true]);
    expect(isNeverEncrypted("Notes/a.md")).toBe(false);
    const everything = new SecretMatcher(["**"]);
    expect(everything.matches("AGENTS.md")).toBe(false);
    expect(everything.matches(".eva/assistant.md")).toBe(false);
    expect(everything.matches("Notes/a.md")).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { SequenceCounter, systemClock } from "../../../src/shared/clock.ts";
import { buildChildEnvironment } from "../../../src/shared/environment.ts";
import { EvaError, isEvaError } from "../../../src/shared/errors.ts";
import { summarizeToolCall, toolCategory } from "../../../src/shared/outward-actions.ts";
import { containsSecretPattern, Redactor } from "../../../src/shared/redaction.ts";

describe("EvaError", () => {
  test("carries a code that isEvaError can check", () => {
    const error = new EvaError("git_failed", "push refused");
    expect(isEvaError(error)).toBe(true);
    expect(isEvaError(error, "git_failed")).toBe(true);
    expect(isEvaError(error, "config_invalid")).toBe(false);
    expect(isEvaError(new Error("other"))).toBe(false);
    expect(error.name).toBe("EvaError");
  });
});

describe("toolCategory", () => {
  test("the shell tool of each engine is a command, and every other tool is a tool", () => {
    expect(toolCategory("Bash")).toBe("command");
    expect(toolCategory("bash")).toBe("command");
    expect(toolCategory("Read")).toBe("tool");
    expect(toolCategory("Agent")).toBe("tool");
  });
});

describe("summarizeToolCall", () => {
  test("names a skill by its name, not by its input as JSON", () => {
    expect(summarizeToolCall("Skill", { skill: "eva:about-me" })).toBe("Skill eva:about-me");
  });
});

describe("clock", () => {
  test("the system clock returns the current time", () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  test("a sequence counter only grows", () => {
    const counter = new SequenceCounter();
    expect([counter.next(), counter.next(), counter.next()]).toEqual([1, 2, 3]);
  });
});

describe("buildChildEnvironment", () => {
  test("keeps only allowlisted variables and adds the extras", () => {
    const environment = buildChildEnvironment(
      { PATH: "/bin", TELEGRAM_BOT_TOKEN: "secret", HOME: "/h", EMPTY: undefined },
      ["PATH", "HOME", "EMPTY"],
      { CLAUDE_CONFIG_DIR: "/c", SKIPPED: undefined },
    );
    expect(environment).toEqual({ PATH: "/bin", HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
  });

  test("an extra value wins over the inherited one", () => {
    expect(buildChildEnvironment({ HOME: "/old" }, ["HOME"], { HOME: "/new" })).toEqual({ HOME: "/new" });
  });
});

describe("Redactor", () => {
  test("replaces a known secret wherever it appears", () => {
    const redactor = new Redactor();
    redactor.addSecret("very-long-secret-value");
    expect(redactor.redact("a very-long-secret-value b very-long-secret-value")).toBe("a [redacted] b [redacted]");
  });

  test("ignores a short value, so normal words stay readable", () => {
    const redactor = new Redactor();
    redactor.addSecret("abc");
    redactor.addSecret(undefined);
    expect(redactor.redact("abc")).toBe("abc");
  });

  test("replaces the longer of two overlapping secrets first", () => {
    const redactor = new Redactor();
    redactor.addSecret("secret-12345");
    redactor.addSecret("secret-12345-and-more");
    redactor.addSecret("secret-12345");
    expect(redactor.redact("x secret-12345-and-more y")).toBe("x [redacted] y");
  });

  test("catches well-known token shapes it was never told about", () => {
    const redactor = new Redactor();
    const telegram = "123456789:" + "A".repeat(35);
    const github = "ghp_" + "b".repeat(36);
    expect(redactor.redact(`token ${telegram} and ${github}`)).toBe("token [redacted] and [redacted]");
  });
});

/** Built from parts, so the repository's secret scanner sees no key header in this file. */
const keyHeader = "-----BEGIN " + "PRIVATE KEY-----";

describe("containsSecretPattern", () => {
  test("finds a private key and an Anthropic token, and nothing in plain prose", () => {
    expect(containsSecretPattern("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecretPattern("key sk-ant-" + "x".repeat(20))).toBe(true);
    expect(containsSecretPattern("A note about keys and tokens.")).toBe(false);
    // Built from parts, so the secret scanner of this repository finds no real-looking token.
    for (const token of [
      "GOCSPX-" + "a".repeat(28),
      "ya29." + "d".repeat(40),
      "1//0" + "e".repeat(40),
      "sk-proj-" + "b".repeat(40),
      "xoxb-" + "1".repeat(12),
      "npm_" + "c".repeat(36),
      keyHeader + "\nMIIE cut short",
    ]) {
      expect(containsSecretPattern(`text ${token} more`)).toBe(true);
    }
    expect(new Redactor().redact(`key: ${keyHeader}\nMIIE`)).toBe("key: [redacted]");
    // A path with a double slash in a note is no Google token.
    expect(containsSecretPattern("see https://example.com/page/1//0" + "f".repeat(40))).toBe(false);
  });

  test("gives the same answer when asked twice", () => {
    const text = "github_pat_" + "c".repeat(30);
    expect(containsSecretPattern(text)).toBe(true);
    expect(containsSecretPattern(text)).toBe(true);
  });
});

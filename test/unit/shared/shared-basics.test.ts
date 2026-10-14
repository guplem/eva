import { describe, expect, test } from "bun:test";
import { SequenceCounter, systemClock } from "../../../src/shared/clock.ts";
import { buildChildEnvironment } from "../../../src/shared/environment.ts";
import { EvaError, isEvaError } from "../../../src/shared/errors.ts";
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

describe("containsSecretPattern", () => {
  test("finds a private key and an Anthropic token, and nothing in plain prose", () => {
    expect(containsSecretPattern("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecretPattern("key sk-ant-" + "x".repeat(20))).toBe(true);
    expect(containsSecretPattern("A note about keys and tokens.")).toBe(false);
  });

  test("gives the same answer when asked twice", () => {
    const text = "github_pat_" + "c".repeat(30);
    expect(containsSecretPattern(text)).toBe(true);
    expect(containsSecretPattern(text)).toBe(true);
  });
});

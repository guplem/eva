import { describe, expect, test } from "bun:test";
import { Redactor, TextStreamRedactor } from "../../../src/shared/redaction.ts";

/** Sends each piece and returns everything the stream let through. */
function streamed(stream: TextStreamRedactor, pieces: readonly string[]): string {
  return pieces.map((piece) => stream.push(piece)).join("");
}

describe("TextStreamRedactor", () => {
  test("sends whole words and holds back the word that may still grow", () => {
    const stream = new TextStreamRedactor(new Redactor());
    expect(stream.push("Hello wor")).toBe("Hello ");
    expect(stream.push("ld, how")).toBe("world, ");
    expect(stream.push(" are you?\n")).toBe("how are you?\n");
  });

  test("never sends a part of a token shape cut across two pieces", () => {
    const stream = new TextStreamRedactor(new Redactor());
    const token = `ghp_${"a".repeat(36)}`;
    const text = streamed(stream, ["Use ", token.slice(0, 6), token.slice(6, 20), token.slice(20), " now."]);
    expect(text).toBe("Use [redacted] ");
    expect(text).not.toContain("ghp_");
  });

  test("never sends a part of a known secret, even one with spaces", () => {
    const redactor = new Redactor();
    redactor.addSecret("open sesame now");
    const stream = new TextStreamRedactor(redactor);
    const text = streamed(stream, ["The words are open ", "sesame ", "now and ", "then. More words here.\n"]);
    expect(text).not.toContain("sesame");
    expect(text).toContain("[redacted]");
  });

  test("holds back enough when short secrets inside a longer one grow as they are redacted", () => {
    const redactor = new Redactor();
    const long = "PIN 11111111 22222222 33333333!";
    for (const secret of [long, "11111111", "22222222", "33333333"]) redactor.addSecret(secret);
    const stream = new TextStreamRedactor(redactor);
    const text = streamed(stream, ["Here: ", ...long.split(""), " done "]);
    expect(text).not.toContain("PIN");
  });

  test("stops the block when a later piece changes text it already sent", () => {
    const stream = new TextStreamRedactor(new Redactor());
    const sent = streamed(stream, ["-----BEGIN RSA ", "PRIVATE ", "KEY-----\n", "MIIEowIBAAKCAQEA ", "more words "]);
    expect(sent).not.toContain("MIIE");
    expect(stream.push("and more ")).toBe("");
  });

  test("starts again after a reset", () => {
    const stream = new TextStreamRedactor(new Redactor());
    expect(stream.push("first block ")).toBe("first block ");
    stream.reset();
    expect(stream.push("second ")).toBe("second ");
  });
});

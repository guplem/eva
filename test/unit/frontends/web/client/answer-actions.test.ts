import { describe, expect, test } from "bun:test";
import { answerActions, branchRowActions } from "../../../../../src/frontends/web/client/answer-actions.ts";

const answered = { lastMessageId: "m1", failure: null };

describe("answerActions", () => {
  test("an answer of an open chat retries and forks", () => {
    expect(answerActions({ closed: false }, answered)).toEqual({ retry: true, fork: true });
  });

  test("a closed chat takes no new turn, so it offers neither", () => {
    expect(answerActions({ closed: true }, answered)).toEqual({ retry: false, fork: false });
  });

  test("a failed answer, or one with no message, retries but does not fork", () => {
    expect(answerActions({ closed: false }, { lastMessageId: "m1", failure: { message: "x" } })).toEqual({
      retry: true,
      fork: false,
    });
    expect(answerActions({ closed: false }, { lastMessageId: null, failure: null })).toEqual({
      retry: true,
      fork: false,
    });
  });
});

describe("branchRowActions", () => {
  const open = { closed: false };

  test("a row of a turn has Show, Copy, Retry and Fork", () => {
    expect(branchRowActions(open, { ...answered, words: "Hi" }, true)).toEqual(["show", "copy", "retry", "fork"]);
  });

  test("a turn with no words of the person has no Copy", () => {
    expect(branchRowActions(open, { ...answered, words: null }, true)).toEqual(["show", "retry", "fork"]);
  });

  test("empty words have no Copy either", () => {
    expect(branchRowActions(open, { ...answered, words: "" }, true)).toEqual(["show", "retry", "fork"]);
  });

  test("a failed answer retries but does not fork", () => {
    expect(branchRowActions(open, { lastMessageId: "m1", failure: { message: "x" }, words: "Hi" }, true)).toEqual([
      "show",
      "copy",
      "retry",
    ]);
  });

  test("a place outside the chat, such as the phone's sheet, has no Retry and no Fork", () => {
    expect(branchRowActions(open, { ...answered, words: "Hi" }, false)).toEqual(["show", "copy"]);
  });

  test("a fork with no turn yet has only Show", () => {
    expect(branchRowActions(open, null, true)).toEqual(["show"]);
  });

  test("a closed chat keeps Show and Copy", () => {
    expect(branchRowActions({ closed: true }, { ...answered, words: "Hi" }, true)).toEqual(["show", "copy"]);
  });
});

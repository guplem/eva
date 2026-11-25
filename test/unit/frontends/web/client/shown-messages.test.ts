import { beforeEach, describe, expect, test } from "bun:test";
import {
  answerKey,
  forgetShown,
  noteShown,
  sentKey,
  takeShown,
} from "../../../../../src/frontends/web/client/shown-messages.ts";

describe("shown messages", () => {
  beforeEach(forgetShown);

  test("knows a stored message that the page already showed, so its new element does not fade in again", () => {
    noteShown(sentKey("Hello"));
    expect(takeShown(sentKey("Hello"))).toBe(true);
  });

  test("knows each message once, so a later message with the same words fades in as usual", () => {
    noteShown(sentKey("Hello"));
    takeShown(sentKey("Hello"));
    expect(takeShown(sentKey("Hello"))).toBe(false);
  });

  test("knows a message that showed twice only once, as React draws an element more than once", () => {
    noteShown(sentKey("Hello"));
    noteShown(sentKey("Hello"));
    takeShown(sentKey("Hello"));
    expect(takeShown(sentKey("Hello"))).toBe(false);
  });

  test("does not know a message that the page never showed", () => {
    noteShown(sentKey("Hello"));
    expect(takeShown(sentKey("Another message"))).toBe(false);
  });

  test("keeps the person's words apart from the answers of a session", () => {
    noteShown(answerKey("chat-1"));
    expect(takeShown(sentKey("chat-1"))).toBe(false);
    expect(takeShown(answerKey("chat-2"))).toBe(false);
    expect(takeShown(answerKey("chat-1"))).toBe(true);
  });

  test("keeps only the newest messages, so the list never grows", () => {
    for (let index = 0; index < 40; index += 1) noteShown(sentKey(`Message ${String(index)}`));
    expect(takeShown(sentKey("Message 0"))).toBe(false);
    expect(takeShown(sentKey("Message 39"))).toBe(true);
  });
});

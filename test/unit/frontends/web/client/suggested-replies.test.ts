import { describe, expect, test } from "bun:test";
import {
  chatReplies,
  moreRepliesLabel,
  sendsSuggestion,
  shownReplies,
  suggestionHint,
} from "../../../../../src/frontends/web/client/suggested-replies.ts";

const answer = "Shall I go on?\n[[reply: Yes]]\n[[reply: No]]";
const free = { kind: "assistant", closed: false, busy: false, newest: { answerText: answer, failure: null } } as const;

describe("chatReplies (#1127)", () => {
  test("gives the replies of the newest answer of a free chat with Eva", () => {
    expect(chatReplies(free)).toEqual(["Yes", "No"]);
  });

  test("gives none in a Project chat or a specialist chat, also when the answer holds the marker", () => {
    expect(chatReplies({ ...free, kind: "project" })).toEqual([]);
    expect(chatReplies({ ...free, kind: "specialist" })).toEqual([]);
  });

  test("gives none while the chat is busy, for a closed chat, or with no answer", () => {
    expect(chatReplies({ ...free, busy: true })).toEqual([]);
    expect(chatReplies({ ...free, closed: true })).toEqual([]);
    expect(chatReplies({ ...free, newest: undefined })).toEqual([]);
  });

  test("gives none for a failed or stopped answer", () => {
    expect(chatReplies({ ...free, newest: { answerText: answer, failure: "The turn failed." } })).toEqual([]);
  });

  test("gives none for an answer with no reply line", () => {
    expect(chatReplies({ ...free, newest: { answerText: "Done.", failure: null } })).toEqual([]);
  });
});

describe("shownReplies", () => {
  const box = { empty: true, locked: false, busy: false };

  test("shows the replies in an empty free box", () => {
    expect(shownReplies(["Yes", "No"], box)).toEqual(["Yes", "No"]);
  });

  test("hides them once the person types or attaches a file, while the box is locked or busy", () => {
    expect(shownReplies(["Yes"], { ...box, empty: false })).toEqual([]);
    expect(shownReplies(["Yes"], { ...box, locked: true })).toEqual([]);
    expect(shownReplies(["Yes"], { ...box, busy: true })).toEqual([]);
  });
});

describe("sendsSuggestion", () => {
  const tab = { key: "Tab", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  const press = { ...tab, isComposing: false, keyCode: 9 };
  const state = { shown: true, mentionOpen: false };

  test("a plain Tab sends the shown suggestion", () => {
    expect(sendsSuggestion(press, state)).toBe(true);
  });

  test("Tab does what it does today with no suggestion or with the mention list open", () => {
    expect(sendsSuggestion(press, { ...state, shown: false })).toBe(false);
    expect(sendsSuggestion(press, { ...state, mentionOpen: true })).toBe(false);
  });

  test("Shift+Tab and Tab with another modifier key leave the box", () => {
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const)
      expect(sendsSuggestion({ ...press, [modifier]: true }, state)).toBe(false);
  });

  test("a key of an input method and another key send nothing", () => {
    expect(sendsSuggestion({ ...press, isComposing: true }, state)).toBe(false);
    expect(sendsSuggestion({ ...press, keyCode: 229 }, state)).toBe(false);
    expect(sendsSuggestion({ ...press, key: "Enter" }, state)).toBe(false);
  });
});

describe("the words of a suggestion", () => {
  test("a hint for a screen reader names the reply and the key", () => {
    expect(suggestionHint("Yes")).toBe("Suggested reply: Yes. Press Tab to send it.");
  });

  test("the more button counts the other replies", () => {
    expect(moreRepliesLabel(1)).toBe("1 more suggested reply");
    expect(moreRepliesLabel(3)).toBe("3 more suggested replies");
  });
});

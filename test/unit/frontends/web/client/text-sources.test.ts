import { describe, expect, test } from "bun:test";
import {
  clearTextSource,
  noteFill,
  onTextSource,
  takeFocusAsk,
  textSourceOf,
} from "../../../../../src/frontends/web/client/text-sources.ts";

describe("the source of a filled text", () => {
  test("names the widget until the person clears it, and asks for the focus once", () => {
    let told = 0;
    const stop = onTextSource("draft-a", () => (told += 1));
    noteFill("draft-a", "Cases");
    expect(textSourceOf("draft-a")).toBe("Cases");
    expect(textSourceOf("draft-b")).toBeNull();
    expect(takeFocusAsk("draft-a")).toBe(true);
    expect(takeFocusAsk("draft-a")).toBe(false);
    clearTextSource("draft-a");
    expect(textSourceOf("draft-a")).toBeNull();
    // A clear with no source tells nobody.
    clearTextSource("draft-a");
    expect(told).toBe(2);
    stop();
    noteFill("draft-a", undefined);
    expect(told).toBe(2);
    expect(textSourceOf("draft-a")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { noteActionLabels, noteParts, restartNote } from "../../../../../src/frontends/web/client/notes.ts";

describe("noteParts", () => {
  test("a plain note has no action", () => {
    expect(noteParts("Saved.")).toEqual({ text: "Saved.", action: null });
  });

  test("a note that asks for a restart carries the restart, so one tap does it", () => {
    expect(noteParts(restartNote("Saved. Press Restart Eva to use the new setting."))).toEqual({
      text: "Saved. Press Restart Eva to use the new setting.",
      action: "restart",
    });
    expect(noteActionLabels.restart).toBe("Restart Eva");
  });
});

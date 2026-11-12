import { describe, expect, test } from "bun:test";
import { outwardActionsBlock } from "../../../../src/core/modes/outward-actions-block.ts";
import {
  defaultOutwardActionLevels,
  outwardActionCategories,
  type OutwardActionLevels,
} from "../../../../src/shared/outward-actions.ts";

function allOn(level: "allow" | "deny"): OutwardActionLevels {
  return Object.fromEntries(outwardActionCategories.map((category) => [category, level])) as OutwardActionLevels;
}

describe("outwardActionsBlock", () => {
  test("lists each category on Ask, and tells the model not to ask a second time", () => {
    const block = outwardActionsBlock({ ...allOn("allow"), pushCode: "ask", sendEmail: "ask" });
    expect(block).toBe(
      [
        "# Actions that reach other people",
        "",
        "The person wants to say yes before each of these actions. Eva shows the person a button when you try one. Do not ask a second time in text.",
        "",
        "- Push code: git push",
        "- Send an email: Send a message with Gmail",
        "",
      ].join("\n"),
    );
  });

  test("lists each category on Deny, and bans another way", () => {
    const block = outwardActionsBlock({ ...allOn("allow"), sendData: "deny" });
    expect(block).toContain("# Actions that reach other people");
    expect(block).toContain("do not try another way to do the same thing");
    expect(block).toContain("- Send data over the network:");
    expect(block).not.toContain("Do not ask a second time");
  });

  test("names both lists when the levels differ, and leaves a category on Allow out", () => {
    const block = outwardActionsBlock({ ...allOn("allow"), github: "ask", changeSchedules: "deny" }) ?? "";
    expect(block).toContain("- GitHub: issues and pull requests");
    expect(block).toContain("- Change the schedules");
    expect(block).not.toContain("Push code");
    expect(block.indexOf("GitHub")).toBeLessThan(block.indexOf("Change the schedules"));
  });

  test("is empty when every category is on Allow, and lists all of them by default", () => {
    expect(outwardActionsBlock(allOn("allow"))).toBeNull();
    const block = outwardActionsBlock(defaultOutwardActionLevels) ?? "";
    for (const line of ["Push code", "Send an email", "Calendar invitations", "Change the schedules"])
      expect(block).toContain(line);
  });
});

import { describe, expect, test } from "bun:test";
import { widgetAddress } from "../../../../src/core/widgets/widget-address.ts";

describe("widgetAddress", () => {
  test("reads each common form of a GitHub address into one form", () => {
    for (const text of [
      "https://github.com/Example-Owner/habits-widget",
      "https://github.com/Example-Owner/habits-widget.git",
      "https://github.com/Example-Owner/habits-widget/",
      "github.com/Example-Owner/habits-widget",
      "Example-Owner/habits-widget",
      "git@github.com:Example-Owner/habits-widget.git",
      "  https://github.com/Example-Owner/habits-widget  ",
    ]) {
      expect(widgetAddress(text)).toEqual({
        id: "example-owner/habits-widget",
        owner: "Example-Owner",
        name: "habits-widget",
        url: "https://github.com/Example-Owner/habits-widget",
      });
    }
  });

  test("refuses another site, a path that leaves the name, and names that GitHub never gives", () => {
    for (const text of [
      "",
      "https://evil.example/github.com/owner/name",
      "https://github.com/owner/name/tree/main",
      "https://github.com/../name",
      "https://github.com/owner/..",
      "-owner/name",
      `${"a".repeat(40)}/name`,
      `owner/${"a".repeat(101)}`,
      "owner/name?x=1",
      "http://github.com/owner/name",
    ]) {
      expect(widgetAddress(text)).toBeNull();
    }
  });
});

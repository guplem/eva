import { describe, expect, test } from "bun:test";
import { baseWidgets } from "../../../../src/core/widgets/base-widgets.ts";
import { widgetAddress } from "../../../../src/core/widgets/widget-address.ts";

describe("baseWidgets", () => {
  test("ships the habits and weather widgets, by name", () => {
    expect(baseWidgets).toEqual([
      { url: "https://github.com/guplem/eva-widget-habits", name: "Habits" },
      { url: "https://github.com/guplem/eva-widget-weather", name: "Weather" },
    ]);
  });

  test("each address is a widget address", () => {
    for (const widget of baseWidgets) expect(widgetAddress(widget.url)?.url).toBe(widget.url);
  });
});

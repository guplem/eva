import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, iconNames, type IconName } from "../../../../../src/frontends/web/client/icons.tsx";

// The icons of the EVE design reference: the ones that issue 164 asks for, and the ones added after.
const designIcons: readonly IconName[] = [
  "chat",
  "folder",
  "briefcase",
  "clock",
  "gear",
  "plus",
  "search",
  "send",
  "clip",
  "check",
  "x",
  "file",
  "pen",
  "term",
  "fork",
  "branch",
  "sync",
  "more",
  "menu",
  "back",
  "bolt",
  "shield",
  "phone",
  "laptop",
  "alert",
  "wifi-off",
  "download",
  "copy",
  "sun",
  "moon",
  "bell",
  "globe",
  "key",
  "calendar",
  "down",
  "restart",
  "palette",
  "trash",
  "info",
  "lock",
  "eye",
  "external",
  "play",
  "stop",
  "user",
  "home",
  "mic",
  "expand",
  "shrink",
];

function render(name: IconName, label?: string): string {
  return renderToStaticMarkup(createElement(Icon, label === undefined ? { name } : { name, label }));
}

describe("Icon", () => {
  test("the set has each icon of the design, and no other", () => {
    expect([...iconNames].sort()).toEqual([...designIcons].sort());
  });

  test.each(designIcons)("%s is a line drawing on a 24 px grid in the colour of the text", (name) => {
    const svg = render(name);
    expect(svg).toStartWith('<svg class="icon"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1.8"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toMatch(/<(path|circle|rect) /);
  });

  test("the gear is a cog with teeth, so it does not look like the sun", () => {
    const gear = render("gear");
    expect(gear).not.toEqual(render("sun"));
    expect(gear).toMatch(/<path d="M[^"]+z"/);
  });

  test("an icon without a name is hidden from a screen reader", () => {
    const svg = render("menu");
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain("role=");
  });

  test("an icon with a name is an image with that name", () => {
    const svg = render("check", "Passed");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Passed"');
    expect(svg).not.toContain("aria-hidden");
  });
});

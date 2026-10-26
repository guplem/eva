import { describe, expect, test } from "bun:test";
import {
  festiveArt,
  festiveIconSvg,
  sceneMarkup,
  type FestiveScene,
} from "../../../../../src/frontends/web/client/festive-art.ts";
import type { SpecialDayId } from "../../../../../src/frontends/web/client/special-days.ts";

const scenes: readonly FestiveScene[] = [
  "snow",
  "confetti",
  "leaves",
  "stars",
  "meteors",
  "shootingStar",
  "bee",
  "smoke",
];

describe("festiveArt", () => {
  test("gives each day two eyes, a motion and a hue", () => {
    for (const [id, art] of Object.entries(festiveArt)) {
      expect(`${id} ${String(art.eyes.every((eye) => eye.startsWith("<")))}`).toBe(`${id} true`);
      expect(art.motion).toMatch(/^f-[a-z]+$/);
      expect(art.hue).toBeGreaterThanOrEqual(0);
      expect(art.hue).toBeLessThan(360);
    }
  });

  test("closes every tag of its eyes and decorations", () => {
    for (const art of Object.values(festiveArt)) {
      for (const markup of [...art.eyes, art.decoration ?? ""]) {
        const opened = (markup.match(/<(?!\/)[a-zA-Z]+[^>]*[^/]>/g) ?? []).length;
        const closed = (markup.match(/<\/[a-zA-Z]+>/g) ?? []).length;
        expect(closed).toBe(opened);
      }
    }
  });
});

describe("sceneMarkup", () => {
  test("draws each scene", () => {
    for (const scene of scenes) expect(sceneMarkup(scene)).toMatch(/^<(span|svg) class="f-/);
  });

  const skyStars = [
    ...sceneMarkup("shootingStar").matchAll(
      /class="f-star f-sky( f-fade)?" style="left:(\d+)%;top:(\d+)%;--size:([\d.]+)em;opacity:([\d.]+)/g,
    ),
  ].map(([, fade, left, top, size, brightness]) => ({
    twinkles: fade !== undefined,
    left: Number(left),
    top: Number(top),
    size: Number(size),
    brightness: Number(brightness),
  }));

  test("gives the full moon one shooting star and a sky of many tiny stars", () => {
    expect(festiveArt.fullMoon.scene).toBe("shootingStar");
    expect(sceneMarkup("shootingStar").match(/class="f-meteor f-shoot"/g)).toHaveLength(1);
    expect(skyStars.length).toBeGreaterThanOrEqual(20);
    expect(new Set(skyStars.map((star) => star.size)).size).toBeGreaterThan(1);
    expect(new Set(skyStars.map((star) => star.brightness)).size).toBeGreaterThan(1);
  });

  test("lets only a few full moon stars twinkle, so most of the sky always shows", () => {
    const twinkling = skyStars.filter((star) => star.twinkles).length;
    expect(twinkling).toBeGreaterThan(0);
    expect(twinkling).toBeLessThan(skyStars.length / 3);
  });

  test("scatters the full moon stars with no mirror pairs", () => {
    const spots = skyStars.map((star) => [star.left, star.top] as const);
    for (const [left, top] of spots) {
      expect(spots.some(([otherLeft, otherTop]) => otherLeft === 100 - left && otherTop === top)).toBe(false);
    }
  });

  test("gives each leaf a colour", () => {
    expect(sceneMarkup("leaves")).not.toContain("background:;");
  });
});

describe("festiveIconSvg", () => {
  test("draws the visor with both eyes of the day in its colour", () => {
    const icon = festiveIconSvg("halloween");
    expect(icon.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(icon).toContain(festiveArt.halloween.eyes[0]);
    expect(icon).toContain(festiveArt.halloween.eyes[1]);
    expect(icon).toContain("oklch(0.74 0.19 55)");
  });

  test("works for every day", () => {
    for (const id of Object.keys(festiveArt) as SpecialDayId[]) expect(festiveIconSvg(id)).toEndWith("</svg>");
  });
});

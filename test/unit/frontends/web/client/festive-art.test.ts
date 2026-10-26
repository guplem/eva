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

  test("gives the full moon one shooting star and no fixed stars", () => {
    expect(festiveArt.fullMoon.scene).toBe("shootingStar");
    const markup = sceneMarkup("shootingStar");
    expect(markup.match(/class="f-meteor f-shoot"/g)).toHaveLength(1);
    expect(markup).not.toContain("f-star");
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

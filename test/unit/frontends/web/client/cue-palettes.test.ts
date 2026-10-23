import { describe, expect, test } from "bun:test";
import { note, palettes } from "../../../../../src/frontends/web/client/cue-palettes.ts";
import { cues } from "../../../../../src/frontends/web/client/cues.ts";

const end = (voices: readonly { readonly at?: number; readonly seconds: number }[]): number =>
  Math.max(...voices.map((voice) => (voice.at ?? 0) + voice.seconds));

describe("note", () => {
  test("gives the pitch of a note name", () => {
    expect(note("A4")).toBe(440);
    expect(note("A5")).toBe(880);
    expect(note("C4")).toBeCloseTo(261.63, 2);
    expect(note("F#6")).toBeCloseTo(1479.98, 2);
  });

  test("refuses a name that is not a note", () => {
    expect(() => note("H2")).toThrow();
  });
});

describe("palettes", () => {
  test("the person's favourites come first, Coin as the default", () => {
    expect(palettes.slice(0, 4).map((palette) => palette.id)).toEqual(["coin", "orbit", "fluent", "kalimba"]);
  });

  test("each palette has its own id, label and icon", () => {
    for (const key of ["id", "label", "icon"] as const) {
      expect(new Set(palettes.map((palette) => palette[key])).size).toBe(palettes.length);
    }
  });

  test("each palette sounds every cue", () => {
    for (const palette of palettes) {
      for (const cue of cues) expect(palette.cues[cue].length, `${palette.id} ${cue}`).toBeGreaterThan(0);
    }
  });

  test("a tap is short, because a person taps often", () => {
    for (const palette of palettes) expect(end(palette.cues.tap), palette.id).toBeLessThanOrEqual(0.2);
  });

  test("every cue ends in less than 1.5 seconds, so it does not talk over the next one for long", () => {
    for (const palette of palettes) {
      for (const cue of cues) expect(end(palette.cues[cue]), `${palette.id} ${cue}`).toBeLessThan(1.5);
    }
  });

  test("EVE's answer is her call: a high note, then a lower one", () => {
    const [ee, vah] = palettes.find((palette) => palette.id === "eve")?.cues.answer ?? [];
    expect(vah?.at).toBeGreaterThan(ee?.at ?? 0);
    expect(vah?.to).toBeLessThan(ee?.pitch ?? 0);
  });
});

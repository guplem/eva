import { describe, expect, test } from "bun:test";
import {
  easterSunday,
  seasonInstant,
  specialDayOn,
  type PersonalFacts,
  type SpecialDayId,
} from "../../../../../src/frontends/web/client/special-days.ts";

/** Noon on a local calendar day, so no time zone moves it to the next or the last day. */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12);
}

function idOn(year: number, month: number, day: number): SpecialDayId | null {
  return specialDayOn(on(year, month, day))?.id ?? null;
}

describe("specialDayOn", () => {
  test("finds each fixed day", () => {
    const fixed: readonly [number, number, SpecialDayId][] = [
      [1, 1, "newYear"],
      [12, 31, "newYear"],
      [1, 5, "kings"],
      [1, 6, "kings"],
      [2, 14, "valentine"],
      [3, 8, "womensDay"],
      [3, 14, "piDay"],
      [4, 20, "fourTwenty"],
      [4, 22, "earthDay"],
      [4, 23, "santJordi"],
      [5, 20, "beeDay"],
      [6, 23, "santJoan"],
      [6, 24, "santJoan"],
      [6, 28, "pride"],
      [8, 8, "catDay"],
      [8, 12, "perseids"],
      [8, 13, "perseids"],
      [8, 26, "dogDay"],
      [10, 1, "coffeeDay"],
      [10, 31, "halloween"],
      [11, 1, "allSaints"],
      [11, 2, "allSaints"],
      [12, 24, "christmas"],
      [12, 25, "christmas"],
      [12, 26, "christmas"],
    ];
    for (const [month, day, id] of fixed)
      expect(`${month}-${day} ${idOn(2023, month, day)}`).toBe(`${month}-${day} ${id}`);
  });

  test("finds nothing on an ordinary day", () => {
    expect(idOn(2023, 7, 18)).toBeNull();
    expect(idOn(2023, 3, 2)).toBeNull();
  });

  test("finds Easter Sunday and Monday, and the four days of Carnival before Ash Wednesday", () => {
    expect(idOn(2026, 4, 5)).toBe("easter");
    expect(idOn(2026, 4, 6)).toBe("easter");
    expect(idOn(2026, 4, 7)).toBeNull();
    // Ash Wednesday 2026 is 18 February.
    expect(idOn(2026, 2, 14)).toBe("valentine");
    expect(idOn(2026, 2, 15)).toBe("carnival");
    expect(idOn(2026, 2, 17)).toBe("carnival");
    expect(idOn(2026, 2, 18)).toBeNull();
  });

  test("lets a holiday win over a world day on the same date", () => {
    // Easter Sunday 2025 falls on 20 April.
    expect(idOn(2025, 4, 20)).toBe("easter");
  });

  test("finds day 256 of the year, which moves in a leap year", () => {
    expect(idOn(2023, 9, 13)).toBe("programmersDay");
    expect(idOn(2024, 9, 12)).toBe("programmersDay");
  });

  test("finds 29 February and Friday the 13th", () => {
    expect(idOn(2024, 2, 29)).toBe("leapDay");
    expect(idOn(2026, 11, 13)).toBe("fridayThe13th");
    expect(idOn(2026, 11, 12)).toBeNull();
  });

  test("finds the day of a full moon", () => {
    // Full moons on 25 January 2024 at 17:54 UTC and on 7 October 2025 at 03:48 UTC.
    const full = new Date(Date.UTC(2024, 0, 25, 17, 54));
    expect(specialDayOn(full)?.id).toBe("fullMoon");
    expect(specialDayOn(new Date(full.getTime() - 2 * 86_400_000))?.id).toBeUndefined();
    expect(specialDayOn(new Date(Date.UTC(2025, 9, 7, 3, 48)))?.id).toBe("fullMoon");
  });

  test("finds the day of each solstice and equinox", () => {
    const seasons = [
      ["march", "springEquinox"],
      ["june", "summerSolstice"],
      ["september", "autumnEquinox"],
      ["december", "winterSolstice"],
    ] as const;
    for (const [season, id] of seasons) expect(specialDayOn(seasonInstant(2025, season))?.id).toBe(id);
  });

  test("puts the person's birthday first, on its day of each year", () => {
    const personal = { birthDate: "1990-12-25", installedOn: null };
    expect(specialDayOn(on(2026, 12, 25), personal)?.id).toBe("birthday");
    expect(specialDayOn(on(2026, 12, 24), personal)?.id).toBe("christmas");
  });

  test("moves a birthday on 29 February to 28 February in other years", () => {
    const personal = { birthDate: "2000-02-29", installedOn: null };
    expect(specialDayOn(on(2027, 2, 28), personal)?.id).toBe("birthday");
    expect(specialDayOn(on(2024, 2, 28), personal)?.id).toBeUndefined();
    expect(specialDayOn(on(2024, 2, 29), personal)?.id).toBe("birthday");
  });

  test("counts the years since Eva's install, from the first anniversary", () => {
    const personal = { birthDate: null, installedOn: "2024-07-18" };
    expect(specialDayOn(on(2024, 7, 18), personal)).toBeNull();
    expect(specialDayOn(on(2025, 7, 18), personal)?.greeting).toBe("One year together!");
    expect(specialDayOn(on(2027, 7, 18), personal)?.greeting).toBe("3 years together!");
  });

  test("ignores a personal date that is not a real date", () => {
    expect(specialDayOn(on(2023, 7, 18), { birthDate: "someday", installedOn: "2023-13-40" })).toBeNull();
  });

  test("gives each day a greeting and a line", () => {
    const day = specialDayOn(on(2023, 10, 31));
    expect(day?.greeting).toBe("Happy Halloween!");
    expect(day?.line.length).toBeGreaterThan(0);
  });
});

describe("easterSunday", () => {
  test("follows the Gregorian computus", () => {
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2038)).toEqual({ month: 4, day: 25 });
  });
});

describe("seasonInstant", () => {
  test("is within an hour of the published times", () => {
    const published = [
      ["march", Date.UTC(2024, 2, 20, 3, 6)],
      ["june", Date.UTC(2024, 5, 20, 20, 51)],
      ["september", Date.UTC(2024, 8, 22, 12, 44)],
      ["december", Date.UTC(2024, 11, 21, 9, 20)],
    ] as const;
    for (const [season, at] of published) {
      expect(Math.abs(seasonInstant(2024, season).getTime() - at)).toBeLessThan(3_600_000);
    }
  });
});

describe("the person's place", () => {
  const facts = (region: string | null, hemisphere: "north" | "south" | null = null): PersonalFacts => ({
    birthDate: null,
    installedOn: null,
    region,
    hemisphere,
  });

  test("shows a local day only where people keep it, or when Eva does not know the region", () => {
    expect(specialDayOn(on(2023, 4, 23), facts("ES-CT"))?.id).toBe("santJordi");
    expect(specialDayOn(on(2023, 4, 23), facts(null))?.id).toBe("santJordi");
    expect(specialDayOn(on(2023, 4, 23), facts("ES-MD"))).toBeNull();
    expect(specialDayOn(on(2023, 6, 24), facts("FI"))?.id).toBe("santJoan");
    expect(specialDayOn(on(2023, 6, 24), facts("US"))).toBeNull();
    expect(specialDayOn(on(2024, 1, 6), facts("MX"))?.id).toBe("kings");
    expect(specialDayOn(on(2024, 1, 6), facts("GB"))).toBeNull();
  });

  test("turns the seasons around in the southern hemisphere", () => {
    expect(specialDayOn(seasonInstant(2025, "december"), facts("AU", "south"))?.id).toBe("summerSolstice");
    expect(specialDayOn(seasonInstant(2025, "march"), facts("AU", "south"))?.id).toBe("autumnEquinox");
    expect(specialDayOn(seasonInstant(2025, "june"), facts("AU", "south"))?.id).toBe("winterSolstice");
    expect(specialDayOn(seasonInstant(2025, "september"), facts("AU", "south"))?.id).toBe("springEquinox");
  });
});

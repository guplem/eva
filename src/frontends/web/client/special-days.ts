/**
 * The special days on which EVE's visor shows festive eyes, and the greeting of each one. A day is
 * a surprise: no setting turns it off, and no page lists the days. All dates are local calendar days.
 */

export type SpecialDayId =
  | "birthday"
  | "anniversary"
  | "newYear"
  | "kings"
  | "valentine"
  | "carnival"
  | "easter"
  | "santJordi"
  | "santJoan"
  | "pride"
  | "halloween"
  | "allSaints"
  | "christmas"
  | "springEquinox"
  | "summerSolstice"
  | "autumnEquinox"
  | "winterSolstice"
  | "perseids"
  | "womensDay"
  | "piDay"
  | "fourTwenty"
  | "earthDay"
  | "beeDay"
  | "catDay"
  | "dogDay"
  | "programmersDay"
  | "coffeeDay"
  | "leapDay"
  | "fridayThe13th"
  | "fullMoon";

export interface SpecialDay {
  readonly id: SpecialDayId;
  /** Replaces the greeting for the hour. */
  readonly greeting: string;
  /** Replaces the line under the greeting. */
  readonly line: string;
}

/** What Eva knows about the person, from `Life/About me.md`. Null when she does not know it. */
export interface PersonalFacts {
  /** `YYYY-MM-DD`. */
  readonly birthDate: string | null;
  /** The day that Eva started on the vault, as `YYYY-MM-DD`. */
  readonly installedOn: string | null;
  /** An ISO 3166 code, such as `ES` or `ES-CT`. With no region, every local day shows. */
  readonly region?: string | null;
  /** With no hemisphere, the seasons follow the northern one. */
  readonly hemisphere?: "north" | "south" | null;
}

const noPersonalFacts: PersonalFacts = { birthDate: null, installedOn: null };

interface CalendarDay {
  readonly date: Date;
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
}

export type Season = "march" | "june" | "september" | "december";

const dayMs = 86_400_000;

/** The Julian day of the Unix epoch. */
const unixEpochJulianDay = 2440587.5;

function sameDay(a: Date, b: CalendarDay): boolean {
  return a.getFullYear() === b.year && a.getMonth() + 1 === b.month && a.getDate() === b.day;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The anonymous Gregorian computus. */
export function easterSunday(year: number): { readonly month: number; readonly day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Days from Easter Sunday to this day; negative before it. */
function daysFromEaster(today: CalendarDay): number {
  const easter = easterSunday(today.year);
  const easterNoon = Date.UTC(today.year, easter.month - 1, easter.day);
  return Math.round((Date.UTC(today.year, today.month - 1, today.day) - easterNoon) / dayMs);
}

// Meeus, "Astronomical Algorithms", table 27.b, for the years 2000 to 3000. The mean instant is
// within an hour of the true one. Only an instant that close to local midnight can show a day late or early.
const seasonTerms: Record<Season, readonly number[]> = {
  march: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  june: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
  september: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  december: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
};

/** The instant of a solstice or an equinox. */
export function seasonInstant(year: number, season: Season): Date {
  const y = (year - 2000) / 1000;
  const julianDay = seasonTerms[season].reduce((sum, term, power) => sum + term * y ** power, 0);
  return new Date((julianDay - unixEpochJulianDay) * dayMs);
}

const degrees = Math.PI / 180;

/** The instant of full moon number `k` after January 2000 (Meeus, chapter 49, main terms). */
function fullMoonInstant(k: number): Date {
  const t = k / 1236.85;
  const e = 1 - 0.002516 * t;
  const sun = (2.5534 + 29.1053567 * k) * degrees;
  const moon = (201.5643 + 385.81693528 * k) * degrees;
  const node = (160.7108 + 390.67050284 * k) * degrees;
  const julianDay =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * t * t -
    0.40614 * Math.sin(moon) +
    0.17302 * e * Math.sin(sun) +
    0.01614 * Math.sin(2 * moon) +
    0.01043 * Math.sin(2 * node) +
    0.00734 * e * Math.sin(moon - sun) -
    0.00515 * e * Math.sin(moon + sun) +
    0.00209 * e * e * Math.sin(2 * sun) -
    0.00111 * Math.sin(moon - 2 * node) -
    0.00057 * Math.sin(moon + 2 * node);
  return new Date((julianDay - unixEpochJulianDay) * dayMs);
}

function isFullMoonDay(today: CalendarDay): boolean {
  const julianDay = today.date.getTime() / dayMs + unixEpochJulianDay;
  const nearest = Math.round((julianDay - 2451550.09766) / 29.530588861 - 0.5) + 0.5;
  return [nearest - 1, nearest, nearest + 1].some((k) => sameDay(fullMoonInstant(k), today));
}

/** A date as `YYYY-MM-DD`, or a birthday with no year as `--MM-DD`, which reads as in the leap year 2000. */
function parseDate(text: string | null): CalendarDay | null {
  const match = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (match === null) return null;
  const year = match[1] === "-" ? 2000 : Number(match[1]);
  const [month, day] = [Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 12);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, year, month, day };
}

/** True on the date's day in each year. 29 February falls on 28 February in other years. */
function isYearlyDay(personal: CalendarDay, today: CalendarDay): boolean {
  if (personal.month === 2 && personal.day === 29 && !isLeapYear(today.year)) {
    return today.month === 2 && today.day === 28;
  }
  return today.month === personal.month && today.day === personal.day;
}

function dayOfYear(today: CalendarDay): number {
  return Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(today.year, 0, 1)) / dayMs) + 1;
}

/** The days with fixed words. The anniversary counts its years, so it has words of its own. */
type WordedDayId = Exclude<SpecialDayId, "anniversary">;

interface Rule {
  readonly id: WordedDayId;
  readonly on: (today: CalendarDay, facts: PersonalFacts) => boolean;
}

function fixed(id: WordedDayId, ...dates: readonly (readonly [number, number])[]): Rule {
  return { id, on: (today) => dates.some(([month, day]) => today.month === month && today.day === day) };
}

/** A solstice or an equinox. In the southern hemisphere, the March equinox starts autumn. */
function season(id: WordedDayId, which: Season, hemisphere: "north" | "south"): Rule {
  return {
    id,
    on: (today, facts) =>
      (facts.hemisphere ?? "north") === hemisphere && sameDay(seasonInstant(today.year, which), today),
  };
}

/**
 * A day that only some places keep, by the start of their ISO 3166 code. A person whose region
 * Eva does not know sees every local day.
 */
function local(rule: Rule, places: readonly string[]): Rule {
  return {
    id: rule.id,
    on: (today, facts) => {
      const region = facts.region ?? null;
      return (region === null || places.some((place) => region.startsWith(place))) && rule.on(today, facts);
    },
  };
}

const spanishSpeaking = [
  "ES",
  "GQ",
  "PH",
  "MX",
  "AR",
  "CO",
  "PE",
  "VE",
  "CL",
  "UY",
  "PY",
  "BO",
  "EC",
  "GT",
  "HN",
  "SV",
  "NI",
  "CR",
  "PA",
  "DO",
  "PR",
  "CU",
];

// The first rule that matches wins: holidays, then the cycle of the year, the world days and the curiosities.
const rules: readonly Rule[] = [
  fixed("newYear", [12, 31], [1, 1]),
  local(fixed("kings", [1, 5], [1, 6]), spanishSpeaking),
  fixed("valentine", [2, 14]),
  // From the Saturday to Shrove Tuesday, the day before Ash Wednesday.
  { id: "carnival", on: (today) => daysFromEaster(today) >= -50 && daysFromEaster(today) <= -47 },
  { id: "easter", on: (today) => daysFromEaster(today) === 0 || daysFromEaster(today) === 1 },
  local(fixed("santJordi", [4, 23]), ["ES-CT", "ES-AR", "AD"]),
  local(fixed("santJoan", [6, 23], [6, 24]), ["ES", "PT", "AD", "FI", "SE", "NO", "DK", "EE", "LV", "LT"]),
  fixed("pride", [6, 28]),
  fixed("halloween", [10, 31]),
  fixed("allSaints", [11, 1], [11, 2]),
  fixed("christmas", [12, 24], [12, 25], [12, 26]),
  season("springEquinox", "march", "north"),
  season("summerSolstice", "june", "north"),
  season("autumnEquinox", "september", "north"),
  season("winterSolstice", "december", "north"),
  season("autumnEquinox", "march", "south"),
  season("winterSolstice", "june", "south"),
  season("springEquinox", "september", "south"),
  season("summerSolstice", "december", "south"),
  fixed("perseids", [8, 12], [8, 13]),
  fixed("womensDay", [3, 8]),
  fixed("piDay", [3, 14]),
  fixed("fourTwenty", [4, 20]),
  fixed("earthDay", [4, 22]),
  fixed("beeDay", [5, 20]),
  fixed("catDay", [8, 8]),
  fixed("dogDay", [8, 26]),
  { id: "programmersDay", on: (today) => dayOfYear(today) === 256 },
  fixed("coffeeDay", [10, 1]),
  fixed("leapDay", [2, 29]),
  { id: "fridayThe13th", on: (today) => today.day === 13 && today.date.getDay() === 5 },
  { id: "fullMoon", on: isFullMoonDay },
];

const words: Record<WordedDayId, readonly [string, string]> = {
  birthday: ["Happy birthday!", "It is your day. Shall we celebrate?"],
  newYear: ["Cheers to the new year!", "A fresh start. What comes first?"],
  kings: ["Happy Three Kings Day!", "What can I do for you today?"],
  valentine: ["Happy Valentine's Day!", "What can I do for you today?"],
  carnival: ["Happy Carnival!", "How can I help today?"],
  easter: ["Happy Easter!", "Any eggs to find today?"],
  santJordi: ["A rose and a book.", "Happy Sant Jordi. What are you reading?"],
  santJoan: ["Happy Midsummer!", "Anything to throw in the fire tonight?"],
  pride: ["Happy Pride!", "Everyone belongs. How can I help?"],
  halloween: ["Happy Halloween!", "Boo. What shall we haunt today?"],
  allSaints: ["A day to remember.", "A calm day. How can I help?"],
  christmas: ["Merry Christmas!", "Warm wishes. How can I help today?"],
  springEquinox: ["Spring is here.", "Day and night are equal today. What shall we grow?"],
  summerSolstice: ["The longest day.", "Lots of light today. How can I help?"],
  autumnEquinox: ["Autumn begins.", "The leaves are falling. What shall we tidy up?"],
  winterSolstice: ["The longest night.", "From today, the days grow longer."],
  perseids: ["Make a wish.", "Shooting stars tonight. Look up!"],
  womensDay: ["Happy Women's Day!", "Equal rights, every day."],
  piDay: ["3.14159…", "Happy Pi Day. What shall we calculate?"],
  fourTwenty: ["Happy 4/20!", "A calm day. How can I help?"],
  earthDay: ["Happy Earth Day!", "One planet. How can I help today?"],
  beeDay: ["Buzz buzz.", "It is World Bee Day. What shall we build?"],
  catDay: ["Meow.", "It is International Cat Day. How can I help?"],
  dogDay: ["Woof!", "It is International Dog Day. How can I help?"],
  programmersDay: ["Hello, world.", "Day 256 of the year. Shall we ship something?"],
  coffeeDay: ["Coffee first.", "It is Coffee Day. What are we working on?"],
  leapDay: ["A bonus day.", "This day comes once in four years. What shall we do with it?"],
  fridayThe13th: ["Friday the 13th.", "I brought horseshoes for luck. How can I help?"],
  fullMoon: ["Full moon tonight.", "A bright night. How can I help?"],
};

function dayOf(id: WordedDayId): SpecialDay {
  const [greeting, line] = words[id];
  return { id, greeting, line };
}

function personalDay(today: CalendarDay, personal: PersonalFacts): SpecialDay | null {
  const birthDate = parseDate(personal.birthDate);
  if (birthDate !== null && isYearlyDay(birthDate, today)) return dayOf("birthday");
  const installedOn = parseDate(personal.installedOn);
  if (installedOn === null || !isYearlyDay(installedOn, today)) return null;
  const years = today.year - installedOn.year;
  if (years < 1) return null;
  const greeting = years === 1 ? "One year together!" : `${String(years)} years together!`;
  return { id: "anniversary", greeting, line: "Thank you for this time. What comes next?" };
}

/** The special day of a date, or null on an ordinary day. The person's own days come first. */
export function specialDayOn(date: Date, personal: PersonalFacts = noPersonalFacts): SpecialDay | null {
  const today: CalendarDay = { date, year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  const own = personalDay(today, personal);
  if (own !== null) return own;
  const rule = rules.find((each) => each.on(today, personal));
  return rule === undefined ? null : dayOf(rule.id);
}

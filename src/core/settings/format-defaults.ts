/**
 * The format settings of a new vault (#770). Setup asks only for the answer language. The time
 * zone, the clock, the week start and the units come from the computer that runs setup ("Plug and
 * play" in `AGENTS.md`): the web page sends the browser's locale and zone, since the hub is often
 * a server with no locale of its own. A computer with no locale set leaves the forms empty, never
 * the US forms of the engine's fallback. A setting that holds a value, such as one that a cloned
 * vault brought, stays.
 */
import type { Clock, Units, WeekStart } from "../../shared/time-format.ts";
import { weekStarts } from "../../shared/time-format.ts";
import type { EvaConfig, HomePaths } from "./home.ts";
import { changeSettings, loadSettings } from "./settings.ts";

export interface LocalFormats {
  readonly timeZone: string;
  /** Null when the computer has no locale set. */
  readonly clock: Clock | null;
  /** Null when this JavaScript engine cannot tell the locale's week. */
  readonly weekStart: WeekStart | null;
  /** Null for a locale with no region. */
  readonly units: Units | null;
}

/** The regions that measure in imperial units. */
const imperialRegions = new Set(["US", "LR", "MM"]);

/** The variables that set a computer's locale. With none, or only `C` or `POSIX`, the engine falls back to `en-US`. */
const localeVariables = ["LC_ALL", "LC_TIME", "LC_MESSAGES", "LANG"] as const;

/** True when the computer names a real locale, such as `es_ES.UTF-8`. Windows and macOS always have one. */
export function hasLocale(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return localeVariables.some((name) => {
    const value = environment[name]?.trim() ?? "";
    return value !== "" && !/^(C|POSIX)([._@].*)?$/.test(value);
  });
}

/**
 * The forms of a locale, such as `en-US`. No locale: the computer's own, or no forms when the
 * computer has none set. An unknown locale or zone, such as a bad one from a page, is skipped.
 */
export function localFormats(locale?: string, timeZone?: string, machineHasLocale = hasLocale()): LocalFormats {
  const zone = validZone(timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const given = validLocale(locale);
  if (given === undefined && !machineHasLocale) return { timeZone: zone, clock: null, weekStart: null, units: null };
  return { ...formsOf(given), timeZone: zone };
}

function formsOf(locale: string | undefined): LocalFormats {
  const format = new Intl.DateTimeFormat(locale, { hour: "numeric" });
  const options = format.resolvedOptions();
  const hourCycle = options.hourCycle;
  const parsed = new Intl.Locale(locale ?? options.locale);
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    clock: hourCycle === "h11" || hourCycle === "h12" ? "12h" : "24h",
    weekStart: weekStartOf(parsed),
    units: parsed.region === undefined ? null : imperialRegions.has(parsed.region) ? "imperial" : "metric",
  };
}

function validLocale(locale: string | undefined): string | undefined {
  if (locale === undefined || locale.trim() === "") return undefined;
  try {
    return new Intl.Locale(locale.trim()).toString();
  } catch {
    return undefined;
  }
}

function validZone(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined || timeZone.trim() === "") return undefined;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timeZone.trim() });
    return timeZone.trim();
  } catch {
    return undefined;
  }
}

/** `getWeekInfo()` in newer engines, `weekInfo` in older ones. `firstDay` counts Monday as 1 and Sunday as 7. */
function weekStartOf(locale: Intl.Locale): WeekStart | null {
  // Typed loosely: the TypeScript library may name either form, and an older engine has neither.
  const withWeek: { getWeekInfo?: unknown; weekInfo?: unknown } = locale;
  try {
    const info: unknown =
      typeof withWeek.getWeekInfo === "function"
        ? (withWeek.getWeekInfo as () => unknown).call(locale)
        : withWeek.weekInfo;
    const firstDay = typeof info === "object" && info !== null ? (info as { firstDay?: unknown }).firstDay : undefined;
    return typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7 ? (weekStarts[firstDay % 7] ?? null) : null;
  } catch {
    return null;
  }
}

/** The change for a new vault: the answer language, and each local form whose setting is still empty. */
export function newVaultSettings(
  config: Pick<EvaConfig, "timeZone" | "clock" | "weekStart" | "units">,
  language: string,
  local: LocalFormats,
): Record<string, unknown> {
  return {
    language,
    ...(config.timeZone === null ? { timeZone: local.timeZone } : {}),
    ...(config.clock === null && local.clock !== null ? { clock: local.clock } : {}),
    ...(config.weekStart === null && local.weekStart !== null ? { weekStart: local.weekStart } : {}),
    ...(config.units === null && local.units !== null ? { units: local.units } : {}),
  };
}

/** Saves the settings of a new vault, after its folder is saved, so they go to the vault. */
export function saveNewVaultSettings(paths: HomePaths, language: string, local: LocalFormats = localFormats()): void {
  changeSettings(paths, newVaultSettings(loadSettings(paths).config, language, local));
}

/**
 * The format settings of a new vault (#770). Setup asks only for the answer language. The time
 * zone, the clock, the week start and the units come from the computer that runs setup ("Plug and
 * play" in `AGENTS.md`). A setting that holds a value, such as one that a cloned vault brought, stays.
 */
import type { Clock, Units, WeekStart } from "../../shared/time-format.ts";
import { weekStarts } from "../../shared/time-format.ts";
import type { EvaConfig, HomePaths } from "./home.ts";
import { changeSettings, loadSettings } from "./settings.ts";

export interface LocalFormats {
  readonly timeZone: string;
  readonly clock: Clock;
  /** Null when this JavaScript engine cannot tell the locale's week. */
  readonly weekStart: WeekStart | null;
  /** Null for a locale with no region. */
  readonly units: Units | null;
}

/** The regions that measure in imperial units. */
const imperialRegions = new Set(["US", "LR", "MM"]);

/** The forms of a locale, such as `en-US`. No locale: the computer's own. */
export function localFormats(locale?: string): LocalFormats {
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
    ...(config.clock === null ? { clock: local.clock } : {}),
    ...(config.weekStart === null && local.weekStart !== null ? { weekStart: local.weekStart } : {}),
    ...(config.units === null && local.units !== null ? { units: local.units } : {}),
  };
}

/** Saves the settings of a new vault, after its folder is saved, so they go to the vault. */
export function saveNewVaultSettings(paths: HomePaths, language: string, local: LocalFormats = localFormats()): void {
  changeSettings(paths, newVaultSettings(loadSettings(paths).config, language, local));
}

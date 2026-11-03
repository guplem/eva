/**
 * The person's format settings (#770): the answer language, the time zone, the units, the clock and
 * the first day of the week. Eva puts them in the prompt of each new Assistant chat, after the pinned
 * files, and the screens follow the clock and the week start.
 */
import type { Clock, Units, WeekStart } from "../../shared/time-format.ts";
import type { EvaConfig } from "../settings/home.ts";
import { readOldFormatFields } from "../vault/about-me.ts";

export interface FormatSettings {
  readonly language: string | null;
  readonly timeZone: string | null;
  readonly units: Units | null;
  readonly clock: Clock | null;
  readonly weekStart: WeekStart | null;
}

type FormatConfig = Pick<EvaConfig, "language" | "timeZone" | "units" | "clock" | "weekStart">;

/**
 * The settings, and for a null one the old field of `Life/About me.md`: a satellite can run before
 * the hub moves the fields to the settings. Remove the fallback one release after #770.
 */
export function formatSettingsOf(config: FormatConfig, vaultPath: string | null): FormatSettings {
  const missing = config.units === null || config.clock === null || config.weekStart === null;
  const old = vaultPath === null || !missing ? null : readOldFormatFields(vaultPath);
  return {
    language: config.language,
    timeZone: config.timeZone,
    units: config.units ?? old?.units ?? null,
    clock: config.clock ?? old?.clock ?? null,
    weekStart: config.weekStart ?? old?.weekStart ?? null,
  };
}

const notSet = "not set";

/** The block of the prompt, built once for each chat so the prompt cache holds (lesson 40). */
export function formatBlock(settings: FormatSettings): string {
  return [
    "# The person's format settings",
    "",
    `- Answer language: ${settings.language ?? notSet}`,
    `- Time zone: ${settings.timeZone ?? notSet}`,
    `- Units: ${settings.units ?? notSet}`,
    `- Clock: ${settings.clock ?? notSet}`,
    `- First day of the week: ${settings.weekStart ?? notSet}`,
    "",
    "These settings win over any older rule about the answer language, dates, times or units.",
    "",
  ].join("\n");
}

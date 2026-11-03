/**
 * The values of the "Language and formats" card (#770), apart from its markup. "" is "not set".
 * The card starts from the values in use, so a value that a vault not yet migrated keeps only in
 * About me shows, and after a save its baseline is what the person saved.
 */
import type { Clock, DisplayFormat, Units, WeekStart } from "../../../shared/time-format.ts";

export interface FormatForm {
  readonly language: string;
  readonly units: Units | "";
  readonly clock: Clock | "";
  readonly weekStart: WeekStart | "";
}

interface FormatValues {
  readonly language?: string | null;
  readonly units?: Units | null;
  readonly clock?: Clock | null;
  readonly weekStart?: WeekStart | null;
}

/** The settings first, then the values in use from the status, then the page's display format. */
export function formatFormOf(
  config: FormatValues,
  used: FormatValues | undefined,
  fallback: DisplayFormat,
): FormatForm {
  return {
    language: config.language ?? used?.language ?? "",
    units: config.units ?? used?.units ?? "",
    clock: config.clock ?? used?.clock ?? fallback.clock ?? "",
    weekStart: config.weekStart ?? used?.weekStart ?? fallback.weekStart ?? "",
  };
}

export function formatFormChanged(form: FormatForm, baseline: FormatForm): boolean {
  return (
    form.language.trim() !== baseline.language.trim() ||
    form.units !== baseline.units ||
    form.clock !== baseline.clock ||
    form.weekStart !== baseline.weekStart
  );
}

/** The change that Save sends. */
export function formatChange(form: FormatForm): Record<string, string | null> {
  return {
    language: form.language.trim() === "" ? null : form.language.trim(),
    units: form.units === "" ? null : form.units,
    clock: form.clock === "" ? null : form.clock,
    weekStart: form.weekStart === "" ? null : form.weekStart,
  };
}

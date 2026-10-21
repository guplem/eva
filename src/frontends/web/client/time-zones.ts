/** The choices of the time zone list. A list, not free text, so a person cannot save a zone name with a typo. */

export interface TimeZoneChoice {
  readonly value: string;
  readonly label: string;
}

/** The zones that this browser knows. An old browser gives none, and the list then shows only the saved zone. */
export function knownTimeZones(): readonly string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

/** The empty value means the machine's own zone. A saved zone stays in the list even when the browser does not know it. */
export function timeZoneChoices(saved: string, known: readonly string[]): TimeZoneChoice[] {
  const zones = saved === "" || known.includes(saved) ? known : [...known, saved].sort();
  return [
    { value: "", label: "This machine's own" },
    ...zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") })),
  ];
}

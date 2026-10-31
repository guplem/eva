/**
 * The line that a widget adds to the Assistant prompt (#692), with no disk: the core builds it from
 * the approved record, and the web page shows the same line before the approval.
 */

/** One place of a widget's data, and the folder of its `DATA_FORMAT.md`, or null when it has none. */
export interface PromptPlace {
  readonly path: string;
  readonly formatFolder: string | null;
}

/** Text from a widget's author on one line, so it cannot add lines to the prompt or to a file. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The manifest's line with each `{inputId}` replaced by its value, or "(not set)" for an empty input. */
export function filledPrompt(
  prompt: string,
  values: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  return oneLine(
    prompt.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, id: string) =>
      Object.hasOwn(values, id) && values[id] !== undefined ? String(values[id]) : "(not set)",
    ),
  );
}

/** The line of a widget with data and no line of its own, or null for a widget with no data. */
export function defaultPrompt(name: string, places: readonly PromptPlace[]): string | null {
  const widget = oneLine(name);
  const parts = places.map(({ path, formatFolder }) => {
    const where = `${widget} data lives in ${path}.`;
    return formatFolder === null ? where : `${where} Read ${formatFolder}/DATA_FORMAT.md before you write.`;
  });
  return parts.length === 0 ? null : oneLine(parts.join(" "));
}

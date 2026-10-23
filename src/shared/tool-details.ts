/**
 * The whole input and output of a tool call, as text for the step dialog of the web app.
 * Each engine sends them in its own shape, so both adapters use these helpers.
 */

/** Far above a normal output. It only stops a huge one, such as a big file, from filling the memory. */
export const maxDetailLength = 1_000_000;

export function toolInputText(input: unknown): string {
  return input === undefined ? "" : JSON.stringify(input, null, 2);
}

/** Both engines send a text or a list of parts, such as `{ type: "text", text }`. */
export function toolOutputText(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map(partText).join("\n");
  return JSON.stringify(output, null, 2);
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  const record = (part ?? {}) as { type?: unknown; text?: unknown };
  if (typeof record.text === "string") return record.text;
  if (typeof record.type === "string") return `[${record.type}]`;
  return JSON.stringify(part);
}

/**
 * The details that one turn keeps in all. A turn of many big outputs then cannot fill the memory,
 * the reconnect of a phone, or the details file. Past it, a step keeps only its summary.
 */
export const maxTurnDetailLength = 5 * maxDetailLength;

/**
 * Redacts a text that can be JSON. JSON escapes a quote or a new line inside a secret, so the
 * redactor would miss it. So each string in the JSON is redacted before the JSON is written again.
 */
export function redactedJsonText(text: string, redact: (text: string) => string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return redact(text);
  }
  // Only an object or a list can hold an escaped string. A plain output keeps its own shape.
  if (typeof parsed !== "object" || parsed === null) return redact(text);
  return redact(JSON.stringify(redactedValue(parsed, redact), null, 2));
}

function redactedValue(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactedValue(item, redact));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactedValue(item, redact)]));
  }
  return value;
}

/** Cut only after the redaction, so a cut never splits a secret that the redactor then misses (lesson 95). */
export function boundedDetail(text: string): string {
  if (text.length <= maxDetailLength) return text;
  return `${text.slice(0, maxDetailLength)}\n[Eva cut ${String(text.length - maxDetailLength)} characters.]`;
}

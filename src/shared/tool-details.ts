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

/** Cut only after the redaction, so a cut never splits a secret that the redactor then misses (lesson 95). */
export function boundedDetail(text: string): string {
  if (text.length <= maxDetailLength) return text;
  return `${text.slice(0, maxDetailLength)}\n[Eva cut ${String(text.length - maxDetailLength)} characters.]`;
}

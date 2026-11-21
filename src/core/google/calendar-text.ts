/**
 * The description of a Google Calendar event as plain text (#1012). Google keeps the HTML of its
 * editor, such as `<br>` and `<b>`, so Eva removes every tag and decodes the entities. The result
 * is text, never markup: a widget shows it with `textContent`.
 */

/** Google's own limit is about 8 KB. A longer text is cut first, so each step stays short. */
const maxInputLength = 20_000;

/** A tag of HTML, not a lone `<` of a plain text such as "a < b". */
const tagPattern = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;

const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** The description as plain text, or null for no text. */
export function plainDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.slice(0, maxInputLength).replace(/\r\n?/g, "\n");
  if (tagPattern.test(text)) text = withoutTags(text);
  const lines = decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim());
  const folded = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return folded === "" ? null : folded;
}

function withoutTags(html: string): string {
  return (
    html
      // A line break of HTML is a new line; the line breaks of the source are only spaces.
      .replace(/\n/g, " ")
      .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:p|div|ul|ol|h[1-6]|tr|blockquote|pre)\s*>/gi, "\n")
      .replace(/<\/?[a-z!][^>]*>/gi, "")
  );
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return namedEntities[name.toLowerCase()] ?? entity;
  });
}

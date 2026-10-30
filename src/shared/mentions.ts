/**
 * The mentions of a chat message (issue 657): `@project:<id>` and `@file:<vault path>`. The web app
 * writes them, and the core reads them in a chat in a clone (#706).
 */

export type MentionKind = "project" | "file";

/** One mention in a text: its kind, the name it gives, the token as written and where it starts. */
export interface Mention {
  readonly kind: MentionKind;
  readonly name: string;
  readonly token: string;
  readonly start: number;
}

/**
 * A path with a space goes in quotes, so the mention ends at the right place. A path that ends in
 * punctuation does too: without quotes, the note would read the punctuation as the end of a sentence.
 */
export function mentionToken(kind: MentionKind, name: string): string {
  return /[\s"]|[.,;:!?)\]]$/.test(name) ? `@${kind}:"${name.replaceAll('"', "")}"` : `@${kind}:${name}`;
}

/**
 * Each mention of a text, in order. Punctuation after a mention without quotes ends the sentence,
 * not the name. A new pattern each call: a global pattern keeps its place between calls.
 */
export function mentionsIn(text: string): Mention[] {
  const pattern = /(^|\s)@(project|file):(?:"([^"]+)"|(\S+?))(?=[.,;:!?)\]]*(?:\s|$))/g;
  return [...text.matchAll(pattern)].map((match) => {
    const kind = match[2] as MentionKind;
    const name = match[3] ?? match[4] ?? "";
    const lead = match[1] ?? "";
    const start = match.index + lead.length;
    return { kind, name, token: text.slice(start, match.index + match[0].length), start };
  });
}

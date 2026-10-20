/**
 * Removes secrets from text before it reaches a log, a chat or the event stream
 * (lesson 95). Known secret values are replaced exactly; well-known token shapes are
 * replaced by pattern, so a secret Eva never saw is caught too.
 */

const replacement = "[redacted]";
const shortestSecretLength = 8;

const secretPatterns: readonly RegExp[] = [
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, // Anthropic key or OAuth token
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub classic token
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained token
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bGOCSPX-[A-Za-z0-9_-]{20,}/g, // Google OAuth client secret
  /\bya29\.[A-Za-z0-9_-]{30,}/g, // Google access token
  /(?<![\w/])1\/\/0[A-Za-z0-9_-]{40,}/g, // Google refresh token, never inside a path
  /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g, // OpenAI key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
  /\bnpm_[A-Za-z0-9]{30,}\b/g, // npm token
  // A private key, or a header alone when the key is cut short: up to the END line, or to the end of the text.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*$)/g,
];

export class Redactor {
  private readonly knownSecrets: string[];

  constructor() {
    this.knownSecrets = [];
  }

  /** Adds a value to replace wherever it appears. Short values are ignored, to avoid hiding normal words. */
  addSecret(value: string | undefined): void {
    if (value === undefined || value.length < shortestSecretLength || this.knownSecrets.includes(value)) return;
    this.knownSecrets.push(value);
    this.knownSecrets.sort((first, second) => second.length - first.length);
  }

  /** The length of the longest known secret, or 0. A stream holds back this much text. */
  longestSecretLength(): number {
    return this.knownSecrets[0]?.length ?? 0;
  }

  redact(text: string): string {
    let result = text;
    for (const secret of this.knownSecrets) result = result.split(secret).join(replacement);
    for (const pattern of secretPatterns) result = result.replace(pattern, replacement);
    return result;
  }
}

/** True when the text holds a well-known secret shape. Used by the vault secret scan. */
export function containsSecretPattern(text: string): boolean {
  return secretPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    const found = pattern.test(text);
    pattern.lastIndex = 0;
    return found;
  });
}

/**
 * Redacts the text of one block while the engine still writes it. A piece can end in the middle
 * of a secret, and the redactor sees only whole strings. So the stream redacts the whole block at
 * each piece, sends whole words only, and holds back enough text to cover a known secret.
 */
export class TextStreamRedactor {
  private readonly redactor: Redactor;
  private raw: string;
  private sent: string;
  private stopped: boolean;

  constructor(redactor: Redactor) {
    this.redactor = redactor;
    this.raw = "";
    this.sent = "";
    this.stopped = false;
  }

  /** Adds a piece and returns the redacted text that is safe to send now, which can be empty. */
  push(piece: string): string {
    if (this.stopped) return "";
    this.raw += piece;
    const redacted = this.redactor.redact(this.raw);
    // A secret can start in text that was already sent, such as a private key after its header.
    // The stream cannot take that text back. So the block stops, and its final text shows it.
    if (!redacted.startsWith(this.sent)) {
      this.stopped = true;
      return "";
    }
    const limit = redacted.length - holdBack(this.redactor.longestSecretLength());
    const safe = redacted.slice(0, lastWhitespaceEnd(redacted, limit));
    if (safe.length <= this.sent.length) return "";
    const next = safe.slice(this.sent.length);
    this.sent = safe;
    return next;
  }

  /** Starts a new block. */
  reset(): void {
    this.raw = "";
    this.sent = "";
    this.stopped = false;
  }
}

/** The index just after the last whitespace before `limit`, or 0. A token shape never holds whitespace. */
function lastWhitespaceEnd(text: string, limit: number): number {
  for (let index = Math.min(limit, text.length) - 1; index >= 0; index -= 1) {
    if (/\s/.test(text.charAt(index))) return index + 1;
  }
  return 0;
}

/**
 * The redacted text to hold back for a part of a known secret. Each short secret inside that part
 * can grow to the replacement, so the part can be longer once redacted.
 */
function holdBack(longestSecret: number): number {
  if (longestSecret === 0) return 0;
  return Math.ceil(((longestSecret - 1) * replacement.length) / shortestSecretLength);
}

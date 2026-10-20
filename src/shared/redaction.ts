/**
 * Removes secrets from text before it reaches a log, a chat or the event stream
 * (lesson 95). Known secret values are replaced exactly; well-known token shapes are
 * replaced by pattern, so a secret Eva never saw is caught too.
 */

const replacement = "[redacted]";

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
    if (value === undefined || value.length < 8 || this.knownSecrets.includes(value)) return;
    this.knownSecrets.push(value);
    this.knownSecrets.sort((first, second) => second.length - first.length);
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

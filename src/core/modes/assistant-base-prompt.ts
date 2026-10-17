/**
 * Eva's base assistant prompt, shipped with the engine. The text lives
 * in a Markdown file so a person can read and edit it; Bun embeds it at build time.
 */
import basePrompt from "./assistant-base-prompt.md" with { type: "text" };

export const assistantBasePrompt: string = basePrompt;

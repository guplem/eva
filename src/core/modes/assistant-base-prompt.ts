/**
 * Eva's base assistant prompt, shipped with the engine. The text lives
 * in a Markdown file so a person can read and edit it; Bun embeds it at build time.
 */
import { evaRepository } from "../../shared/version.ts";
import basePrompt from "./assistant-base-prompt.md" with { type: "text" };

// A fork of Eva gets issues in its own repository, so the slug comes from one place.
export const assistantBasePrompt: string = basePrompt.replaceAll("{{evaRepository}}", evaRepository);

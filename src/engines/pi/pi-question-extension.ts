/**
 * The question tool as text, for pi to load with `-e`. Eva writes it to disk because the single
 * executable has no source files on disk. Bun embeds the file as text, in the single executable too.
 */
import toolSource from "./pi-question-tool.ts" with { type: "text" };

// TypeScript types a `.ts` import as the module. Bun gives its text.
export const questionExtensionSource = toolSource as unknown as string;

/**
 * The tool's own dialog title, kept here because the bundler gives one file imported both as code
 * and as text only one of the two forms. A test keeps them equal.
 */
export const questionTitle = "eva-questions";

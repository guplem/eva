/**
 * The shell wrap as text, for pi to load with `-e` (#759). Eva writes it to disk because the single
 * executable has no source files on disk. Bun embeds the file as text, in the single executable too.
 */
import wrapSource from "./pi-shell-wrap.ts" with { type: "text" };

// TypeScript types a `.ts` import as the module. Bun gives its text.
export const shellWrapExtensionSource = wrapSource as unknown as string;

/**
 * The wrap's own constant of the same name, kept here because the bundler gives one file imported
 * both as code and as text only one of the two forms. A test keeps them equal.
 */
export const shellWallVariable = "EVA_SHELL_WALL";

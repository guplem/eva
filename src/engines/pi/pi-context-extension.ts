/**
 * The context filter as text, for pi to load with `-e`. Eva writes it to disk because the single
 * executable has no source files on disk. Bun embeds the file as text, in the single executable too.
 */
import filterSource from "./pi-context-filter.ts" with { type: "text" };

// TypeScript types a `.ts` import as the module. Bun gives its text.
export const contextExtensionSource = filterSource as unknown as string;

/**
 * The filter's own constants of the same names, kept here because the bundler gives one file
 * imported both as code and as text only one of the two forms. A test keeps them equal.
 */
export const projectFolderVariable = "EVA_PROJECT_FOLDER";

export const contextNoticePrefix = "eva-context-notice:";

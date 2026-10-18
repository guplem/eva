/**
 * The MCP bridge as text, for pi to load with `-e`. Eva writes it to disk because the single
 * executable has no source files on disk. Bun embeds the file as text, in the single executable too.
 */
import bridgeSource from "./pi-mcp-bridge.ts" with { type: "text" };

// TypeScript types a `.ts` import as the module. Bun gives its text.
export const mcpExtensionSource = bridgeSource as unknown as string;

/**
 * The bridge's own constant of the same name, kept here because the bundler gives one file
 * imported both as code and as text only one of the two forms. A test keeps them equal.
 */
export const mcpServersFileVariable = "EVA_MCP_SERVERS_FILE";

/** The bridge's prefix of each problem line that it sends with `notify`. A test keeps the two equal. */
export const mcpNoticePrefix = "eva-mcp-notice:";

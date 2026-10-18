/**
 * The MCP bridge as text, for pi to load with `-e`. Eva writes it to disk because the single
 * executable has no source files on disk. Bun embeds the file as text, also in the executable.
 */
import bridgeSource from "./pi-mcp-bridge.ts" with { type: "text" };

// TypeScript types a `.ts` import as the module; Bun gives its text.
export const mcpExtensionSource = bridgeSource as unknown as string;

/**
 * The sandbox library behind the `SandboxLibrary` seam (#759): `@anthropic-ai/sandbox-runtime`,
 * the library inside Claude Code's own sandbox. It runs only in the short `eva shell-sandbox`
 * process, never in Eva's core. Its `socat` bridge and its `rg` scan start inside it with no
 * seam, as the MCP bridge's servers do inside pi. `scripts/smoke-shell-sandbox.ts` runs it
 * against a real sandbox.
 */
import { SandboxManager, SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";
import type { SandboxLibrary } from "./shell-sandbox.ts";

export const sandboxRuntimeLibrary: SandboxLibrary = {
  initialize: async (config) => {
    // The library does not check a config that it gets in code, so a bad one could open a wall.
    // With no question callback, it refuses each host that no rule names.
    await SandboxManager.initialize(SandboxRuntimeConfigSchema.parse(config));
  },
  wrap: async (command) => (await SandboxManager.wrapWithSandboxArgv(command)).argv,
  cleanup: () => {
    SandboxManager.cleanupAfterCommand();
  },
  reset: () => SandboxManager.reset(),
};

/**
 * Plug and play: each machine setting that is left empty takes a value that Eva finds on the
 * machine itself, so a new machine needs no settings beyond the vault and the tokens.
 */
import { join } from "node:path";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { EvaConfig } from "./home.ts";

export interface MachineFacts {
  readonly homeRoot: string;
  readonly exists: (path: string) => boolean;
}

const tailscaleTimeoutMs = 10_000;

/** The vault folder and the voice model, from where `eva setup` and the README put them. */
export function withMachineDefaults(config: EvaConfig, facts: MachineFacts): EvaConfig {
  const vaultFolder = join(facts.homeRoot, "vault");
  const voiceModel = join(facts.homeRoot, "voice", "ggml-base.bin");
  return {
    ...config,
    vaultPath: config.vaultPath ?? (facts.exists(join(vaultFolder, ".git")) ? vaultFolder : null),
    voice: {
      ...config.voice,
      modelPath: config.voice.modelPath ?? (facts.exists(voiceModel) ? voiceModel : null),
    },
  };
}

/**
 * This machine's name in the tailnet, such as `server.example-tailnet.ts.net`, so the web UI
 * accepts requests through `tailscale serve` with no setting. Null without Tailscale.
 */
export async function tailscaleHostName(
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<string | null> {
  try {
    const result = await runner.run(["tailscale", "status", "--json"], {
      cwd: ".",
      environment,
      timeoutMs: tailscaleTimeoutMs,
    });
    if (result.exitCode !== 0) return null;
    const status = JSON.parse(result.stdout) as { Self?: { DNSName?: unknown } };
    const name = status.Self?.DNSName;
    return typeof name === "string" && name.length > 1 ? name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

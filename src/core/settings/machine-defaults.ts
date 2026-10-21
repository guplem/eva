/**
 * Plug and play: each machine setting that is left empty takes a value that Eva finds on the
 * machine itself, so a new machine needs no settings beyond the vault and the tokens.
 */
import { join } from "node:path";
import type { EvaConfig } from "./home.ts";

export interface MachineFacts {
  readonly homeRoot: string;
  readonly exists: (path: string) => boolean;
}

/** Where the README and the Install voice notes button put the whisper model. */
export function defaultVoiceModelPath(homeRoot: string): string {
  return join(homeRoot, "voice", "ggml-base.bin");
}

/** The vault folder and the voice model, from where `eva setup` and the README put them. */
export function withMachineDefaults(config: EvaConfig, facts: MachineFacts): EvaConfig {
  const vaultFolder = join(facts.homeRoot, "vault");
  const voiceModel = defaultVoiceModelPath(facts.homeRoot);
  return {
    ...config,
    vaultPath: config.vaultPath ?? (facts.exists(join(vaultFolder, ".git")) ? vaultFolder : null),
    voice: {
      ...config.voice,
      modelPath: config.voice.modelPath ?? (facts.exists(voiceModel) ? voiceModel : null),
    },
  };
}

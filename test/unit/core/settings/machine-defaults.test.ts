import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { withMachineDefaults } from "../../../../src/core/settings/machine-defaults.ts";

describe("machine defaults (plug and play)", () => {
  test("the vault folder and the voice model come from the home folder when they exist there", () => {
    const found = new Set([join("/home/eva", "vault", ".git"), join("/home/eva", "voice", "ggml-base.bin")]);
    const config = withMachineDefaults(defaultConfig, { homeRoot: "/home/eva", exists: (path) => found.has(path) });
    expect(config.vaultPath).toBe(join("/home/eva", "vault"));
    expect(config.voice.modelPath).toBe(join("/home/eva", "voice", "ggml-base.bin"));
  });

  test("a value that is set, or a file that is missing, leaves the setting as it is", () => {
    const set = { ...defaultConfig, vaultPath: "/vault", voice: { ...defaultConfig.voice, modelPath: "/model.bin" } };
    expect(withMachineDefaults(set, { homeRoot: "/home/eva", exists: () => true })).toEqual(set);
    expect(withMachineDefaults(defaultConfig, { homeRoot: "/home/eva", exists: () => false })).toEqual(defaultConfig);
  });
});

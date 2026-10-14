import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfig,
  homePaths,
  loadConfig,
  loadSecrets,
  resolveHomeFolder,
  saveConfig,
  saveSecrets,
} from "../../../../src/core/instance/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-home-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("resolveHomeFolder", () => {
  test("the --home flag wins over EVA_HOME", () => {
    expect(
      resolveHomeFolder({ flag: "/flag", environment: { EVA_HOME: "/env" }, platform: "linux", userHome: "/u" }),
    ).toBe("/flag");
  });

  test("EVA_HOME wins over the default", () => {
    expect(resolveHomeFolder({ environment: { EVA_HOME: "/env" }, platform: "linux", userHome: "/u" })).toBe("/env");
  });

  test("Linux uses XDG_CONFIG_HOME, or ~/.config", () => {
    expect(resolveHomeFolder({ environment: { XDG_CONFIG_HOME: "/x" }, platform: "linux", userHome: "/u" })).toBe(
      join("/x", "eva"),
    );
    expect(resolveHomeFolder({ environment: {}, platform: "linux", userHome: "/u" })).toBe(
      join("/u", ".config", "eva"),
    );
  });

  test("Windows uses APPDATA", () => {
    expect(resolveHomeFolder({ environment: { APPDATA: "C:/AppData" }, platform: "win32", userHome: "C:/u" })).toBe(
      join("C:/AppData", "eva"),
    );
  });
});

describe("config", () => {
  test("a missing config file means the defaults", () => {
    expect(loadConfig(homePaths(home))).toEqual(defaultConfig);
  });

  test("a saved config loads back, and missing keys take their defaults", () => {
    const paths = homePaths(home);
    saveConfig(paths, { ...defaultConfig, vaultPath: "/vault", port: 7421 });
    expect(loadConfig(paths)).toEqual({ ...defaultConfig, vaultPath: "/vault", port: 7421 });
    writeFileSync(paths.config, JSON.stringify({ version: 1, vaultPath: "/v" }));
    expect(loadConfig(paths)).toEqual({ ...defaultConfig, vaultPath: "/v" });
  });

  test("an invalid config is an EvaError that names the bad field", () => {
    const paths = homePaths(home);
    writeFileSync(paths.config, JSON.stringify({ version: 1, port: "high", role: "boss" }));
    const error: unknown = (() => {
      try {
        loadConfig(paths);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(isEvaError(error, "config_invalid")).toBe(true);
    expect((error as Error).message).toContain("port");
  });

  test("a config file that is not JSON is an EvaError", () => {
    const paths = homePaths(home);
    writeFileSync(paths.config, "{");
    expect(() => loadConfig(paths)).toThrow("not valid JSON");
  });
});

describe("secrets", () => {
  test("no file means no secrets", () => {
    expect(loadSecrets(homePaths(home))).toEqual({});
  });

  test("saved secrets load back", () => {
    const paths = homePaths(home);
    saveSecrets(paths, { telegramBotToken: "123:abc", localApiToken: "t" });
    expect(loadSecrets(paths)).toEqual({ telegramBotToken: "123:abc", localApiToken: "t" });
  });

  test("an invalid secrets file is an EvaError", () => {
    const paths = homePaths(home);
    writeFileSync(paths.secrets, JSON.stringify({ telegramBotToken: 5 }));
    expect(() => loadSecrets(paths)).toThrow("secrets.json");
  });
});

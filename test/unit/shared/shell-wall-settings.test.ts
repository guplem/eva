import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { shellWallSettings, toolCacheVariables } from "../../../src/shared/shell-wall-settings.ts";

const wall = {
  area: "/srv/vault/Projects/2025-03-02-1015-example-app/repos/clone-0",
  closed: ["/srv/vault", "/srv/vault/Projects/2025-03-02-1015-example-app/repos"],
  readable: ["/srv/eva/engines/gh"],
  readOnly: ["/srv/vault/Projects/2025-03-02-1015-example-app"],
  socketFilter: true,
};

describe("the shell wall settings that each engine's sandbox uses (#759)", () => {
  test("hold only the network and the folders, with no option of one engine", () => {
    const settings = shellWallSettings(wall, { runtimeFolder: null, platform: "linux" });
    expect(Object.keys(settings)).toEqual(["network", "filesystem"]);
    expect(settings.filesystem).toEqual({
      denyRead: wall.closed,
      allowRead: [wall.area, ...wall.readOnly, ...wall.readable],
      allowWrite: [wall.area, tmpdir(), join(homedir(), ".npm", "_cacache")],
    });
    expect(settings.network.allowedDomains).toContain("github.com");
    expect(settings.network.deniedDomains).toContain("*.ts.net");
  });

  test("move the package caches out of the home folder, which a command may not write", () => {
    expect(toolCacheVariables()["npm_config_store_dir"]).toBe(join(tmpdir(), "eva-tool-caches", "pnpm"));
  });
});

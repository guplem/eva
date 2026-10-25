import { describe, expect, test } from "bun:test";
import type { EvaVersions } from "../../../../../src/frontends/web/client/api.ts";
import { updateAllSteps } from "../../../../../src/frontends/web/client/version-words.ts";

type Tool = EvaVersions["tools"][number];

function tool(program: string, version: string | null, extra: Partial<Tool> = {}): Tool {
  return { program, feature: "a test", version, installable: true, tooOld: false, ...extra };
}

function versions(tools: Tool[], missing: EvaVersions["voiceNotes"]["missing"] = []): EvaVersions {
  return { eva: "1.0.0", tools, voiceNotes: { missing, on: missing.length === 0 } };
}

describe("updateAllSteps", () => {
  test("takes each missing, too old or older tool, then voice notes, then claude, then Eva", () => {
    const steps = updateAllSteps({
      versions: versions(
        [
          tool("claude", "2.1.0"),
          tool("git", "2.40.0", { installable: false }),
          tool("pi", "1.3.0"),
          tool("gh", "2.4.0", { tooOld: true }),
          tool("uv", null),
        ],
        ["ffmpeg"],
      ),
      latest: new Map([
        ["claude", "2.2.0"],
        ["pi", "1.4.0"],
        ["git", "2.50.0"],
      ]),
      claudeUpdatesItself: true,
      newestEva: "1.1.0",
    });
    expect(steps).toEqual([
      { kind: "install", program: "pi" },
      { kind: "install", program: "gh" },
      { kind: "install", program: "uv" },
      { kind: "voice notes" },
      { kind: "claude update" },
      { kind: "eva" },
    ]);
  });

  test("skips a tool that is the latest, or whose newest version Eva does not know", () => {
    const steps = updateAllSteps({
      versions: versions([tool("pi", "1.4.0"), tool("gh", "2.62.0")]),
      latest: new Map([["pi", "1.4.0"]]),
      claudeUpdatesItself: true,
      newestEva: null,
    });
    expect(steps).toEqual([]);
  });

  test("installs claude through its installer when Eva found no claude to update", () => {
    const steps = updateAllSteps({
      versions: versions([tool("claude", "2.1.0")]),
      latest: new Map([["claude", "2.2.0"]]),
      claudeUpdatesItself: false,
      newestEva: null,
    });
    expect(steps).toEqual([{ kind: "install", program: "claude" }]);
  });
});

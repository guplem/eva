import { describe, expect, test } from "bun:test";
import type { EvaVersions } from "../../../../../src/frontends/web/client/api.ts";
import { updateAllSteps, versionText, voiceNotesText } from "../../../../../src/frontends/web/client/version-words.ts";

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

  test("installs a missing claude with the tools, as claude update needs a claude", () => {
    const steps = updateAllSteps({
      versions: versions([tool("claude", null), tool("pi", "1.3.0")]),
      latest: new Map([["pi", "1.4.0"]]),
      claudeUpdatesItself: true,
      newestEva: null,
    });
    expect(steps).toEqual([
      { kind: "install", program: "claude" },
      { kind: "install", program: "pi" },
    ]);
  });

  test("updates a too old claude with claude update, also with no newest version", () => {
    const steps = updateAllSteps({
      versions: versions([tool("claude", "1.0.0", { tooOld: true })]),
      latest: new Map(),
      claudeUpdatesItself: true,
      newestEva: null,
    });
    expect(steps).toEqual([{ kind: "claude update" }]);
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

describe("versionText", () => {
  test("names a missing tool, a too old one, and a newer version", () => {
    expect(versionText(tool("uv", null), "0.9.0")).toBe("Not installed");
    expect(versionText(tool("gh", "2.4.0", { tooOld: true }), "2.62.0")).toBe("2.4.0, too old");
    expect(versionText(tool("pi", "1.3.0"), "1.4.0")).toBe("1.3.0 (1.4.0 available)");
    expect(versionText(tool("pi", "1.4.0"), "1.4.0")).toBe("1.4.0");
    // A tool that prints no version number cannot be compared.
    expect(versionText(tool("gh", "installed"), "2.62.0")).toBe("installed");
  });
});

describe("voiceNotesText", () => {
  test("names the missing parts, or says whether voice notes run", () => {
    expect(voiceNotesText({ missing: ["ffmpeg"], on: false })).toBe("Off, needs ffmpeg");
    expect(voiceNotesText({ missing: [], on: true })).toBe("On");
    expect(voiceNotesText({ missing: [], on: false })).toBe("Installed, restart Eva to turn them on");
  });
});

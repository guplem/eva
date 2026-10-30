import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../../../../src/core/settings/home.ts";
import type { PublicSettings } from "../../../../../src/core/settings/live-settings.ts";
import {
  repositoryNotes,
  stepProblems,
  unavailableSteps,
  unavailableTypes,
} from "../../../../../src/frontends/web/client/new-project-form.ts";

const secretsSet = {
  githubToken: true,
  telegramBotToken: false,
  claudeOauthToken: true,
  googleOauthClientId: true,
  googleOauthClientSecret: true,
  localApiToken: true,
};
const ready: PublicSettings = {
  config: {
    ...defaultConfig,
    google: {
      ...defaultConfig.google,
      email: "person@example.com",
      access: { ...defaultConfig.google.access, drive: "full" },
    },
  },
  secretsSet,
};

describe("unavailableSteps", () => {
  test("offers both steps when GitHub and Drive with full access are set up", () => {
    expect(unavailableSteps(ready)).toEqual({ github: null, drive: null });
  });

  test("says what each missing setup is", () => {
    const google = ready.config.google;
    expect(unavailableSteps({ ...ready, secretsSet: { ...secretsSet, githubToken: false } }).github).toContain(
      "Log in to GitHub",
    );
    const withGoogle = (changes: Partial<typeof google>): string | null =>
      unavailableSteps({ ...ready, config: { ...ready.config, google: { ...google, ...changes } } }).drive;
    expect(withGoogle({ email: null })).toContain("Log in to Google");
    expect(withGoogle({ services: ["calendar"] })).toContain("Settings > Connections > Google");
    expect(withGoogle({ access: defaultConfig.google.access })).toContain("Read and change");
  });
});

describe("the repository choices", () => {
  test("a type that needs GitHub is unavailable, with the reason, until Eva has a GitHub login", () => {
    expect(unavailableTypes(ready)).toEqual({ standard: null, "vibe-coded": null });
    const reasons = unavailableTypes({ ...ready, secretsSet: { ...secretsSet, githubToken: false } });
    expect(reasons["vibe-coded"]).toContain("Log in to GitHub");
  });

  test("only a private vibe-coded repository warns, and only a public one says that anyone reads it", () => {
    expect(repositoryNotes("standard", "private")).toEqual({ warning: null, note: null });
    expect(repositoryNotes("vibe-coded", "private").warning).toContain("CI minutes");
    expect(repositoryNotes("vibe-coded", "private").warning).toContain("paid plan");
    expect(repositoryNotes("vibe-coded", "public")).toEqual({
      warning: null,
      note: expect.stringContaining("Anyone can read") as string,
    });
    expect(repositoryNotes("standard", "public").warning).toBeNull();
  });
});

describe("stepProblems", () => {
  test("names each failed step, and nothing for a step that worked or did not run", () => {
    const url = { url: "https://github.com/you/x" };
    expect(
      stepProblems({ projectId: "x", github: url, drive: null, setup: { sessionId: null, problems: [] } }),
    ).toEqual([]);
    expect(
      stepProblems({
        projectId: "x",
        github: { problem: "Name taken." },
        drive: { problem: "No Drive." },
        setup: null,
      }),
    ).toEqual([
      "Eva could not create the GitHub repository: Name taken.",
      "Eva could not create the Drive folder: No Drive.",
    ]);
    expect(
      stepProblems({ projectId: "x", github: url, drive: null, setup: { sessionId: "s", problems: ["Labels: No."] } }),
    ).toEqual(["Eva could not finish the repository setup: Labels: No."]);
  });
});

import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../../../../src/core/settings/home.ts";
import type { PublicSettings } from "../../../../../src/core/settings/live-settings.ts";
import { stepProblems, unavailableSteps } from "../../../../../src/frontends/web/client/new-project-form.ts";

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
    expect(withGoogle({ services: ["calendar"] })).toContain("Turn on Google Drive");
    expect(withGoogle({ access: defaultConfig.google.access })).toContain("full access");
  });
});

describe("stepProblems", () => {
  test("names each failed step, and nothing for a step that worked or did not run", () => {
    expect(stepProblems({ projectId: "x", github: { url: "https://github.com/you/x" }, drive: null })).toEqual([]);
    expect(
      stepProblems({ projectId: "x", github: { problem: "Name taken." }, drive: { problem: "No Drive." } }),
    ).toEqual([
      "Eva could not create the GitHub repository: Name taken.",
      "Eva could not create the Drive folder: No Drive.",
    ]);
  });
});

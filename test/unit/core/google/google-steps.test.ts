import { describe, expect, test } from "bun:test";
import { googleSetupSteps } from "../../../../src/core/google/google-steps.ts";

describe("googleSetupSteps", () => {
  test("names the four steps that the Google check refers to, in order", () => {
    const steps = googleSetupSteps(["calendar", "contacts"]);
    expect(steps.map((step) => step.title)).toEqual([
      "1. Turn on the Google APIs",
      "2. Set up the consent screen",
      "3. Make an OAuth client",
      "4. Log in to Google",
    ]);
  });

  test("links only the APIs of the enabled services", () => {
    const apis = googleSetupSteps(["calendar", "contacts"])[0]?.links.map((link) => link.url);
    expect(apis).toEqual([
      "https://console.cloud.google.com/projectcreate",
      "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      "https://console.cloud.google.com/apis/library/people.googleapis.com",
    ]);
  });

  test("the consent screen step says In production, and the client step says Desktop app", () => {
    const [, consent, client] = googleSetupSteps(["calendar"]);
    expect(consent?.text).toContain("In production");
    expect(client?.text).toContain("Desktop app");
  });
});

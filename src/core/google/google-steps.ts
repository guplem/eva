/**
 * The steps that turn on the Google tools. Pure, so the web page bundles it too.
 */
import type { EvaConfig } from "../settings/home.ts";

type GoogleService = EvaConfig["google"]["services"][number];

export interface GoogleStep {
  readonly title: string;
  readonly text: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

/** The number of each step. The Google check and the login errors name a step by it. */
export const googleStep = { apis: 1, consent: 2, client: 3, login: 4 } as const;

const cloudConsole = "https://console.cloud.google.com";

/** The API library page of each service, and its name there. */
const apiPages: Readonly<Record<GoogleService, { readonly label: string; readonly page: string }>> = {
  calendar: { label: "Google Calendar API", page: "calendar-json.googleapis.com" },
  drive: { label: "Google Drive API", page: "drive.googleapis.com" },
  contacts: { label: "People API (Contacts)", page: "people.googleapis.com" },
  tasks: { label: "Google Tasks API", page: "tasks.googleapis.com" },
  gmail: { label: "Gmail API", page: "gmail.googleapis.com" },
};

export function googleSetupSteps(services: readonly GoogleService[]): GoogleStep[] {
  return [
    {
      title: `${String(googleStep.apis)}. Turn on the Google APIs`,
      text: "In Google Cloud, make a project, for example eva. Then open each API below and press Enable.",
      links: [
        { label: "Make a project", url: `${cloudConsole}/projectcreate` },
        ...services.map((service) => ({
          label: apiPages[service].label,
          url: `${cloudConsole}/apis/library/${apiPages[service].page}`,
        })),
      ],
    },
    {
      title: `${String(googleStep.consent)}. Set up the consent screen`,
      text: "Open Branding, press Get started, and pick External. Then open Audience and press Publish app, so that the status is In production. In Testing, your login ends after 7 days.",
      links: [
        { label: "Branding", url: `${cloudConsole}/auth/branding` },
        { label: "Audience", url: `${cloudConsole}/auth/audience` },
      ],
    },
    {
      title: `${String(googleStep.client)}. Make an OAuth client`,
      text: 'Make a client of type "Desktop app". Copy its client id and client secret into the fields below. Someone that you trust can share one client with you.',
      links: [{ label: "Make a client", url: `${cloudConsole}/auth/clients/create` }],
    },
    {
      title: `${String(googleStep.login)}. Log in to Google`,
      text: "Press Start the Google login, and open Google's page. If Google says that it did not verify the app, press Advanced, then go to the app. Press Allow. Your browser then opens an address that does not load. Copy the whole address from the address bar, paste it below, and press Finish. The code from that address works alone too.",
      links: [],
    },
  ];
}

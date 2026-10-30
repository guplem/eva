/**
 * The "?" help links: each place that is hard to understand, and the heading of the guide that
 * explains it. A place gets a "?" only when the guide says more than the place itself.
 * Pure, so a test checks that each heading exists.
 */
import { guideItem, guidePageOf, renderedGuide, type GuidePageId } from "./guide.ts";
import type { SettingsRoute } from "./settings-routes.ts";

interface HelpTarget {
  readonly page: GuidePageId;
  readonly slug: string;
}

export const helpTargets = {
  "log-in-to-your-ai": { page: "setup", slug: "log-in-to-your-ai" },
  "pick-your-vault": { page: "setup", slug: "pick-your-vault" },
  "connect-telegram": { page: "setup", slug: "connect-telegram-optional" },
  "open-eva-on-your-phone": { page: "setup", slug: "open-eva-on-your-phone" },
  "logging-in": { page: "reference", slug: "logging-in-to-the-web-page" },
  "set-up-google": { page: "reference", slug: "set-up-google" },
  "vault-sync": { page: "reference", slug: "vault-sync" },
  "several-computers": { page: "reference", slug: "several-computers" },
  updates: { page: "reference", slug: "updates" },
  notifications: { page: "reference", slug: "notifications-on-a-device" },
  "optional-features": { page: "reference", slug: "optional-features" },
  "problems-and-alerts": { page: "reference", slug: "problems-and-alerts" },
} as const satisfies Readonly<Record<string, HelpTarget>>;

export type HelpTopic = keyof typeof helpTargets;

/**
 * The help of each Settings card, by the card's `item` id, so a card needs no change of its own.
 * A setup step's page shows the card of its step, so the step gets the same "?".
 */
export const cardHelp: Readonly<Partial<Record<string, HelpTopic>>> = {
  "claude-code": "log-in-to-your-ai",
  pi: "log-in-to-your-ai",
  "vault-folder": "pick-your-vault",
  "vault-sync": "vault-sync",
  // The guide explains the GitHub login as the first part of picking the vault.
  github: "pick-your-vault",
  telegram: "connect-telegram",
  google: "set-up-google",
  "remote-access": "open-eva-on-your-phone",
  devices: "logging-in",
  notifications: "notifications",
  machine: "several-computers",
  versions: "optional-features",
  "eva-updates": "updates",
};

export function helpOfCard(item: string | undefined): HelpTopic | null {
  return item === undefined ? null : (cardHelp[item] ?? null);
}

export function helpRoute(topic: HelpTopic): SettingsRoute {
  const target: HelpTarget = helpTargets[topic];
  return { section: "guide", item: guideItem(target.page, target.slug) };
}

/** The heading's own title, so the tooltip always says what the guide shows. */
export function helpTitle(topic: HelpTopic): string {
  const target: HelpTarget = helpTargets[topic];
  const page = guidePageOf(target.page);
  const section =
    page === undefined ? undefined : renderedGuide(page).sections.find((each) => each.slug === target.slug);
  return section?.title ?? page?.title ?? "the guide";
}

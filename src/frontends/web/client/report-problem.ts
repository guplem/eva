/**
 * The link that opens a new GitHub issue for Eva, with a short template that holds the facts a
 * reader needs first: the version, the kind of install, the machine's role, the browser, the
 * device, its screen and the way in. The template asks for no path, name or token, because the
 * issue is public.
 */
import { evaRepository } from "../../../shared/version.ts";

export type ReportKind = "bug" | "change";

export type DeviceKind = "phone" | "tablet" | "computer";

/** "local" when the page opened on the machine that runs Eva, "remote" through Tailscale. */
export type Access = "local" | "remote";

export interface ReportFacts {
  /** Null while the status has not loaded. */
  readonly version: string | null;
  readonly install: "executable" | "source" | null;
  readonly role: "hub" | "satellite" | null;
  readonly browser: string;
  readonly device: DeviceKind;
  /** Such as "390x844 at 3x": CSS pixels and the pixel ratio. */
  readonly screen: string;
  readonly window: string;
  readonly access: Access;
}

// The prefixes of the create-issue skill, so a report reads like every other issue.
const titles: Readonly<Record<ReportKind, string>> = { bug: "Bug: ", change: "Feature: " };

const questions: Readonly<Record<ReportKind, readonly string[]>> = {
  bug: ["## What happened?", "", "", "## What did you expect?", "", "", "## Steps to reproduce", "", "1. ", ""],
  change: ["## What would you change?", "", "", "## Why?", "", ""],
};

// The address itself names the person's machine, so the issue says only which kind it was.
const accessWords: Readonly<Record<Access, string>> = {
  local: "the machine that runs Eva",
  remote: "another device, through Tailscale",
};

// An iPad in desktop mode sends a Mac user agent; only its touch points give it away.
export function deviceKind(userAgent: string, maxTouchPoints: number): DeviceKind {
  const android = userAgent.includes("Android");
  if (/iPhone|iPod/.test(userAgent) || (android && userAgent.includes("Mobile"))) return "phone";
  if (android || userAgent.includes("iPad") || (userAgent.includes("Macintosh") && maxTouchPoints > 1)) return "tablet";
  return "computer";
}

export function accessFrom(hostname: string): Access {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) ? "local" : "remote";
}

export function problemReportUrl(kind: ReportKind, facts: ReportFacts): string {
  const version =
    facts.version === null ? "unknown" : facts.install === null ? facts.version : `${facts.version} (${facts.install})`;
  const body = [
    ...questions[kind],
    "## This Eva",
    "",
    `- Eva version: ${version}`,
    `- Machine: ${facts.role ?? "unknown"}`,
    `- Opened from: ${accessWords[facts.access]}`,
    `- Device: ${facts.device}`,
    `- Screen: ${facts.screen}`,
    `- Window: ${facts.window}`,
    `- Browser: ${facts.browser}`,
  ].join("\n");
  const query = new URLSearchParams({ title: titles[kind], body });
  return `https://github.com/${evaRepository}/issues/new?${query.toString()}`;
}

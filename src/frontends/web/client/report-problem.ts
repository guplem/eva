/**
 * The link that opens a new GitHub issue for Eva, with a short template that holds the facts a
 * reader needs first: the version, the kind of install, the machine's role and the browser.
 * The template asks for no path, name or token, because the issue is public.
 */
import { evaRepository } from "../../../shared/version.ts";

export type ReportKind = "bug" | "change";

export interface ReportFacts {
  /** Null while the status has not loaded. */
  readonly version: string | null;
  readonly install: "executable" | "source" | null;
  readonly role: "hub" | "satellite" | null;
  readonly browser: string;
}

// The prefixes of the create-issue skill, so a report reads like every other issue.
const titles: Readonly<Record<ReportKind, string>> = { bug: "Bug: ", change: "Feature: " };

const questions: Readonly<Record<ReportKind, readonly string[]>> = {
  bug: ["## What happened?", "", "", "## What did you expect?", "", "", "## Steps to reproduce", "", "1. ", ""],
  change: ["## What would you change?", "", "", "## Why?", "", ""],
};

export function problemReportUrl(kind: ReportKind, facts: ReportFacts): string {
  const version =
    facts.version === null ? "unknown" : facts.install === null ? facts.version : `${facts.version} (${facts.install})`;
  const body = [
    ...questions[kind],
    "## This Eva",
    "",
    `- Eva version: ${version}`,
    `- Machine: ${facts.role ?? "unknown"}`,
    `- Browser: ${facts.browser}`,
  ].join("\n");
  const query = new URLSearchParams({ title: titles[kind], body });
  return `https://github.com/${evaRepository}/issues/new?${query.toString()}`;
}

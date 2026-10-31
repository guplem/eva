/**
 * The widgets that ship with Eva (#691, #694). Each shows in the settings list, off, until the
 * person turns it on. Each repository lives in the GitHub account of Eva's repository, and Eva
 * checks it once a day like any widget added by address.
 */
import { evaRepository } from "../../shared/version.ts";

export interface BaseWidget {
  readonly url: string;
  /** The name that the list shows before Eva reads the widget's manifest. */
  readonly name: string;
}

const [owner] = evaRepository.split("/");

export const baseWidgets: readonly BaseWidget[] = [
  { url: `https://github.com/${String(owner)}/eva-widget-habits`, name: "Habits" },
  { url: `https://github.com/${String(owner)}/eva-widget-weather`, name: "Weather" },
];

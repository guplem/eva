/**
 * The widgets that ship with Eva (#691, #694). Each shows in the settings list, off, until the
 * person turns it on. Each repository lives in the GitHub account of Eva's owner.
 */

export interface BaseWidget {
  readonly url: string;
  /** The name that the list shows before Eva reads the widget's manifest. */
  readonly name: string;
}

export const baseWidgets: readonly BaseWidget[] = [
  { url: "https://github.com/guplem/eva-widget-habits", name: "Habits" },
  { url: "https://github.com/guplem/eva-widget-weather", name: "Weather" },
];

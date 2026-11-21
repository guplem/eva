/**
 * The widgets that ship with Eva (#691, #694, #779). Each shows in the settings list, off, until the
 * person turns it on. Each repository lives in the GitHub account of Eva's owner.
 */

export interface BaseWidget {
  readonly url: string;
  /** The name that the list shows before Eva reads the widget's manifest. */
  readonly name: string;
}

/**
 * The order of the day panel (#972): with all on, Summary sits in the header slot beside the greeting
 * (#1007), Calendar fills the left, and Habits sits above Cases.
 */
export const baseWidgets: readonly BaseWidget[] = [
  { url: "https://github.com/guplem/eva-widget-summary", name: "Summary" },
  { url: "https://github.com/guplem/eva-widget-calendar", name: "Calendar" },
  { url: "https://github.com/guplem/eva-widget-habits", name: "Habits" },
  { url: "https://github.com/guplem/eva-widget-cases", name: "Cases" },
  { url: "https://github.com/guplem/eva-widget-weather", name: "Weather" },
];

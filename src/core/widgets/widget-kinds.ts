/**
 * The sizes and input types of the widget contract (`docs/widgets.md`). They live apart from the
 * schema check, so the web page can use them without the JSON Schema validator.
 */

/** The sizes of a card in the grid. `tall` and `xlarge` come with contract 2. */
export const widgetSizes = ["small", "medium", "large", "tall", "xlarge"] as const;

export type WidgetSize = (typeof widgetSizes)[number];

export type WidgetInputType =
  | "folder"
  | "file"
  | "text"
  | "url"
  | "number"
  | "boolean"
  | "choice"
  | "eva-location"
  | "eva-google-calendar"
  | "eva-cases";

/** The input types that give a permission to Eva's own data, not a value: the form shows no field for them. */
export const evaDataInputTypes: ReadonlySet<WidgetInputType> = new Set([
  "eva-location",
  "eva-google-calendar",
  "eva-cases",
]);

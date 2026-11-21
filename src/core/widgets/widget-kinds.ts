/**
 * The sizes, input types and asks of the widget contract (`docs/widgets.md`). They live apart from
 * the schema check, so the web page can use them without the JSON Schema validator.
 */

/**
 * The sizes of a card in the grid. `tall` and `xlarge` come with contract 2. `header` comes with
 * contract 3: a wide, short widget for the slot beside the greeting.
 */
export const widgetSizes = ["small", "medium", "large", "tall", "xlarge", "header"] as const;

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

/**
 * What a widget may ask Eva to do with a message to its parent window (contract 3): `chat` writes a
 * text in the message box, and `open` opens a page of Eva for a vault path.
 */
export const widgetAskTypes = ["chat", "open"] as const;

export type WidgetAskType = (typeof widgetAskTypes)[number];

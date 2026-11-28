/**
 * The sandbox rights of a widget, for the grid's frame and for the policy of each answer. No
 * `allow-same-origin` keeps a widget without an origin. The popup rights let a tap open a link in a
 * new tab, as a normal page (#780). No `allow-top-navigation` keeps Eva's own page out of reach.
 */
export const widgetSandbox = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/**
 * The sandbox rights of a page in a chat answer (#1129), for its frame and for its policy. A page
 * is code that a model wrote: it gets scripts only, with no origin, no popup and no form.
 */
export const pageSandbox = "allow-scripts";

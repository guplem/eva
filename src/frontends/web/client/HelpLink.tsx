/**
 * A small "?" that opens the guide at the part that explains this place. It is a link, so Back
 * returns to the place, and a long press on a phone can open it in a new tab.
 */
import type { ReactElement } from "react";
import { helpRoute, helpTitle, type HelpTopic } from "./help-links.ts";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";

export function HelpLink({ topic }: { readonly topic: HelpTopic }): ReactElement {
  const name = `Help: ${helpTitle(topic)}`;
  return (
    <a className="help-link" href={settingsHash(helpRoute(topic))} aria-label={name} data-tooltip={name}>
      <Icon name="help" />
    </a>
  );
}

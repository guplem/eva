/**
 * A small "?" that opens the guide at the part that explains this place. It is a link, so Back
 * returns to the place, and a long press on a phone can open it in a new tab.
 */
import type { ReactElement } from "react";
import { helpRoute, helpTitle, type HelpTopic } from "./help-links.ts";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";

/** `place` names the place, so two places of one page that share a topic still have two names. */
export function HelpLink({ topic, place }: { readonly topic: HelpTopic; readonly place?: string }): ReactElement {
  const name = place === undefined ? `Help: ${helpTitle(topic)}` : `Help on ${place}: ${helpTitle(topic)}`;
  return (
    <a className="help-link" href={settingsHash(helpRoute(topic))} aria-label={name} data-tooltip={name}>
      <Icon name="help" />
    </a>
  );
}

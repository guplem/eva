/**
 * The notice at the top of the main area when Eva does not answer. The open problems live in the
 * notification center behind the visor (#566): the center cannot load without Eva, so this one stays.
 */
import type { ReactElement } from "react";
import { Icon } from "./icons.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

interface ProblemNoticesProps {
  readonly isConnected: boolean;
  readonly onRetryNow: () => void;
}

export function ProblemNotices({ isConnected, onRetryNow }: ProblemNoticesProps): ReactElement | null {
  if (isConnected) return null;
  return (
    <div className="notices">
      {/* The socket tries again every 2 seconds, so a countdown would only flicker. */}
      <div className="notice warn" role="status">
        <Icon name="wifi-off" />
        <span className="notice-text">
          <strong>Eva does not answer.</strong> The hub may be off, or this device left Tailscale.
        </span>
        <button onClick={onRetryNow}>Try now</button>
      </div>
      <div className="offline-note">
        <span className="wide-only">
          <Visor size={76} face={stateFaces.offline} />
        </span>
        <span className="narrow-only">
          <Visor size={36} face={stateFaces.offline} />
        </span>
        <div>
          <strong>Your message stays in the box</strong>
          <div className="field-hint">Eva cannot take it now. Send it again when she is back.</div>
        </div>
      </div>
    </div>
  );
}

/**
 * What went wrong, at the top of the main area: Eva offline, and each open problem. Each one says
 * what happened and has the button that fixes it, so no problem needs a terminal.
 */
import type { ReactElement } from "react";
import type { EvaStatus } from "./api.ts";
import { Icon } from "./icons.tsx";
import {
  problemAction,
  problemActionLabels,
  shownProblems,
  type FixPage,
  type ProblemAction,
} from "./problem-actions.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

interface ProblemNoticesProps {
  readonly isConnected: boolean;
  readonly problems: EvaStatus["problemDetails"];
  readonly syncStatus: EvaStatus["vaultSync"]["status"];
  /** The page that is open, when it holds the fix of some problems. */
  readonly openPage: FixPage | null;
  readonly onRetryNow: () => void;
  readonly onAction: (action: ProblemAction) => void;
  /** Hides the notice until its problem rises to an error or clears. */
  readonly onHide: (key: string) => void;
}

export function ProblemNotices({
  isConnected,
  problems,
  syncStatus,
  openPage,
  onRetryNow,
  onAction,
  onHide,
}: ProblemNoticesProps): ReactElement | null {
  const shown = shownProblems(problems);
  if (isConnected && shown.length === 0) return null;
  return (
    <div className="notices">
      {!isConnected && (
        <>
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
        </>
      )}
      {shown.length > 0 && (
        <section className="problem-list" aria-label="Problems">
          {shown.map((problem) => {
            const action = problemAction(problem.key, syncStatus, openPage);
            return (
              <div key={problem.key} className={`notice ${problem.level === "error" ? "bad" : "warn"}`}>
                <Icon name="alert" />
                <span className="notice-text">{problem.message}</span>
                {action !== null && <button onClick={() => onAction(action)}>{problemActionLabels[action]}</button>}
                <button
                  className="icon-button"
                  aria-label="Hide this notice"
                  data-tooltip="Hide until it gets worse or ends"
                  onClick={() => onHide(problem.key)}
                >
                  <Icon name="x" />
                </button>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

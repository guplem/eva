/**
 * The notification center (#566): the page behind the visor. "Needs you" lists each open problem
 * with the button that fixes it, and each setup step that is left. "Earlier" is the history of
 * the last 30 days. One page serves a computer and a phone.
 */
import { useState, type ReactElement } from "react";
import type { EvaStatus, ProgressStep } from "./api.ts";
import type { HistoryEntry } from "../../../core/alerts/notification-history.ts";
import { Icon, type IconName } from "./icons.tsx";
import { centerFilters, historyGroups, shownNeeds, timeLabel, type CenterFilter } from "./notification-center.ts";
import { problemAction, problemActionLabels, shownProblems, type ProblemAction } from "./problem-actions.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

interface NotificationCenterProps {
  readonly problems: EvaStatus["problemDetails"];
  readonly entries: readonly HistoryEntry[];
  /** The setup steps that are left. */
  readonly steps: readonly ProgressStep[];
  readonly syncStatus: EvaStatus["vaultSync"]["status"];
  readonly onAction: (action: ProblemAction) => void;
  /** Marks an open problem as read: Eva hides it until it rises to an error or clears. */
  readonly onReadProblem: (key: string) => void;
  readonly onReadEntries: (seqs: readonly number[]) => void;
  readonly onReadAll: () => void;
  readonly onOpenStep: (step: ProgressStep) => void;
  readonly onOpenSettings: () => void;
}

const levelIcons: Record<HistoryEntry["level"], IconName> = {
  error: "alert",
  warn: "alert",
  resolved: "check",
  news: "info",
};

export function NotificationCenter(props: NotificationCenterProps): ReactElement {
  const { problems, entries, steps, syncStatus, onAction } = props;
  const [filter, setFilter] = useState<CenterFilter>("all");
  const now = new Date();
  const needs = shownNeeds(problems, filter);
  const shownSteps = filter === "problems" ? [] : steps;
  const groups = historyGroups(entries, filter, now);
  const unread = shownProblems(problems).length + entries.filter((entry) => !entry.read).length;
  const openKeys = new Set(problems.map((problem) => problem.key));

  return (
    <div className="main">
      <div className="notification-center">
        <div className="center-header">
          <div className="center-title">
            <h1>Notifications</h1>
            <div className="center-subtitle">What Eva needs from you, and what she did by herself.</div>
          </div>
          <button className="ghost" disabled={unread === 0} onClick={props.onReadAll}>
            <Icon name="check" />
            Mark all as read
          </button>
          <button className="ghost" onClick={props.onOpenSettings}>
            <Icon name="gear" />
            Settings
          </button>
        </div>
        <div className="center-column">
          <div className="center-filters chip-group" role="group" aria-label="Filter">
            {centerFilters.map((choice) => (
              <button
                key={choice.id}
                className={`chip${choice.id === filter ? " on" : ""}`}
                aria-pressed={choice.id === filter}
                onClick={() => setFilter(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>

          {(needs.length > 0 || shownSteps.length > 0) && (
            <section className="center-section" aria-label="Problems">
              <h2>Needs you</h2>
              {needs.map((problem) => {
                const action = problemAction(problem.key, syncStatus);
                const read = problem.hidden;
                // An older Eva sends no start time.
                const since = (problem as Partial<typeof problem>).since;
                return (
                  <div key={problem.key} className={`notice ${problem.level === "error" ? "bad" : "warn"}`}>
                    <Icon name="alert" />
                    <span className="notice-text">
                      {!read && <UnreadMark />}
                      <span className="visually-hidden">{problem.level === "error" ? "Error: " : "Warning: "}</span>
                      {problem.message}
                      {since !== undefined && <span className="center-time"> · since {timeLabel(since, now)}</span>}
                    </span>
                    {action !== null && (
                      <button className="primary" onClick={() => onAction(action)}>
                        {problemActionLabels[action]}
                      </button>
                    )}
                    {!read && (
                      <button className="ghost" onClick={() => props.onReadProblem(problem.key)}>
                        Mark as read
                      </button>
                    )}
                  </div>
                );
              })}
              {shownSteps.map((step) => (
                <div key={step.key} className="notice">
                  <Icon name="gear" />
                  <span className="notice-text">
                    <strong>{step.title}</strong> {step.detail}
                  </span>
                  <button className="primary" onClick={() => props.onOpenStep(step)}>
                    Set up
                  </button>
                </div>
              ))}
            </section>
          )}

          {groups.length > 0 && (
            <section className="center-section" aria-label="Earlier">
              <h2>Earlier</h2>
              <div className="center-history card">
                {groups.map((group) => (
                  <div key={group.day} className="center-day">
                    <div className="center-day-name">{group.day}</div>
                    {group.entries.map((entry) => {
                      // A row whose problem is still open opens its fix. Any other row only becomes read.
                      const action = openKeys.has(entry.key) ? problemAction(entry.key, syncStatus) : null;
                      return (
                        <button
                          key={entry.seq}
                          className={`center-row ${entry.level}${entry.read ? "" : " unread"}`}
                          onClick={() => {
                            if (!entry.read) props.onReadEntries([entry.seq]);
                            if (action !== null) onAction(action);
                          }}
                        >
                          <span className="center-row-icon">
                            <Icon name={levelIcons[entry.level]} />
                          </span>
                          <span className="center-row-text">{entry.message}</span>
                          <span className="center-time">{timeLabel(entry.at, now)}</span>
                          {!entry.read && <UnreadMark />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {needs.length === 0 && shownSteps.length === 0 && groups.length === 0 && (
            <div className="center-empty">
              <Visor size={76} face={stateFaces.resting} />
              <strong>Nothing here.</strong>
              <p>Eva tells you here when something needs you, and what she did by herself.</p>
            </div>
          )}

          <p className="center-note">Eva deletes an entry after 30 days. An open problem stays until it ends.</p>
        </div>
      </div>
    </div>
  );
}

/** A dot for an unread entry. The words are for a screen reader, which cannot see the dot. */
function UnreadMark(): ReactElement {
  return (
    <span className="unread-mark">
      <span className="visually-hidden">Unread. </span>
    </span>
  );
}

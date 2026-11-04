/**
 * The page of one schedule: its switch, Edit and Remove in the header, the facts of when it runs,
 * what it does, and its past runs. A run with a chat opens it.
 */
import { useState, type ReactElement } from "react";
import type { ScheduleView } from "./api.ts";
import { Icon } from "./icons.tsx";
import { BackButton } from "./MainNav.tsx";
import { nextRunWords, pastRunWords, repeatWords, resultWords } from "./schedule-words.ts";

export function SchedulePage(props: {
  readonly view: ScheduleView;
  readonly now: string;
  /** The chats that still exist: a quiet run or a deleted chat leaves no chat to open. */
  readonly chatIds: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly onOpenChat: (chatId: string) => void;
}): ReactElement {
  const { schedule, nextRun, ended, runs } = props.view;
  const [asking, setAsking] = useState(false);
  const result = resultWords(props.view, props.now);
  return (
    <>
      <div className="main-header">
        <BackButton label="Back to the schedules" text="Schedules" onClick={props.onBack} />
        <div className="header-text">
          <div className="header-title">
            <h1>{schedule.name}</h1>
            <span className={`status-pill ${result.tone}`}>{result.text}</span>
          </div>
        </div>
        <span className="schedule-switch">
          <button
            className="toggle"
            role="switch"
            aria-checked={schedule.enabled}
            aria-busy={props.busy}
            disabled={props.busy}
            aria-label={`Run ${schedule.name}`}
            onClick={props.onToggle}
          />
          <span aria-hidden="true">{schedule.enabled ? "On" : "Off"}</span>
        </span>
        <button className="outline" onClick={props.onEdit}>
          <Icon name="pen" /> Edit
        </button>
        <button className="soft" aria-label={`Remove ${schedule.name}`} onClick={() => setAsking(true)}>
          <Icon name="trash" /> Remove
        </button>
      </div>
      <div className="project-page schedule-page">
        {asking && (
          <div className="callout danger schedule-question" role="group" aria-label={`Remove ${schedule.name}?`}>
            <span>Remove {schedule.name}? It stops for good.</span>
            <div className="button-row">
              <button className="danger" onClick={props.onRemove}>
                Remove
              </button>
              <button onClick={() => setAsking(false)}>Keep</button>
            </div>
          </div>
        )}
        <section className="card project-facts" aria-label="When it runs">
          <dl className="chat-facts">
            <dt>Repeats</dt>
            <dd>{repeatWords(schedule)}</dd>
            <dt>Next run</dt>
            <dd>
              {ended !== null
                ? "None: it ended"
                : schedule.enabled
                  ? nextRunWords(nextRun, props.now)
                  : "None while it is off"}
            </dd>
            {schedule.until !== null && (
              <>
                <dt>Last day</dt>
                <dd className="mono">{schedule.until}</dd>
              </>
            )}
            {schedule.model !== null && (
              <>
                <dt>Model</dt>
                <dd>{schedule.model}</dd>
              </>
            )}
            <dt>Id</dt>
            <dd className="mono">{schedule.id}</dd>
          </dl>
        </section>
        <section className="clones-section" aria-labelledby="schedule-does-heading">
          <h2 id="schedule-does-heading">What it does</h2>
          <div className="card schedule-does">
            {schedule.text !== null && <Part label="Sends this text" body={schedule.text} />}
            {schedule.file !== null && <Part label="Sends this file" body={schedule.file} mono />}
            {schedule.prompt !== null && <Part label="Asks Eva in a new chat" body={schedule.prompt} />}
          </div>
        </section>
        <section className="clones-section" aria-labelledby="schedule-runs-heading">
          <h2 id="schedule-runs-heading">Past runs</h2>
          <div className="card clone-card">
            {runs.length === 0 ? (
              <p className="muted">No run yet.</p>
            ) : (
              <ul className="schedule-runs" aria-label="Past runs">
                {runs.map((run) => {
                  const words = pastRunWords(run, props.now);
                  const chatId = run.sessionId !== null && props.chatIds.has(run.sessionId) ? run.sessionId : null;
                  const content = (
                    <>
                      <span className={`status-pill ${words.tone}`}>{words.result}</span>
                      <span className="clone-chat-title">{words.when}</span>
                      {chatId !== null && (
                        <span className="muted">
                          Open chat <Icon name="forward" />
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={run.slot}>
                      {chatId === null ? (
                        <div className="clone-chat">{content}</div>
                      ) : (
                        <button
                          className="clone-chat"
                          aria-label={`Open the chat of ${words.when}`}
                          onClick={() => props.onOpenChat(chatId)}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

/** One thing that a run does, with its whole text: a prompt can have line breaks. */
function Part(props: { readonly label: string; readonly body: string; readonly mono?: boolean }): ReactElement {
  return (
    <div className="schedule-part">
      <span className="muted">{props.label}</span>
      <p className={props.mono === true ? "mono" : ""}>{props.body}</p>
    </div>
  );
}

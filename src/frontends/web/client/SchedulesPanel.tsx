/**
 * The schedules of `.eva/schedules.json`: a day line of today, one row per schedule with its
 * repeat, next run and last result, and "Add schedule". Each row opens the same form to edit its schedule.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { AddScheduleDialog } from "./AddScheduleDialog.tsx";
import { api, type ScheduleList, type ScheduleView } from "./api.ts";
import { Icon } from "./icons.tsx";
import { dayLine, lastRunWords, nextRunWords, repeatWords } from "./schedule-words.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { CardsSkeleton } from "./Loading.tsx";

/** Another part of the page, such as a setup card, fires this after it changes a schedule. */
export const schedulesChangedEvent = "eva:schedules-changed";

/** The day line moves on and the last results change, so the page asks again each minute. */
const reloadMs = 60_000;

export function SchedulesPanel(): ReactElement {
  const [list, setList] = useState<ScheduleList | null>(null);
  const [adding, setAdding] = useState(false);
  /** The schedule that the form edits, or null. */
  const [editing, setEditing] = useState<ScheduleView["schedule"] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The schedules whose switch waits for its change and the new list. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  /** The number of the newest list request: an older answer that comes in later must not undo a toggle. */
  const latest = useRef(0);

  const load = async (): Promise<void> => {
    const mine = ++latest.current;
    try {
      const fresh = await api.schedules();
      if (mine === latest.current) setList(fresh);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const reload = (): void => {
    void load();
  };
  useEffect(() => {
    reload();
    const timer = setInterval(reload, reloadMs);
    window.addEventListener(schedulesChangedEvent, reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(schedulesChangedEvent, reload);
    };
  }, []);

  const remove = async (scheduleId: string): Promise<void> => {
    try {
      await api.removeSchedule(scheduleId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
    reload();
  };

  const setEnabled = async (view: ScheduleView, enabled: boolean): Promise<void> => {
    const { id, name } = view.schedule;
    setPending((current) => new Set(current).add(id));
    try {
      await api.setScheduleEnabled(id, enabled);
      // Someone who can push to the vault can turn a schedule on too, so on always asks again (lesson 67).
      if (enabled)
        setNotice(`Turned on ${name}. Eva shows its setup card first. It runs only after the card reaches you.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
    // The switch waits for the new list, so a second tap never sends the same state again.
    await load();
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const schedules = list?.schedules ?? [];
  const failed = schedules.filter((view) => view.lastRun?.failed === true).length;

  return (
    <div className="schedules-page">
      <div className="schedules-header">
        <div className="schedules-title">
          <h1>Schedules</h1>
          {list !== null && (
            <div className="schedules-subtitle">{subtitle(schedules.length, failed + list.problems.length)}</div>
          )}
        </div>
        <button className="primary schedules-add" aria-label="Add schedule" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          <span className="schedules-add-text">Add schedule</span>
        </button>
      </div>
      <div className="schedules-column">
        {notice !== null && (
          <div role="status" className="schedules-notice">
            {notice}
          </div>
        )}
        {list === null && <CardsSkeleton label="Loading the schedules…" cards={2} />}
        {list?.problems.map((problem) => (
          <div key={problem} className="schedule-problem">
            {problem}
          </div>
        ))}
        {list !== null && schedules.length === 0 && (
          <div className="schedule-panel schedules-empty">
            <Visor size={76} face={stateFaces.resting} />
            <strong>Nothing is scheduled.</strong>
            <p>Add a schedule here, or ask Eva in a chat, such as “Every Friday at 18:00, plan my weekend.”</p>
          </div>
        )}
        {list !== null && schedules.length > 0 && <DayLine list={list} />}
        {schedules.length > 0 && list !== null && (
          <ul className="schedule-list" aria-label="Your schedules">
            {schedules.map((view) => (
              <ScheduleRow
                key={view.schedule.id}
                view={view}
                now={list.now}
                busy={pending.has(view.schedule.id)}
                onToggle={() => void setEnabled(view, !view.schedule.enabled)}
                onEdit={() => setEditing(view.schedule)}
                onRemove={() => void remove(view.schedule.id)}
              />
            ))}
          </ul>
        )}
      </div>
      {adding && (
        <AddScheduleDialog
          now={list?.now ?? null}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setNotice("Saved. Eva shows its setup card. The schedule runs only after you confirm it.");
            reload();
          }}
        />
      )}
      {editing !== null && (
        <AddScheduleDialog
          now={list?.now ?? null}
          schedule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            // A save with no change makes no card, so the notice promises none.
            setNotice(
              editing.enabled
                ? "Saved. If a field changed, Eva shows a setup card first. It runs only after you confirm it."
                : `Saved. ${editing.name} stays off. Turn it on to get its setup card.`,
            );
            reload();
          }}
        />
      )}
    </div>
  );
}

function subtitle(count: number, needsLook: number): string {
  const schedules = `${String(count)} ${count === 1 ? "schedule" : "schedules"}`;
  if (needsLook === 0) return schedules;
  return `${schedules} · ${String(needsLook)} ${needsLook === 1 ? "needs" : "need"} a look`;
}

const hours = [0, 6, 12, 18, 24];

function DayLine({ list }: { list: ScheduleList }): ReactElement {
  const line = dayLine(
    list.schedules.map((view) => ({ ...view.schedule, runsToday: view.runsToday })),
    list.now,
  );
  /** The pill under the pointer: its runs show as lines across the bar. */
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <section className="schedule-panel" aria-label="Today">
      <div className="schedule-panel-heading">
        <strong>Today</strong>
        <span className="schedule-small">{list.timeZone}</span>
      </div>
      <div className="day-line">
        {/* A thin line is hard to hit, so a wider area under it names it. Pills come later and stay on top. */}
        <span className="day-line-now-hit" style={{ left: percent(line.now) }} data-tooltip={line.nowLabel} />
        {line.runs[hovered ?? -1]?.marks.map((mark) => (
          <span key={mark} className="day-line-mark" style={{ left: percent(mark) }} aria-hidden="true" />
        ))}
        {line.runs.map((run, index) => (
          <span
            key={run.title}
            className="day-line-run"
            data-tooltip={run.title}
            onPointerEnter={() => setHovered(index)}
            onPointerLeave={() => setHovered(null)}
            // A pill near midnight would leave the bar, so it keeps the room of about one time.
            style={{
              left: `min(${percent(run.position)}, calc(100% - 4.5em))`,
              maxWidth: `max(4.5em, calc(${percent(run.width)} - 4px))`,
            }}
          >
            {run.label}
          </span>
        ))}
        <span className="day-line-now" style={{ left: percent(line.now) }} aria-hidden="true" />
        {hours.map((hour) => (
          <span
            key={hour}
            className="day-line-hour"
            aria-hidden="true"
            // The first and last labels hold to the ends, so a narrow bar never cuts them.
            style={
              hour === 0
                ? { left: "8px", transform: "none" }
                : hour === 24
                  ? { right: "8px", transform: "none" }
                  : { left: percent(hour / 24) }
            }
          >
            {`${String(hour).padStart(2, "0")}:00`}
          </span>
        ))}
      </div>
    </section>
  );
}

function percent(share: number): string {
  return `${String(share * 100)}%`;
}

function ScheduleRow(props: {
  view: ScheduleView;
  now: string;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}): ReactElement {
  const { schedule, nextRun, lastRun } = props.view;
  const [asking, setAsking] = useState(false);
  const result = schedule.enabled ? lastRunWords(lastRun, props.now) : { text: "Off", tone: "idle" };
  return (
    <li className={`schedule-panel schedule-row${schedule.enabled ? "" : " off"}`} aria-label={schedule.name}>
      <span className="schedule-row-icon">
        <Icon name="clock" />
      </span>
      <div>
        <div className="schedule-row-name">{schedule.name}</div>
        <div className="schedule-small">
          {repeatWords(schedule)} · {schedule.enabled ? `next ${nextRunWords(nextRun, props.now)}` : "off"}
        </div>
      </div>
      <div className="schedule-row-actions">
        <button
          className="toggle"
          role="switch"
          aria-checked={schedule.enabled}
          aria-busy={props.busy}
          disabled={props.busy}
          aria-label={`Run ${schedule.name}`}
          onClick={props.onToggle}
        />
        {!asking && (
          <>
            <button className="quiet" aria-label={`Edit ${schedule.name}`} onClick={props.onEdit}>
              <Icon name="pen" />
            </button>
            <button className="quiet" aria-label={`Remove ${schedule.name}`} onClick={() => setAsking(true)}>
              <Icon name="x" />
            </button>
          </>
        )}
      </div>
      <div className="schedule-row-result">
        <span className={`status-pill ${result.tone}`}>{result.text}</span>
      </div>
      {asking && (
        <div className="schedule-row-question" role="group" aria-label={`Remove ${schedule.name}?`}>
          <span>Remove {schedule.name}? It stops for good.</span>
          <button className="danger" onClick={props.onRemove}>
            Remove
          </button>
          <button onClick={() => setAsking(false)}>Keep</button>
        </div>
      )}
    </li>
  );
}

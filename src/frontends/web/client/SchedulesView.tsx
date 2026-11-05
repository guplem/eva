/**
 * The Schedules page, laid out as Projects: the list of schedules at the left, and the page of
 * the open schedule at the right. With no schedule open, a computer shows today's day line. A
 * phone shows the list as the page, with the day line above it.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { AddScheduleDialog } from "./AddScheduleDialog.tsx";
import { api, type ScheduleList, type ScheduleView } from "./api.ts";
import { Icon } from "./icons.tsx";
import { dayLine, repeatWords, resultWords, scheduleStateWords } from "./schedule-words.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { ListSkeleton } from "./Loading.tsx";
import { hourLabel } from "../../../shared/time-format.ts";
import { displayFormat } from "./display-format.ts";
import { useShowError } from "./error-toast.tsx";
import { Toast } from "./Toast.tsx";
import { goTo, goUp, leaveFor, replaceAddress } from "./back-layers.ts";
import { assistantChatAddressOf, scheduleAddressOf, scheduleRouteOf } from "./navigation.ts";
import { ScheduleEditPage } from "./ScheduleEditPage.tsx";
import { SchedulePage } from "./SchedulePage.tsx";
import { useIsPhone } from "./ChatHeader.tsx";

/** The day line moves on and the last results change, so the page asks again each minute. */
const reloadMs = 60_000;

export function SchedulesView({ chatIds }: { readonly chatIds: ReadonlySet<string> }): ReactElement {
  const [list, setList] = useState<ScheduleList | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The schedules whose switch waits for its change and the new list. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // The address names the open schedule and its edit page, so Back goes from the edit page to the
  // schedule, then to the list.
  const [route, setRoute] = useState(() => scheduleRouteOf(window.location.hash));
  const openId = route.scheduleId;
  const setOpenId = (scheduleId: string | null): void => setRoute({ scheduleId, edit: false });
  const showError = useShowError();
  const isPhone = useIsPhone();
  /** The schedule that the add form saved: its page opens once the form is gone. */
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setRoute(scheduleRouteOf(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /** The number of the newest list request: an older answer that comes in later must not undo a toggle. */
  const latest = useRef(0);

  const load = async (): Promise<void> => {
    const mine = ++latest.current;
    try {
      const fresh = await api.schedules();
      if (mine === latest.current) setList(fresh);
    } catch (error) {
      showError(error);
    }
  };
  const reload = (): void => {
    void load();
  };
  useEffect(() => {
    reload();
    const timer = setInterval(reload, reloadMs);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const open = (scheduleId: string | null): void => {
    goTo(scheduleAddressOf(scheduleId), () => setOpenId(scheduleId));
  };

  // The form closes its Back layer as it goes, with a step back in the history. The new address
  // must come after that step, or the step takes it away again. It must also wait for a list
  // that holds the new schedule: an older list would show its address as a removed schedule.
  const createdIsListed = created !== null && list?.schedules.some((view) => view.schedule.id === created) === true;
  useEffect(() => {
    if (created === null || adding || !createdIsListed) return;
    setCreated(null);
    goTo(scheduleAddressOf(created), () => setOpenId(created));
  }, [created, adding, createdIsListed]);

  const remove = async (scheduleId: string): Promise<void> => {
    try {
      await api.removeSchedule(scheduleId);
      // The page is gone: its address leaves the history, so Back never opens it again.
      setOpenId(null);
      leaveFor(scheduleAddressOf(null), () => setOpenId(null));
    } catch (error) {
      showError(error);
    }
    reload();
  };

  const setEnabled = async (view: ScheduleView, enabled: boolean): Promise<void> => {
    const { id } = view.schedule;
    setPending((current) => new Set(current).add(id));
    try {
      await api.setScheduleEnabled(id, enabled);
    } catch (error) {
      showError(error);
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
  const shown = openId === null ? null : (schedules.find((view) => view.schedule.id === openId) ?? null);
  // An address of a removed schedule, such as an old link, shows the list in its place.
  const isGone = list !== null && openId !== null && shown === null;
  useEffect(() => {
    if (!isGone) return;
    showError(new Error("This schedule is not in the vault any more."));
    replaceAddress(scheduleAddressOf(null));
    setOpenId(null);
  }, [isGone, showError]);

  return (
    <div className={`layout${shown === null ? " list-home" : ""}`}>
      <nav className="sidebar" aria-label="Schedules">
        <div className="list-title-row">
          <h2 className="list-title">Schedules</h2>
          <button className="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add schedule
          </button>
        </div>
        {list !== null && (
          <span className="muted schedules-count">{subtitle(schedules.length, failed + list.problems.length)}</span>
        )}
        {list?.problems.map((problem) => (
          <div key={problem} className="schedule-problem">
            {problem}
          </div>
        ))}
        {/* A phone shows the list as the page, so today's day line goes above the list. */}
        {list !== null && shown === null && isPhone && <SchedulesHome list={list} />}
        {list === null && <ListSkeleton label="Loading the schedules…" rows={3} shape="projects" />}
        {schedules.length > 0 && list !== null && (
          <ul className="schedule-cards" aria-label="Your schedules">
            {schedules.map((view) => (
              <ScheduleCard
                key={view.schedule.id}
                view={view}
                now={list.now}
                isOpen={shown?.schedule.id === view.schedule.id}
                onOpen={() => open(view.schedule.id)}
              />
            ))}
          </ul>
        )}
      </nav>
      <main className="main">
        {shown === null || list === null ? (
          list !== null && !isPhone && <SchedulesHome list={list} />
        ) : route.edit ? (
          <ScheduleEditPage
            key={shown.schedule.id}
            schedule={shown.schedule}
            now={list.now}
            onBack={() => goUp(scheduleAddressOf(shown.schedule.id), () => setOpenId(shown.schedule.id))}
            onSaved={(saved, leave) => {
              setNotice(saved.enabled ? "Saved." : `Saved. ${saved.name} stays off.`);
              reload();
              if (leave) goUp(scheduleAddressOf(saved.id), () => setOpenId(saved.id));
            }}
          />
        ) : (
          <SchedulePage
            // A new schedule starts with no question open.
            key={shown.schedule.id}
            view={shown}
            now={list.now}
            chatIds={chatIds}
            busy={pending.has(shown.schedule.id)}
            onBack={() => goUp(scheduleAddressOf(null), () => setOpenId(null))}
            onToggle={() => void setEnabled(shown, !shown.schedule.enabled)}
            onEdit={() =>
              goTo(scheduleAddressOf(shown.schedule.id, true), () =>
                setRoute({ scheduleId: shown.schedule.id, edit: true }),
              )
            }
            onRemove={() => void remove(shown.schedule.id)}
            onOpenChat={(chatId) => goTo(assistantChatAddressOf(chatId))}
          />
        )}
      </main>
      {adding && (
        <AddScheduleDialog
          now={list?.now ?? null}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            setNotice("Saved.");
            reload();
            setCreated(saved.id);
          }}
        />
      )}
      {notice !== null && <Toast message={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function subtitle(count: number, needsLook: number): string {
  const schedules = `${String(count)} ${count === 1 ? "schedule" : "schedules"}`;
  if (needsLook === 0) return schedules;
  return `${schedules} · ${String(needsLook)} ${needsLook === 1 ? "needs" : "need"} a look`;
}

/** What shows with no schedule open: today's day line, or a hint when nothing is scheduled. */
function SchedulesHome({ list }: { list: ScheduleList }): ReactElement {
  return (
    <div className="schedules-home">
      {list.schedules.length === 0 ? (
        <div className="schedule-panel schedules-empty">
          <Visor size={76} face={stateFaces.resting} />
          <strong>Nothing is scheduled.</strong>
          <p>Add a schedule here, or ask Eva in a chat, such as “Every Friday at 18:00, plan my weekend.”</p>
        </div>
      ) : (
        <DayLine list={list} />
      )}
    </div>
  );
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
            {hourLabel(hour, displayFormat().clock)}
          </span>
        ))}
      </div>
    </section>
  );
}

function percent(share: number): string {
  return `${String(share * 100)}%`;
}

/** A schedule in the list: its name, its last result, when it repeats and its next run. */
function ScheduleCard(props: { view: ScheduleView; now: string; isOpen: boolean; onOpen: () => void }): ReactElement {
  const { schedule } = props.view;
  const result = resultWords(props.view, props.now);
  return (
    <li aria-label={schedule.name}>
      <button
        className={`project-card schedule-card${schedule.enabled ? "" : " off"}`}
        aria-current={props.isOpen}
        onClick={props.onOpen}
      >
        <span className="card-row">
          <b>{schedule.name}</b>
          <span className={`status-pill ${result.tone}`}>{result.text}</span>
        </span>
        <span className="card-row muted">
          <span>
            {repeatWords(schedule)} ·{" "}
            {scheduleStateWords(
              { enabled: schedule.enabled, nextRun: props.view.nextRun, ended: props.view.ended },
              props.now,
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The statistics of the projects (#840, #878): the range picker, the timeline, the monthly chart
 * and the counts by status. The Projects home page shows them, and so does their own page, which a
 * phone opens from the list.
 */
import { useState, type CSSProperties, type PointerEvent, type ReactElement } from "react";
import type { Project } from "./api.ts";
import { StatusPill } from "./ProjectPage.tsx";
import { BackButton } from "./MainNav.tsx";
import { CardsSkeleton } from "./Loading.tsx";
import { countOf, inUseLabel, inUsePill, statusLabels, statusPill, type Pill } from "./project-format.ts";
import {
  chartLabels,
  knownChoice,
  monthlyStatus,
  pointLabel,
  projectColor,
  rangeChoiceOf,
  rangeChoices,
  rangeChoiceValue,
  rangeOf,
  rangeWords,
  statusCounts,
  timeline,
  todayLabel,
  type MonthPoint,
  type RangeChoice,
  type TimelineRow,
} from "./projects-home.ts";
import type { ProjectStatusFilter } from "../../../shared/project-statuses.ts";

/** The colour of a project, as a custom property, so the rules in `projects-home.css` use it. */
export function colorStyle(project: Project | undefined): CSSProperties {
  return { "--project-color": projectColor(project?.parsedId.slug ?? "") } as CSSProperties;
}

/** The words of a row for a screen reader: the title, the status and In use. The patterns show them to the eye. */
function rowLabel(row: TimelineRow): string {
  return [
    row.title,
    ...(row.status === null ? [] : [statusLabels[row.status]]),
    ...(row.inUse ? [inUseLabel] : []),
  ].join(", ");
}

/** One key of the timeline legend: a swatch of a bar pattern and its word. */
function LegendKey({ pattern, text }: { readonly pattern: string; readonly text: string }): ReactElement {
  return (
    <span className="timeline-key">
      <span className={`timeline-swatch ${pattern}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Where the date label goes: centred on the today line, or ending at it near the right edge, so it stays in the card. */
function labelPlace(today: number): CSSProperties {
  return today <= 0.9
    ? { left: `${String(today * 100)}%`, transform: "translateX(-50%)" }
    : { right: `${String((1 - today) * 100)}%` };
}

interface RangePickerProps {
  readonly choice: RangeChoice;
  readonly projects: readonly Project[];
  readonly onChange: (choice: RangeChoice) => void;
}

/** The time range of the statistics: a quick range, a year, all, or two days (#878). */
export function RangePicker({ choice, projects, onChange }: RangePickerProps): ReactElement {
  const now = new Date();
  const shown = knownChoice(choice, projects, now);
  return (
    <div className="range-picker" role="group" aria-label="Time range">
      <select
        aria-label="Time range"
        value={rangeChoiceValue(shown)}
        onChange={(event) => onChange(rangeChoiceOf(event.target.value, now))}
      >
        {rangeChoices(projects, now).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {shown.kind === "custom" && (
        <span className="range-days">
          <input
            type="date"
            aria-label="First day"
            value={shown.from}
            onChange={(event) => onChange({ ...shown, from: event.target.value })}
          />
          <span className="muted">to</span>
          <input
            type="date"
            aria-label="Last day"
            value={shown.to}
            onChange={(event) => onChange({ ...shown, to: event.target.value })}
          />
        </span>
      )}
    </div>
  );
}

/** The lines of the chart. Each has its own dash and dot shape, so it reads without colour. */
const series: readonly { readonly key: "active" | "paused" | "closed"; readonly label: string }[] = [
  { key: "active", label: statusLabels.active },
  { key: "paused", label: statusLabels.paused },
  { key: "closed", label: "Closed in the month before" },
];

/** The top of the value axis: an even number, so the middle line has a whole number too. */
function chartTop(points: readonly MonthPoint[]): number {
  const most = Math.max(1, ...points.flatMap((point) => [point.active, point.paused, point.closed]));
  return most === 1 ? 1 : Math.ceil(most / 2) * 2;
}

/** The words of one point for a screen reader and the legend. */
function pointWords(point: MonthPoint): string {
  return `${pointLabel(point.at)}: ${String(point.active)} active, ${String(point.paused)} paused, ${String(point.closed)} closed in the month before`;
}

/**
 * The active and the paused projects on day 1 of each month, and the projects that closed in the
 * month before (#878). A tap, a pointer or the focus on a month shows its numbers in the legend.
 * At first, the legend shows the newest month.
 */
function MonthlyChart({ points }: { readonly points: readonly MonthPoint[] }): ReactElement {
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked !== null && picked < points.length ? picked : points.length - 1;
  const shown = points[index];
  const top = chartTop(points);
  const xOf = (at: number): number => (points.length === 1 ? 50 : (at / (points.length - 1)) * 100);
  const yOf = (value: number): number => (1 - value / top) * 100;
  const labels = chartLabels(points);
  // Each month owns the width around its point, so a tap anywhere near a point picks it.
  const hitWidth = points.length === 1 ? 100 : 100 / (points.length - 1);
  const nearest = (event: PointerEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = box.width === 0 ? 1 : (event.clientX - box.left) / box.width;
    return Math.min(points.length - 1, Math.max(0, Math.round(share * (points.length - 1))));
  };
  return (
    <div className="month-chart">
      <div className="month-chart-body">
        <div className="month-chart-values" aria-hidden="true">
          {[top, top / 2, 0].map((value) => (
            <span key={value} style={{ top: `${String(yOf(value))}%` }}>
              {Number.isInteger(value) ? value : ""}
            </span>
          ))}
        </div>
        {/* A tap or a pointer anywhere on the plot picks the nearest month, so a narrow month on a phone is easy to hit. */}
        <div
          className="month-chart-plot"
          onPointerDown={(event) => setPicked(nearest(event))}
          onPointerMove={(event) => setPicked(nearest(event))}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[0, 50, 100].map((y) => (
              <line key={y} className="month-chart-grid" x1="0" x2="100" y1={y} y2={y} />
            ))}
            {series.map(({ key }) => (
              <polyline
                key={key}
                className={`month-chart-line ${key}`}
                points={points.map((point, at) => `${String(xOf(at))},${String(yOf(point[key]))}`).join(" ")}
              />
            ))}
          </svg>
          <span className="month-chart-cursor" style={{ left: `${String(xOf(index))}%` }} aria-hidden="true" />
          {series.map(({ key }) =>
            points.map((point, at) => (
              <span
                key={`${key}-${String(at)}`}
                className={`month-chart-dot ${key}`}
                style={{ left: `${String(xOf(at))}%`, top: `${String(yOf(point[key]))}%` }}
                aria-hidden="true"
              />
            )),
          )}
          <div className="month-chart-hits" role="group" aria-label="Months">
            {points.map((point, at) => (
              <button
                key={point.at.getTime()}
                className="month-chart-hit"
                aria-label={pointWords(point)}
                aria-pressed={at === index}
                // One tab stop for all the months: the arrow keys move between them.
                tabIndex={at === index ? 0 : -1}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  const next = event.currentTarget.parentElement?.children[at + step];
                  if (step === 0 || !(next instanceof HTMLElement)) return;
                  event.preventDefault();
                  next.focus();
                }}
                onClick={() => setPicked(at)}
                onFocus={() => setPicked(at)}
                style={{ left: `${String(xOf(at))}%`, width: `${String(hitWidth)}%` }}
              />
            ))}
          </div>
        </div>
        <div className="month-chart-marks" aria-hidden="true">
          {labels.map((label, at) =>
            label === "" ? null : (
              <span key={points[at]?.at.getTime()} style={{ left: `${String(xOf(at))}%` }}>
                {label}
              </span>
            ),
          )}
        </div>
      </div>
      {/* No live region: a pointer that crosses the chart would make a screen reader read each month. The buttons name their numbers. */}
      {shown !== undefined && (
        <div className="month-chart-legend">
          <span className="month-chart-day">{pointLabel(shown.at)}</span>
          {series.map(({ key, label }) => (
            <span key={key} className="timeline-key">
              <span className={`month-chart-swatch ${key}`} aria-hidden="true" />
              {label}
              <b>{shown[key]}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The counts, in the order of the filter chips. In use counts the projects with the flag (#859). */
const counted: readonly { readonly filter: "active" | "in-use" | "paused"; readonly pill: Pill | null }[] = [
  { filter: "active", pill: statusPill("active") },
  { filter: "in-use", pill: inUsePill(true) },
  { filter: "paused", pill: statusPill("paused") },
];

interface ProjectStatsProps {
  readonly projects: readonly Project[];
  readonly range: RangeChoice;
  readonly onOpenProject: (project: Project) => void;
  /** A press on a count filters the list by that status, or by In use. */
  readonly onFilterStatus: (status: ProjectStatusFilter) => void;
}

/** The timeline, the monthly chart and the counts of the range. */
export function ProjectStats({ projects, range, onOpenProject, onFilterStatus }: ProjectStatsProps): ReactElement {
  const now = new Date();
  // Only the paused projects can hide: an active project and a project in use always show (#859).
  const [showPaused, setShowPaused] = useState(true);
  const choice = knownChoice(range, projects, now);
  const span = rangeOf(choice, projects, now);
  const shown = timeline(projects, span, now, showPaused);
  // A range after today has no point yet: day 1 of the month of a later first day is not in it.
  const points = span.from > now ? [] : monthlyStatus(projects, span, now);
  const counts = statusCounts(projects, span);
  const words = rangeWords(choice);
  return (
    <>
      <section className="card home-card" aria-label="Timeline">
        <div className="home-card-head">
          <h2 className="home-card-title">Timeline</h2>
          {/* The legend shows the pattern of each bar. Only Paused is a chip: it shows or hides the paused projects. */}
          <div className="timeline-legend" role="group" aria-label="Legend">
            <LegendKey pattern="active" text={statusLabels.active} />
            <button
              className="filter-chip timeline-chip"
              aria-label="Show the paused projects"
              aria-pressed={showPaused}
              onClick={() => setShowPaused(!showPaused)}
            >
              <span className="timeline-swatch paused" aria-hidden="true" />
              {statusLabels.paused}
            </button>
            {shown.rows.some((row) => row.status === "closed") && (
              <LegendKey pattern="closed" text={statusLabels.closed} />
            )}
            <LegendKey pattern="in-use" text={inUseLabel} />
          </div>
        </div>
        {span.from > now ? (
          <span className="muted">This range starts after today.</span>
        ) : shown.rows.length === 0 ? (
          <span className="muted">No active project or project in use in this range.</span>
        ) : (
          <div className="timeline">
            <div className={`timeline-marks${shown.marks.length > 6 ? " dense" : ""}`} aria-hidden="true">
              {shown.marks.map((mark) => (
                <span key={mark.at} style={{ left: `${String(mark.at * 100)}%` }}>
                  {mark.label}
                </span>
              ))}
            </div>
            {shown.rows.map((row) => (
              <button
                key={row.project.id}
                className={`timeline-row ${row.status ?? "none"}${row.inUse ? " in-use" : ""}`}
                aria-label={rowLabel(row)}
                style={colorStyle(row.project)}
                onClick={() => onOpenProject(row.project)}
              >
                <span className="timeline-name">
                  {/* The mark at the left says In use, beside the ring of the bar. A narrow timeline keeps its dot only. */}
                  {row.inUse && (
                    <span className="pill dot live timeline-in-use" aria-hidden="true">
                      <span className="timeline-in-use-word">{inUseLabel}</span>
                    </span>
                  )}
                  <span>{row.title}</span>
                </span>
                <span className="timeline-lane">
                  <span
                    className={`timeline-bar${row.startsBefore ? " before" : ""}`}
                    style={{
                      left: `${String(row.start * 100)}%`,
                      width: `${String((row.end - row.start) * 100)}%`,
                    }}
                  />
                </span>
              </button>
            ))}
            {/* One line over all the rows: a piece in each row left gaps between them. */}
            {shown.today !== null && (
              <div className="timeline-today-layer" aria-hidden="true">
                <span className="timeline-today" style={{ left: `${String(shown.today * 100)}%` }} />
                <span className="timeline-today-label" style={labelPlace(shown.today)}>
                  {todayLabel(now)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="card home-card" aria-label="By month">
        <h2 className="home-card-title">By month</h2>
        {points.length === 0 ? (
          <span className="muted">This range starts after today.</span>
        ) : (
          // A new range starts again at its newest month.
          <MonthlyChart key={`${String(points[0]?.at.getTime())}-${String(points.length)}`} points={points} />
        )}
        {/* Eva keeps no history of the status, so the person must know how a past month counts. */}
        <span className="field-hint">
          Each point is day 1 of a month. Eva knows only the status of today and the closing day. So a past month shows
          each open project with its status of today, and a closed project as active before it closed.
        </span>
      </section>
      <section className="home-counts" aria-label={`Projects by status, ${words.toLowerCase()}`}>
        <div className="home-count-row">
          {counted.map(({ filter, pill }) => (
            <button key={filter} className="card home-count" onClick={() => onFilterStatus(filter)}>
              <StatusPill pill={pill} />
              <b>{counts[filter]}</b>
            </button>
          ))}
        </div>
        <span className="muted">
          {words}: {countOf(counts.started, "project")} started.
        </span>
      </section>
    </>
  );
}

interface ProjectStatsPageProps extends Omit<ProjectStatsProps, "projects"> {
  /** Every project, whatever the filters of the list. Null while they load. */
  readonly projects: readonly Project[] | null;
  readonly onRangeChange: (choice: RangeChoice) => void;
  readonly onBack: () => void;
}

/** The statistics on their own page, so a phone shows them too (#878). */
export function ProjectStatsPage({
  projects,
  range,
  onRangeChange,
  onBack,
  ...rest
}: ProjectStatsPageProps): ReactElement {
  return (
    <>
      <div className="main-header">
        <BackButton label="Back to the projects" text="Projects" onClick={onBack} />
        <div className="header-text">
          <h1>Statistics</h1>
        </div>
        <RangePicker choice={range} projects={projects ?? []} onChange={onRangeChange} />
      </div>
      <div className="projects-home">
        {projects === null ? (
          <CardsSkeleton label="Loading the projects…" cards={3} />
        ) : (
          <ProjectStats projects={projects} range={range} {...rest} />
        )}
      </div>
    </>
  );
}

/**
 * The Projects page with no project open (#840): the chats that need the person, the recent chats,
 * a timeline of the active and the paused projects, and the counts by status of a year.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import type { Project, SessionRecord } from "./api.ts";
import { chatTime, type ChatState } from "./chat-list.ts";
import { ChatStatePill } from "./ChatHeader.tsx";
import { CardsSkeleton } from "./Loading.tsx";
import { StatusPill } from "./ProjectPage.tsx";
import { countOf, statusLabels, statusPill } from "./project-format.ts";
import {
  homeChats,
  projectColor,
  projectInitials,
  projectYears,
  statusCounts,
  timeline,
  type YearChoice,
} from "./projects-home.ts";
import type { ProjectStatus } from "../../../shared/project-statuses.ts";

/** The colour of a project, as a custom property, so the rules in `projects-home.css` use it. */
function colorStyle(project: Project | undefined): CSSProperties {
  return { "--project-color": projectColor(project?.parsedId.slug ?? "") } as CSSProperties;
}

interface ChatRowsProps {
  readonly chats: readonly { readonly chat: SessionRecord; readonly state: ChatState }[];
  readonly projectOf: (chat: SessionRecord) => Project | undefined;
  readonly onOpenChat: (chat: SessionRecord) => void;
  readonly now: Date;
}

/** One button per chat: the mark of its project, its title, where and when, and its state. */
function ChatRows({ chats, projectOf, onOpenChat, now }: ChatRowsProps): ReactElement {
  return (
    <div className="home-chats">
      {chats.map(({ chat, state }) => {
        const project = projectOf(chat);
        const projectTitle = project?.title ?? "A project";
        return (
          <button key={chat.id} className="home-chat" onClick={() => onOpenChat(chat)}>
            <span className="project-mark" style={colorStyle(project)} aria-hidden="true">
              {projectInitials(projectTitle)}
            </span>
            <span className="home-chat-text">
              <b>{chat.title}</b>
              <span className="muted">
                {projectTitle}
                {chat.clone !== null && ` · ${chat.clone}`}
                {" · "}
                {chatTime(new Date(chat.lastTurnAt ?? chat.createdAt), now)}
              </span>
            </span>
            <ChatStatePill state={state} />
          </button>
        );
      })}
    </div>
  );
}

interface NeedsYouProps {
  readonly chats: readonly SessionRecord[];
  readonly projects: readonly Project[];
  readonly stateOf: (chat: SessionRecord) => ChatState;
  readonly onOpenChat: (chat: SessionRecord) => void;
  readonly className?: string;
}

/** The chats that wait for the person, run or have a new answer. Nothing shows when none does. */
export function NeedsYouCard({
  chats,
  projects,
  stateOf,
  onOpenChat,
  className = "",
}: NeedsYouProps): ReactElement | null {
  const { needsYou } = homeChats(chats, stateOf);
  if (needsYou.length === 0) return null;
  const byId = new Map(projects.map((project) => [project.id, project]));
  return (
    <section className={`card home-card ${className}`} aria-label="Needs you">
      <h2 className="home-card-title">Needs you</h2>
      <ChatRows
        chats={needsYou}
        projectOf={(chat) => (chat.projectId === null ? undefined : byId.get(chat.projectId))}
        onOpenChat={onOpenChat}
        now={new Date()}
      />
    </section>
  );
}

interface ProjectsHomeProps {
  /** Every project, whatever the filters of the list. Null while they load. */
  readonly projects: readonly Project[] | null;
  /** The first chat of each tree, the newest first. */
  readonly chats: readonly SessionRecord[];
  readonly stateOf: (chat: SessionRecord) => ChatState;
  readonly onOpenChat: (chat: SessionRecord) => void;
  readonly onOpenProject: (project: Project) => void;
  /** A press on a count filters the list by that status. */
  readonly onFilterStatus: (status: ProjectStatus) => void;
}

/** The statuses of the counts, in the order of the filter chips. */
const countedStatuses = ["active", "in-use", "idea", "paused"] as const;

export function ProjectsHome({
  projects,
  chats,
  stateOf,
  onOpenChat,
  onOpenProject,
  onFilterStatus,
}: ProjectsHomeProps): ReactElement {
  const now = new Date();
  const [picked, setYear] = useState<YearChoice>(now.getFullYear());
  const known = projects ?? [];
  const years = projectYears(known, now);
  // A picked year can lose its last project, such as after a rename: this year then shows.
  const year = picked === "all" || years.includes(picked) ? picked : now.getFullYear();
  const byId = new Map(known.map((project) => [project.id, project]));
  const projectOf = (chat: SessionRecord): Project | undefined =>
    chat.projectId === null ? undefined : byId.get(chat.projectId);
  const { needsYou, recent } = homeChats(chats, stateOf);
  const shown = timeline(known, year, now);
  const counts = statusCounts(known, year);
  const yearWords = year === "all" ? "In all" : `In ${String(year)}`;
  return (
    <>
      <div className="main-header">
        <div className="header-text">
          <h1>Projects</h1>
          <div className="sub">{projects === null ? "" : `${String(known.length)} in total`}</div>
        </div>
        <div className="filter-chips" role="group" aria-label="Year">
          {[...years, "all" as const].map((choice) => (
            <button key={choice} className="filter-chip" aria-pressed={year === choice} onClick={() => setYear(choice)}>
              {choice === "all" ? "All" : String(choice)}
            </button>
          ))}
        </div>
      </div>
      <div className="projects-home">
        <NeedsYouCard chats={chats} projects={known} stateOf={stateOf} onOpenChat={onOpenChat} />
        <section className="card home-card" aria-label="Recent">
          <h2 className="home-card-title">Recent</h2>
          {recent.length === 0 ? (
            <span className="muted">{needsYou.length === 0 ? "No Project chats yet." : "No other chats yet."}</span>
          ) : (
            <ChatRows
              chats={recent.map((chat) => ({ chat, state: null }))}
              projectOf={projectOf}
              onOpenChat={onOpenChat}
              now={now}
            />
          )}
        </section>
        {projects === null ? (
          <CardsSkeleton label="Loading the projects…" cards={2} />
        ) : (
          <>
            <section className="card home-card" aria-label="Timeline">
              <h2 className="home-card-title">Timeline</h2>
              {shown.rows.length === 0 ? (
                <span className="muted">
                  No active or paused project {year === "all" ? "yet" : `in ${String(year)}`}.
                </span>
              ) : (
                <div className="timeline">
                  <div className={`timeline-marks${year === "all" ? "" : " months"}`} aria-hidden="true">
                    {shown.marks.map((mark) => (
                      <span key={mark.label} style={{ left: `${String(mark.at * 100)}%` }}>
                        {mark.label}
                      </span>
                    ))}
                  </div>
                  {shown.rows.map((row) => (
                    <button
                      key={row.project.id}
                      className={`timeline-row ${row.status}`}
                      aria-label={`${row.title}, ${statusLabels[row.status]}`}
                      style={colorStyle(row.project)}
                      onClick={() => onOpenProject(row.project)}
                    >
                      <span className="timeline-name">
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
                        {/* A state shows with a word too, never with colour alone. */}
                        {row.status === "paused" && (
                          <span className="timeline-word" style={{ left: `${String(row.start * 100)}%` }}>
                            Paused
                          </span>
                        )}
                        {shown.today !== null && (
                          <span className="timeline-today" style={{ left: `${String(shown.today * 100)}%` }} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="home-counts" aria-label={`Projects by status, ${yearWords.toLowerCase()}`}>
              <div className="home-count-row">
                {countedStatuses.map((status) => (
                  <button key={status} className="card home-count" onClick={() => onFilterStatus(status)}>
                    <StatusPill pill={statusPill(status)} />
                    <b>{counts[status]}</b>
                  </button>
                ))}
              </div>
              <span className="muted">
                {yearWords}: {countOf(counts.started, "project")} started.
              </span>
            </section>
          </>
        )}
      </div>
    </>
  );
}

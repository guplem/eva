/**
 * The Projects page with no project open (#840): the chats that need the person, the recent chats,
 * and the statistics of a time range (#878).
 */
import type { ReactElement } from "react";
import type { Project, SessionRecord } from "./api.ts";
import { chatTime, type ChatState } from "./chat-list.ts";
import { ChatStatePill } from "./ChatHeader.tsx";
import { CardsSkeleton } from "./Loading.tsx";
import { colorStyle, ProjectStats, RangePicker } from "./ProjectStats.tsx";
import { homeChats, projectInitials, type RangeChoice } from "./projects-home.ts";
import type { StatusCount } from "./project-format.ts";

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
  /** A press on a count filters the list by that status, or by In use. */
  readonly onFilterStatus: (count: StatusCount) => void;
  /** The time range of the statistics. The page of the statistics shares it. */
  readonly range: RangeChoice;
  readonly onRangeChange: (choice: RangeChoice) => void;
}

export function ProjectsHome({
  projects,
  chats,
  stateOf,
  onOpenChat,
  onOpenProject,
  onFilterStatus,
  range,
  onRangeChange,
}: ProjectsHomeProps): ReactElement {
  const now = new Date();
  const known = projects ?? [];
  const byId = new Map(known.map((project) => [project.id, project]));
  const projectOf = (chat: SessionRecord): Project | undefined =>
    chat.projectId === null ? undefined : byId.get(chat.projectId);
  const { needsYou, recent } = homeChats(chats, stateOf);
  return (
    <>
      <div className="main-header">
        <div className="header-text">
          <h1>Projects</h1>
          <div className="sub">{projects === null ? "" : `${String(known.length)} in total`}</div>
        </div>
        <RangePicker choice={range} projects={known} onChange={onRangeChange} />
      </div>
      <div className="projects-home">
        {projects === null ? (
          <CardsSkeleton label="Loading the projects…" cards={3} />
        ) : (
          <>
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
            <ProjectStats
              projects={known}
              range={range}
              onOpenProject={onOpenProject}
              onFilterStatus={onFilterStatus}
            />
          </>
        )}
      </div>
    </>
  );
}

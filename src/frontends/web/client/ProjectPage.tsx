/** The page of one project: its details, its warnings, and one card per clone with its chats. */
import type { ReactElement } from "react";
import type { CloneDetails, Project, SessionRecord } from "./api.ts";
import { Icon } from "./icons.tsx";
import { changesPill, projectFolder, repositoryLabel, statusPill, type Pill } from "./project-format.ts";
import { chatTime } from "./chat-list.ts";
import { CardsSkeleton } from "./Loading.tsx";

interface ProjectPageProps {
  readonly project: Project;
  /** Null while they load. */
  readonly clones: readonly CloneDetails[] | null;
  /** The root chats of each clone, by clone path. */
  readonly chatsOf: (clone: CloneDetails) => readonly SessionRecord[];
  /** Whether a chat waits for a yes or a no from the person. */
  readonly needsYou: (chat: SessionRecord) => boolean;
  readonly error: string | null;
  readonly onBackToList: () => void;
  readonly onDetails: () => void;
  readonly onSetup: () => void;
  readonly onNewClone: () => void;
  readonly onOpenChat: (clone: CloneDetails, chat: SessionRecord) => void;
  readonly onNewChat: (clone: CloneDetails) => void;
}

export function ProjectPage({
  project,
  clones,
  chatsOf,
  needsYou,
  error,
  onBackToList,
  onDetails,
  onSetup,
  onNewClone,
  onOpenChat,
  onNewChat,
}: ProjectPageProps): ReactElement {
  const now = new Date();
  return (
    <>
      <div className="main-header">
        {/* A phone shows the list as its own page, so this is the way back to it. */}
        <BackButton label="Back to the list" onClick={onBackToList} className="phone-only" />
        <div className="header-text">
          <div className="header-title">
            <h1>{project.title}</h1>
            <StatusPill pill={statusPill(project.frontMatter.status)} />
          </div>
          <div className="sub mono">{projectFolder(project.path)}</div>
        </div>
        <button className="outline" onClick={onDetails}>
          <Icon name="pen" /> Details
        </button>
        <button className="soft" onClick={onSetup}>
          Repository setup
        </button>
        <button className="primary" onClick={onNewClone}>
          <Icon name="plus" /> New clone
        </button>
      </div>
      <div className="project-page">
        <Warnings project={project} />
        {project.description !== null && <p className="muted">{project.description}</p>}
        {(project.frontMatter.tags.length > 0 || project.frontMatter.repos.length > 0) && (
          <div className="tags">
            {project.frontMatter.tags.map((tag) => (
              <span key={`tag-${tag}`} className="tag">
                #{tag}
              </span>
            ))}
            {project.frontMatter.repos.map((repo) => (
              <span key={`repo-${repo}`} className="mode-chip">
                <Icon name="globe" /> {repositoryLabel(repo)}
              </span>
            ))}
          </div>
        )}
        {error !== null && (
          <div className="warning-banner" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        {clones === null ? (
          <CardsSkeleton label="Loading the clones…" cards={2} />
        ) : clones.length === 0 ? (
          <p className="muted">No clones yet. "New clone" copies the repository into this project.</p>
        ) : (
          <div className="clone-grid">
            {clones.map((clone) => (
              <CloneCard
                key={clone.path}
                clone={clone}
                chats={chatsOf(clone)}
                needsYou={needsYou}
                now={now}
                onOpenChat={(chat) => onOpenChat(clone, chat)}
                onNewChat={() => onNewChat(clone)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface CloneCardProps {
  readonly clone: CloneDetails;
  readonly chats: readonly SessionRecord[];
  readonly now: Date;
  readonly needsYou: (chat: SessionRecord) => boolean;
  readonly onOpenChat: (chat: SessionRecord) => void;
  readonly onNewChat: () => void;
}

function CloneCard({ clone, chats, now, needsYou, onOpenChat, onNewChat }: CloneCardProps): ReactElement {
  return (
    <section className="card clone-card" aria-label={`Clone ${clone.name}`}>
      <div className="clone-head">
        <span className="round-icon">
          <Icon name="branch" />
        </span>
        <div className="header-text">
          <b>{clone.name}</b>
          {clone.branch !== null && <div className="sub mono">{clone.branch}</div>}
        </div>
        {clone.pullRequest !== null && <span className="pill idle">PR #{clone.pullRequest}</span>}
        <StatusPill pill={changesPill(clone.changes)} />
      </div>
      {chats.map((chat) => (
        <button key={chat.id} className="clone-chat" onClick={() => onOpenChat(chat)}>
          <Icon name="chat" />
          <span className="clone-chat-title">{chat.title}</span>
          {needsYou(chat) && <span className="status-pill needs-you">Needs you</span>}
          <span className="muted">{chatTime(new Date(chat.lastTurnAt ?? chat.createdAt), now)}</span>
        </button>
      ))}
      <div>
        <button className="soft small" onClick={onNewChat}>
          <Icon name="plus" /> New chat here
        </button>
      </div>
    </section>
  );
}

/** The warnings of a project's front matter, in full: a phone has no hover for a tooltip. */
function Warnings({ project }: { readonly project: Project }): ReactElement | null {
  if (project.warnings.length === 0) return null;
  return (
    <div className="warning-banner">
      <Icon name="alert" />
      <ul aria-label={`Warnings of ${project.title}`}>
        {project.warnings.map((warning, index) => (
          <li key={`${String(index)}-${warning}`}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/** A pill with a dot, so the state has a shape and not only a colour. */
export function StatusPill({ pill }: { readonly pill: Pill | null }): ReactElement | null {
  if (pill === null) return null;
  return <span className={`pill dot ${pill.tone}`}>{pill.text}</span>;
}

export function BackButton({
  label,
  onClick,
  className = "",
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
}): ReactElement {
  return (
    <button className={`icon-button ${className}`} aria-label={label} onClick={onClick}>
      <Icon name="back" />
    </button>
  );
}

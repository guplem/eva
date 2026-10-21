/** The page of one project: its details, its warnings, and one card per clone with its chats. */
import type { ReactElement } from "react";
import type { CloneDetails, Project, SessionRecord } from "./api.ts";
import { Icon } from "./icons.tsx";
import {
  canPush,
  changesPill,
  projectFolder,
  repositoryLabel,
  statusPill,
  syncPills,
  type Pill,
} from "./project-format.ts";
import { chatTime } from "./chat-list.ts";
import { CardsSkeleton, ProgressBar } from "./Loading.tsx";
import { chatListItems, type ChatAction } from "./ChatHeader.tsx";
import { useContextMenu } from "./Menu.tsx";

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
  /** With an action, the chat opens and its header starts it, as the context menu asks. */
  readonly onOpenChat: (clone: CloneDetails, chat: SessionRecord, action?: ChatAction) => void;
  readonly onNewChat: (clone: CloneDetails) => void;
  /** What Eva does with the remotes now, such as "Eva checks the remotes.", or null. */
  readonly syncWork: string | null;
  /** The clone whose pull runs now, or null. */
  readonly pulling: string | null;
  readonly onCheckRemotes: () => void;
  readonly onPullAll: () => void;
  readonly onPull: (clone: CloneDetails) => void;
  readonly onPush: (clone: CloneDetails) => void;
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
  syncWork,
  pulling,
  onCheckRemotes,
  onPullAll,
  onPull,
  onPush,
}: ProjectPageProps): ReactElement {
  const now = new Date();
  const behind = clones?.filter((clone) => (clone.behind ?? 0) > 0).length ?? 0;
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
          <>
            <div className="button-row">
              <button className="soft small" disabled={syncWork !== null} onClick={onCheckRemotes}>
                <Icon name="sync" /> Check remotes
              </button>
              {behind > 0 && (
                <button className="soft small" disabled={syncWork !== null} onClick={onPullAll}>
                  <Icon name="download" /> Pull all ({behind})
                </button>
              )}
            </div>
            {syncWork !== null && <ProgressBar label={syncWork} />}
            <div className="clone-grid">
              {clones.map((clone) => (
                <CloneCard
                  key={clone.path}
                  clone={clone}
                  chats={chatsOf(clone)}
                  needsYou={needsYou}
                  now={now}
                  onOpenChat={(chat, action) => onOpenChat(clone, chat, action)}
                  onNewChat={() => onNewChat(clone)}
                  pulling={pulling === clone.name}
                  syncBusy={syncWork !== null}
                  onPull={() => onPull(clone)}
                  onPush={() => onPush(clone)}
                />
              ))}
            </div>
          </>
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
  readonly onOpenChat: (chat: SessionRecord, action?: ChatAction) => void;
  readonly onNewChat: () => void;
  readonly pulling: boolean;
  /** A check or a pull of all clones runs, so a pull of one waits. */
  readonly syncBusy: boolean;
  readonly onPull: () => void;
  readonly onPush: () => void;
}

function CloneCard({
  clone,
  chats,
  now,
  needsYou,
  onOpenChat,
  onNewChat,
  pulling,
  syncBusy,
  onPull,
  onPush,
}: CloneCardProps): ReactElement {
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
        {syncPills(clone.ahead, clone.behind).map((pill) => (
          <StatusPill key={pill.text} pill={pill} />
        ))}
      </div>
      {chats.map((chat) => (
        <CloneChat
          key={chat.id}
          chat={chat}
          time={chatTime(new Date(chat.lastTurnAt ?? chat.createdAt), now)}
          needsYou={needsYou(chat)}
          onOpen={(action) => onOpenChat(chat, action)}
        />
      ))}
      <div className="button-row">
        <button className="soft small" onClick={onNewChat}>
          <Icon name="plus" /> New chat here
        </button>
        {(clone.behind ?? 0) > 0 && (
          <button className="soft small" disabled={pulling || syncBusy} onClick={onPull}>
            <Icon name="download" /> Pull
          </button>
        )}
        {canPush(clone) && (
          <button className="soft small" disabled={pulling} onClick={onPush}>
            <Icon name="send" /> Push
          </button>
        )}
      </div>
      {pulling && <ProgressBar label={`Eva pulls ${clone.name}.`} />}
    </section>
  );
}

/** One chat of a clone. Its context menu has the same actions as a chat in the Assistant list. */
function CloneChat({
  chat,
  time,
  needsYou,
  onOpen,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly needsYou: boolean;
  readonly onOpen: (action?: ChatAction) => void;
}): ReactElement {
  const { props, menu } = useContextMenu(
    chatListItems(() => onOpen(), onOpen),
    `Actions of “${chat.title}”`,
  );
  return (
    <>
      <button className="clone-chat" onClick={() => onOpen()} {...props}>
        <Icon name="chat" />
        <span className="clone-chat-title">{chat.title}</span>
        {needsYou && <span className="status-pill needs-you">Needs you</span>}
        <span className="muted">{time}</span>
      </button>
      {menu}
    </>
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

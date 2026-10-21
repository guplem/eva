/** The page of one project: its details, its warnings, and one card per clone with its chats. */
import { useState, type ReactElement } from "react";
import type { CloneDetails, Project, SessionRecord } from "./api.ts";
import { Icon } from "./icons.tsx";
import {
  canPush,
  changesPill,
  countOf,
  projectFolder,
  repositoryLabel,
  statusPill,
  syncPills,
  type Pill,
} from "./project-format.ts";
import { chatTime } from "./chat-list.ts";
import { CardsSkeleton, ProgressBar } from "./Loading.tsx";
import { Dialog } from "./ChatPanel.tsx";
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
  /** Whether Eva runs a turn now in a chat or one of its forks. */
  readonly isWorking: (chat: SessionRecord) => boolean;
  readonly error: string | null;
  readonly onBackToList: () => void;
  readonly onDetails: () => void;
  readonly onSetup: () => void;
  readonly onNewClone: () => void;
  /** With an action, the chat opens and its header starts it, as the context menu asks. */
  readonly onOpenChat: (clone: CloneDetails, chat: SessionRecord, action?: ChatAction) => void;
  readonly onNewChat: (clone: CloneDetails) => void;
  /** Rejects when Eva cannot delete the clone, so the question stays open. */
  readonly onDeleteClone: (clone: CloneDetails) => Promise<void>;
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
  isWorking,
  error,
  onBackToList,
  onDetails,
  onSetup,
  onNewClone,
  onOpenChat,
  onNewChat,
  onDeleteClone,
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
                  isWorking={isWorking}
                  now={now}
                  onOpenChat={(chat, action) => onOpenChat(clone, chat, action)}
                  onNewChat={() => onNewChat(clone)}
                  onDelete={() => onDeleteClone(clone)}
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
  readonly isWorking: (chat: SessionRecord) => boolean;
  readonly onOpenChat: (chat: SessionRecord, action?: ChatAction) => void;
  readonly onNewChat: () => void;
  readonly onDelete: () => Promise<void>;
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
  isWorking,
  onOpenChat,
  onNewChat,
  onDelete,
  pulling,
  syncBusy,
  onPull,
  onPush,
}: CloneCardProps): ReactElement {
  const [deleting, setDeleting] = useState(false);
  // On the head only: a chat row has its own menu, and a right click there must not open two.
  const { props, menu } = useContextMenu(
    [
      { label: "New chat here", icon: "plus", onChoose: onNewChat },
      { label: "Delete clone", icon: "trash", danger: true, onChoose: () => setDeleting(true) },
    ],
    `Actions of the clone ${clone.name}`,
  );
  return (
    <section className="card clone-card" aria-label={`Clone ${clone.name}`}>
      {menu}
      {deleting && (
        <DeleteCloneDialog
          clone={clone}
          chats={chats}
          working={chats.filter(isWorking)}
          onDelete={onDelete}
          onClose={() => setDeleting(false)}
        />
      )}
      <div className="clone-head" {...props}>
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
          <button className="soft small" disabled={pulling || syncBusy} onClick={onPush}>
            <Icon name="send" /> Push
          </button>
        )}
      </div>
      {pulling && <ProgressBar label={`Eva pulls ${clone.name}.`} />}
    </section>
  );
}

/**
 * Asks before a clone goes. A clone with chats asks louder and wants a tick, because its chats go too.
 * A clone where Eva works now cannot go: the core refuses it, so the button waits.
 */
function DeleteCloneDialog({
  clone,
  chats,
  working,
  onDelete,
  onClose,
}: {
  readonly clone: CloneDetails;
  readonly chats: readonly SessionRecord[];
  readonly working: readonly SessionRecord[];
  readonly onDelete: () => Promise<void>;
  readonly onClose: () => void;
}): ReactElement {
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasChats = chats.length > 0;
  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch {
      // The page showed the error. The question stays, so the person can try again or cancel.
      setBusy(false);
    }
  };
  return (
    <Dialog label={`Delete the clone ${clone.name}`} onClose={busy ? ignore : onClose} closeLabel="Cancel">
      <h2>Delete the clone “{clone.name}”?</h2>
      <div className="callout warning">
        Eva deletes this folder from this computer. Work that is only here is lost for good:
        {clone.changes !== null && clone.changes > 0 && <> {countOf(clone.changes, "changed file")},</>} commits that
        you did not push, and files that git ignores, such as <span className="mono">.env</span>.
      </div>
      {hasChats && (
        <div className="callout danger" role="alert">
          <strong>
            <Icon name="alert" /> This clone has {countOf(chats.length, "chat")}.{" "}
            {chats.length === 1 ? "Eva deletes it too, with its forks." : "Eva deletes them too, with their forks."}
          </strong>
          <ul>
            {chats.map((chat) => (
              <li key={chat.id}>
                {chat.title}
                {working.includes(chat) && <b> (Eva works in it now)</b>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {working.length > 0 && (
        <div className="callout danger">Eva works in this clone now. Stop her work in it, then delete the clone.</div>
      )}
      {hasChats && (
        <label className="check-row">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          <span>I understand that the clone and its {countOf(chats.length, "chat")} go for good</span>
        </label>
      )}
      <button
        className="danger"
        disabled={busy || working.length > 0 || (hasChats && !understood)}
        onClick={() => void remove()}
      >
        <Icon name="trash" /> {hasChats ? "Delete the clone and its chats" : "Delete the clone"}
      </button>
      {busy && <ProgressBar label="Deleting the clone…" />}
    </Dialog>
  );
}

function ignore(): void {
  // Nothing to do: while the delete runs, the dialog closes only when it ends.
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

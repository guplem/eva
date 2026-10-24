/**
 * The page of one project: its warnings, its facts with quick links, and one card per clone with its
 * chats. The clones grid ends with the card that makes a new clone, so a project with no clones still
 * shows the way to start (issue 392).
 */
import { useState, type ReactElement } from "react";
import type { CloneDetails, Project, RepositoryDetails, SessionRecord } from "./api.ts";
import { Icon } from "./icons.tsx";
import {
  canPush,
  changesPill,
  countOf,
  projectFolder,
  repositoryLabel,
  repositoryWebUrl,
  statusPill,
  syncPills,
  type Pill,
} from "./project-format.ts";
import { chatTime, type ChatState } from "./chat-list.ts";
import { ButtonSpinner, CardsSkeleton, ProgressBar } from "./Loading.tsx";
import { Dialog } from "./Dialog.tsx";
import { ChatStatePill, chatListItems, type ChatAction } from "./ChatHeader.tsx";
import { useContextMenu } from "./Menu.tsx";
import { fileAddressOf } from "./file-paths.ts";

interface ProjectPageProps {
  readonly project: Project;
  /** Null while they load. */
  readonly clones: readonly CloneDetails[] | null;
  /** The read of the clones failed, so an empty list does not mean that the project has none. */
  readonly clonesFailed: boolean;
  /** The root chats of each clone, by clone path. */
  readonly chatsOf: (clone: CloneDetails) => readonly SessionRecord[];
  /** Whether a chat needs the person, works, or has an answer that the person did not see. */
  readonly stateOf: (chat: SessionRecord) => ChatState;
  /** Whether Eva runs a turn now in a chat or one of its forks. */
  readonly isWorking: (chat: SessionRecord) => boolean;
  readonly error: string | null;
  readonly onBackToList: () => void;
  readonly onDetails: () => void;
  readonly onSetup: () => void;
  readonly onNewClone: () => void;
  /** With an action, the chat opens and its header starts it, as the context menu asks. */
  readonly onOpenChat: (clone: CloneDetails, chat: SessionRecord, action?: ChatAction) => void;
  /** Eva picks the clone of the new chat: a free one, or a new one. */
  readonly onNewChat: () => void;
  /** True while Eva picks or prepares the clone of a new chat. */
  readonly startingChat: boolean;
  /** Rejects when Eva cannot delete the clone, so the question stays open. */
  readonly onDeleteClone: (clone: CloneDetails) => Promise<void>;
  /** What Eva does with the remotes now, such as "Eva checks the remotes.", or null. */
  readonly syncWork: string | null;
  /** The repository whose pull runs now, as `<clone>/<repository>`, or null. */
  readonly pulling: string | null;
  readonly onCheckRemotes: () => void;
  readonly onPullAll: () => void;
  readonly onPull: (clone: CloneDetails, repository: RepositoryDetails) => void;
  readonly onPush: (clone: CloneDetails, repository: RepositoryDetails) => void;
}

export function ProjectPage({
  project,
  clones,
  clonesFailed,
  chatsOf,
  stateOf,
  isWorking,
  error,
  onBackToList,
  onDetails,
  onSetup,
  onNewClone,
  onOpenChat,
  onNewChat,
  startingChat,
  onDeleteClone,
  syncWork,
  pulling,
  onCheckRemotes,
  onPullAll,
  onPull,
  onPush,
}: ProjectPageProps): ReactElement {
  const now = new Date();
  const behind =
    clones?.flatMap((clone) => clone.repositories).filter((repository) => (repository.behind ?? 0) > 0).length ?? 0;
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
        <button className="primary" disabled={startingChat} aria-busy={startingChat} onClick={onNewChat}>
          {startingChat ? <ButtonSpinner /> : <Icon name="plus" />} New chat
        </button>
        <button className="outline" onClick={onDetails}>
          <Icon name="pen" /> Details
        </button>
        <button className="soft" onClick={onSetup}>
          Repository setup
        </button>
      </div>
      <div className="project-page">
        <Warnings project={project} />
        {startingChat && <ProgressBar label="Eva looks for a free clone, or makes a new one." />}
        <ProjectFacts project={project} />
        {error !== null && (
          <div className="warning-banner" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        <section className="clones-section" aria-labelledby="clones-heading">
          <h2 id="clones-heading">Clones</h2>
          {clones === null ? (
            <CardsSkeleton label="Loading the clones…" cards={2} />
          ) : (
            <>
              {clones.length > 0 && (
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
              )}
              {/* Each open checks the remotes, but a project with no clone has none to check. */}
              {syncWork !== null && clones.length > 0 && <ProgressBar label={syncWork} />}
              <div className="clone-grid">
                {clones.map((clone) => (
                  <CloneCard
                    key={clone.path}
                    clone={clone}
                    chats={chatsOf(clone)}
                    stateOf={stateOf}
                    isWorking={isWorking}
                    now={now}
                    onOpenChat={(chat, action) => onOpenChat(clone, chat, action)}
                    onDelete={() => onDeleteClone(clone)}
                    pulling={pulling}
                    syncBusy={syncWork !== null}
                    onPull={(repository) => onPull(clone, repository)}
                    onPush={(repository) => onPush(clone, repository)}
                  />
                ))}

                <NewCloneCard first={clones.length === 0 && !clonesFailed} onNewClone={onNewClone} />
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * What the front matter says, and the quick links: each repository's web page and the project folder
 * in Files. A repository with no web page, such as a local remote, stays plain text.
 */
function ProjectFacts({ project }: { readonly project: Project }): ReactElement | null {
  const { created, tags, repos } = project.frontMatter;
  const hasFacts = created !== null || tags.length > 0;
  const hasLinks = repos.length > 0 || project.vaultFolder !== null;
  if (project.description === null && !hasFacts && !hasLinks) return null;
  return (
    <section className="card project-facts" aria-label="Project facts">
      {project.description !== null && <p>{project.description}</p>}
      {hasFacts && (
        <dl className="chat-facts">
          {created !== null && (
            <>
              <dt>Created</dt>
              <dd className="mono">{created}</dd>
            </>
          )}
          {tags.length > 0 && (
            <>
              <dt>Tags</dt>
              <dd className="tags">
                {tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
      {hasLinks && (
        <div className="tags">
          {repos.map((repo) => {
            const url = repositoryWebUrl(repo);
            return url === null ? (
              <span key={repo} className="mode-chip">
                <Icon name="globe" /> {repositoryLabel(repo)}
              </span>
            ) : (
              // The arrow icon, not only the colour, tells a link from a plain chip.
              <a key={repo} className="mode-chip link-chip" href={url} target="_blank" rel="noreferrer">
                <Icon name="external" /> {repositoryLabel(repo)}
              </a>
            );
          })}
          {project.vaultFolder !== null && (
            <a className="mode-chip link-chip" href={fileAddressOf(project.vaultFolder)}>
              <Icon name="folder" /> Open in Files
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/** The last card of the clones grid. With no clone yet, it says what a clone is. */
function NewCloneCard({
  first,
  onNewClone,
}: {
  readonly first: boolean;
  readonly onNewClone: () => void;
}): ReactElement {
  return (
    <div className="card clone-new">
      <p className="muted">
        {first
          ? "No clones yet. A clone is a copy of every repository of the project, where you and Eva work."
          : "A new clone is another copy of every repository, for work beside the others."}
      </p>
      <button className="primary" onClick={onNewClone}>
        <Icon name="plus" /> New clone
      </button>
    </div>
  );
}

interface CloneCardProps {
  readonly clone: CloneDetails;
  readonly chats: readonly SessionRecord[];
  readonly now: Date;
  readonly stateOf: (chat: SessionRecord) => ChatState;
  readonly isWorking: (chat: SessionRecord) => boolean;
  readonly onOpenChat: (chat: SessionRecord, action?: ChatAction) => void;
  readonly onDelete: () => Promise<void>;
  /** The repository whose pull runs now, as `<clone>/<repository>`, or null. */
  readonly pulling: string | null;
  /** A check or a pull of all clones runs, so a pull of one waits. */
  readonly syncBusy: boolean;
  readonly onPull: (repository: RepositoryDetails) => void;
  readonly onPush: (repository: RepositoryDetails) => void;
}

/** A clone holds every repository of the project (issue 521), so the card has one row for each. */
function CloneCard({
  clone,
  chats,
  now,
  stateOf,
  isWorking,
  onOpenChat,
  onDelete,
  pulling,
  syncBusy,
  onPull,
  onPush,
}: CloneCardProps): ReactElement {
  const [deleting, setDeleting] = useState(false);
  // On the head only: a chat row has its own menu, and a right click there must not open two.
  const { props, menu } = useContextMenu(
    [{ label: "Delete clone", icon: "trash", danger: true, onChoose: () => setDeleting(true) }],
    `Actions of the clone ${clone.name}`,
  );
  const pullingHere = clone.repositories.find((repository) => pulling === `${clone.name}/${repository.name}`);
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
          <Icon name="folder" />
        </span>
        <div className="header-text">
          <b>{clone.name}</b>
        </div>
      </div>
      {clone.repositories.map((repository) => (
        <RepositoryRow
          key={repository.path}
          repository={repository}
          busy={pulling !== null || syncBusy}
          onPull={() => onPull(repository)}
          onPush={() => onPush(repository)}
        />
      ))}
      {chats.map((chat) => (
        <CloneChat
          key={chat.id}
          chat={chat}
          time={chatTime(new Date(chat.lastTurnAt ?? chat.createdAt), now)}
          state={stateOf(chat)}
          onOpen={(action) => onOpenChat(chat, action)}
        />
      ))}
      {pullingHere !== undefined && <ProgressBar label={`Eva pulls ${pullingHere.name}.`} />}
    </section>
  );
}

/** One repository of a clone: its branch, pull request, changes and sync, with its own Pull and Push. */
function RepositoryRow({
  repository,
  busy,
  onPull,
  onPush,
}: {
  readonly repository: RepositoryDetails;
  /** A pull runs, so the buttons wait. */
  readonly busy: boolean;
  readonly onPull: () => void;
  readonly onPush: () => void;
}): ReactElement {
  return (
    <div className="clone-repository" aria-label={`Repository ${repository.name}`}>
      <div className="repository-head">
        <Icon name="branch" />
        <div className="header-text">
          <b>{repository.name}</b>
          {repository.branch !== null && <div className="sub mono">{repository.branch}</div>}
        </div>
        {repository.pullRequest !== null && <span className="pill idle">PR #{repository.pullRequest}</span>}
        <StatusPill pill={changesPill(repository.changes)} />
        {syncPills(repository.ahead, repository.behind).map((pill) => (
          <StatusPill key={pill.text} pill={pill} />
        ))}
      </div>
      {((repository.behind ?? 0) > 0 || canPush(repository)) && (
        <div className="button-row">
          {(repository.behind ?? 0) > 0 && (
            <button className="soft small" disabled={busy} onClick={onPull}>
              <Icon name="download" /> Pull
            </button>
          )}
          {canPush(repository) && (
            <button className="soft small" disabled={busy} onClick={onPush}>
              <Icon name="send" /> Push
            </button>
          )}
        </div>
      )}
    </div>
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
  const changes = clone.repositories.reduce((sum, repository) => sum + (repository.changes ?? 0), 0);
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
        {changes > 0 && <> {countOf(changes, "changed file")},</>} commits that you did not push, and files that git
        ignores, such as <span className="mono">.env</span>.
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
  state,
  onOpen,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly state: ChatState;
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
        {/* Eva reused the clone of a closed chat: it can be read, but takes no message. */}
        {chat.closed && <span className="pill idle">Closed</span>}
        <ChatStatePill state={state} />
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

/**
 * Project mode: the projects with search and filter chips, the page of one project with a card per
 * clone, the chat of a clone with a header that says where it runs, the project details, and the
 * repository setup.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { api, type CloneDetails, type Project, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { chatTree, Conversation, DeleteChatButton, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { ChatInfoButton, ChatPanel, tasksOf } from "./ChatPanel.tsx";
import { Icon } from "./icons.tsx";
import { ProjectDetailsEditor } from "./ProjectDetailsEditor.tsx";
import { ProjectPage, StatusPill } from "./ProjectPage.tsx";
import { RepositorySetup } from "./RepositorySetup.tsx";
import { countOf, projectSummary, statusPill } from "./project-format.ts";

interface ProjectViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  /** The chat that the address names; its project and clone open with it. */
  readonly linkedChat: SessionRecord | null;
  readonly onLinkedChatOpened: () => void;
}

/**
 * The filter words that parseProjectQuery reads in the search text. A typed word wins over its
 * chip. Keep these patterns in step with the parser in `core/projects/project-catalog.ts`.
 */
const statusWordPattern = /(^|\s)status:(idea|active|paused|closed|any)(\s|$)/i;
const tagWordPattern = /(^|\s)(tag:|#)\S/i;

const statusChips = [
  { value: "active", text: "Active" },
  { value: "idea", text: "Idea" },
  { value: "paused", text: "Paused" },
  { value: "closed", text: "Closed" },
] as const;

/** What the main column shows. No page means the list is the page on a phone. */
type Page =
  | { readonly kind: "project" | "details" | "setup"; readonly project: Project }
  | { readonly kind: "chat"; readonly project: Project; readonly clone: CloneDetails; readonly chatId: string };

export function ProjectView({
  sessions,
  live,
  sidebarOpen,
  onChanged,
  onNavigate,
  linkedChat,
  onLinkedChatOpened,
}: ProjectViewProps): ReactElement {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [tag, setTag] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loaded, setLoaded] = useState<{ readonly projectId: string; readonly clones: CloneDetails[] } | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const showError = useShowError();

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .projects(search, statusWordPattern.test(search) ? "" : status, tagWordPattern.test(search) ? "" : tag)
        .then(setProjects, showError);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, status, tag, listVersion, showError]);

  // The tags come from every project, so a tag of a closed project is offered too.
  useEffect(() => {
    api.projects("", "").then((all) => setAllTags(tagsOf(all)), showError);
  }, [listVersion, showError]);

  const openProjectId = page?.project.id ?? null;
  // Null while the clones of the open project load, so the page never says "No clones yet" too early,
  // and never shows the cards of the project that was open before.
  const clones = loaded !== null && loaded.projectId === openProjectId ? loaded.clones : null;
  const [cloneVersion, setCloneVersion] = useState(0);
  useEffect(() => {
    if (openProjectId === null) return;
    // A slow answer for another project must not land on this page.
    let current = true;
    api.clones(openProjectId).then(
      (details) => {
        if (current) setLoaded({ projectId: openProjectId, clones: details });
      },
      (caught: unknown) => {
        if (!current) return;
        setLoaded({ projectId: openProjectId, clones: [] });
        showError(caught);
      },
    );
    return () => {
      current = false;
    };
  }, [openProjectId, cloneVersion, showError]);

  // A linked Project chat opens in its clone, whatever the search and the filters show. A fork opens
  // as a branch of its first chat, because the page shows a chat with all its forks.
  const linkedId = linkedChat?.mode === "project" ? rootIdOf(linkedChat, sessions) : null;
  const linkedProjectId = linkedChat?.projectId ?? null;
  const linkedClone = linkedChat?.clone ?? null;
  useEffect(() => {
    if (linkedId === null) return;
    if (linkedProjectId === null || linkedClone === null) {
      showError(new Error("The linked chat has no project or clone."));
      onLinkedChatOpened();
      return;
    }
    void (async (): Promise<void> => {
      try {
        const project = (await api.projects("", "")).find((candidate) => candidate.id === linkedProjectId);
        const details = project === undefined ? [] : await api.clones(project.id);
        const clone = details.find((candidate) => candidate.name === linkedClone);
        if (project === undefined || clone === undefined) {
          showError(new Error("The linked chat's project or clone is not on this computer any more."));
        } else {
          setPage({ kind: "chat", project, clone, chatId: linkedId });
        }
      } catch (caught) {
        showError(caught);
      }
      onLinkedChatOpened();
    })();
  }, [linkedId, linkedProjectId, linkedClone, showError, onLinkedChatOpened]);

  const roots = useMemo(() => rootChats(sessions), [sessions]);
  const chatsOf = useCallback(
    (clone: CloneDetails): SessionRecord[] => roots.filter((session) => session.startFolder === clone.path),
    [roots],
  );
  // The same rule as the clone cards: a chat counts when its clone folder is still there.
  const chatCount = (project: Project): number =>
    roots.filter(
      (session) => session.projectId === project.id && session.clone !== null && project.clones.includes(session.clone),
    ).length;

  const open = (next: Page | null): void => {
    setError(null);
    setPage(next);
    // A chat may have changed files or the branch, so the clone cards ask git again.
    if (next?.kind === "project") setCloneVersion((version) => version + 1);
    onNavigate();
  };

  const startChat = async (project: Project, clone: CloneDetails): Promise<void> => {
    try {
      const chat = await api.newProjectChat(project.id, clone.name, "default");
      await onChanged();
      open({ kind: "chat", project, clone, chatId: chat.id });
    } catch (caught) {
      showError(caught);
    }
  };

  const newClone = async (project: Project): Promise<void> => {
    setError(null);
    try {
      await api.newClone(project.id);
      setCloneVersion((version) => version + 1);
      setListVersion((version) => version + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  // A saved title or status shows at once in the open page, even when the filters hide the project.
  const reloadProject = async (projectId: string): Promise<void> => {
    setListVersion((version) => version + 1);
    try {
      const fresh = (await api.projects("", "")).find((candidate) => candidate.id === projectId);
      if (fresh !== undefined)
        setPage((current) => (current?.project.id === projectId ? { ...current, project: fresh } : current));
    } catch (caught) {
      showError(caught);
    }
  };

  const chat = page?.kind === "chat" ? roots.find((candidate) => candidate.id === page.chatId) : undefined;
  // The open chat is gone, for example deleted: its project page shows again. Only a chat that was
  // on the page counts: a new chat can be missing from a session list that is late or failed.
  const [shownChatId, setShownChatId] = useState<string | null>(null);
  const shownId = chat?.id ?? null;
  useEffect(() => {
    if (shownId !== null) setShownChatId(shownId);
  }, [shownId]);
  const chatIsGone = page?.kind === "chat" && chat === undefined && shownChatId === page.chatId;
  useEffect(() => {
    if (chatIsGone) setPage((current) => (current === null ? null : { kind: "project", project: current.project }));
  }, [chatIsGone]);

  const tree = chat === undefined ? [] : chatTree(chat, sessions);
  const chatDetails = {
    tree,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };

  return (
    <div className={`layout${page === null ? " list-home" : ""}`}>
      <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Projects">
        <h2 className="list-title">Projects</h2>
        <input
          className="search-field"
          aria-label="Search projects"
          placeholder="Search projects"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="filter-chips" role="group" aria-label="Status">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              className="filter-chip"
              aria-pressed={status === chip.value}
              onClick={() => setStatus(status === chip.value ? "" : chip.value)}
            >
              {chip.text}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="filter-chips" role="group" aria-label="Tag">
            {allTags.map((candidate) => (
              <button
                key={candidate}
                className="filter-chip"
                aria-pressed={tag === candidate}
                onClick={() => setTag(tag === candidate ? "" : candidate)}
              >
                #{candidate}
              </button>
            ))}
          </div>
        )}
        {projects.length === 0 && <span className="muted">No project matches.</span>}
        {projects.map((project) => (
          <button
            key={project.id}
            className="project-card"
            aria-current={page?.project.id === project.id}
            onClick={() => open({ kind: "project", project })}
          >
            <span className="card-row">
              <b>{project.title}</b>
              <StatusPill pill={statusPill(project.frontMatter.status)} />
            </span>
            <span className="card-row muted">
              <span>{projectSummary(project.clones.length, chatCount(project))}</span>
              {project.warnings.length > 0 && (
                <span className="pill warn">{countOf(project.warnings.length, "warning")}</span>
              )}
            </span>
            {project.frontMatter.tags.length > 0 && (
              <span className="tags">
                {project.frontMatter.tags.map((candidate) => (
                  <span key={candidate} className="tag">
                    #{candidate}
                  </span>
                ))}
              </span>
            )}
          </button>
        ))}
      </nav>
      {sidebarOpen && page !== null && (
        <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />
      )}
      <main className="main">
        {page === null ? (
          <div className="empty">Pick a project.</div>
        ) : page.kind === "details" ? (
          <ProjectDetailsEditor
            key={page.project.id}
            projectId={page.project.id}
            onSaved={() => void reloadProject(page.project.id)}
            onBack={() => open({ kind: "project", project: page.project })}
          />
        ) : page.kind === "setup" ? (
          <RepositorySetup
            key={page.project.id}
            projectId={page.project.id}
            title={page.project.title}
            onBack={() => open({ kind: "project", project: page.project })}
          />
        ) : page.kind === "chat" && chat !== undefined ? (
          <>
            <div className="main-header">
              <div className="header-text">
                <h1>{chat.title}</h1>
                <div className="sub crumbs">
                  <button className="crumb" onClick={() => open({ kind: "project", project: page.project })}>
                    {page.project.title}
                  </button>
                  {" › "}
                  {page.clone.name}
                  {page.clone.branch !== null && (
                    <>
                      {" · "}
                      <span className="mono">{page.clone.branch}</span>
                    </>
                  )}
                </div>
              </div>
              {page.clone.pullRequest !== null && <span className="pill idle">PR #{page.clone.pullRequest}</span>}
              {/* Eva adds no prompt and no skill here: the chip only says which mode runs. */}
              <span className="mode-chip soft">
                <Icon name="folder" /> Project mode
              </span>
              <ChatInfoButton {...chatDetails} />
              <DeleteChatButton chat={chat} onChanged={onChanged} />
            </div>
            <Conversation root={chat} sessions={sessions} live={live} onChanged={onChanged} />
          </>
        ) : (
          <ProjectPage
            project={page.project}
            clones={clones}
            chatsOf={chatsOf}
            error={error}
            onBackToList={() => open(null)}
            onDetails={() => open({ kind: "details", project: page.project })}
            onSetup={() => open({ kind: "setup", project: page.project })}
            onNewClone={() => void newClone(page.project)}
            onOpenChat={(clone, picked) => open({ kind: "chat", project: page.project, clone, chatId: picked.id })}
            onNewChat={(clone) => void startChat(page.project, clone)}
          />
        )}
      </main>
      {/* The inspector is about one chat, so a project page has none. */}
      {chat !== undefined && <ChatPanel {...chatDetails} />}
    </div>
  );
}

/** Every tag of these projects once, in alphabetical order. The filter ignores case, so the list does too. */
function tagsOf(projects: readonly Project[]): string[] {
  return [...new Set(projects.flatMap((project) => project.frontMatter.tags.map((tag) => tag.toLowerCase())))].sort(
    (first, second) => first.localeCompare(second),
  );
}

/** The first chat of a fork's line, found through the parents that the list still has. */
function rootIdOf(chat: SessionRecord, sessions: readonly SessionRecord[]): string {
  let current = chat;
  const seen = new Set<string>();
  while (current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = sessions.find((candidate) => candidate.id === current.parentId);
    if (parent === undefined) break;
    current = parent;
  }
  return current.id;
}

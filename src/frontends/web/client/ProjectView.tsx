/**
 * Project mode: the projects with search and filter chips, the page of one project with a card per
 * clone, the chat of a clone with a header that says where it runs, the project details, and the
 * repository setup.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type ChatBlocker, type CloneDetails, type CloneFetch, type Project, type SessionRecord } from "./api.ts";
import { PushCloneDialog } from "./PushCloneDialog.tsx";
import { Toast } from "./Toast.tsx";
import { useShownChat, type ChatApprovals } from "./ApprovalCard.tsx";
import { chatState, type ChatState } from "./chat-list.ts";
import { useMarkSeen } from "./seen-chats.ts";
import type { LiveState } from "./live-state.ts";
import { seenPart } from "./branch-path.ts";
import { BranchesButton, useBranchStates, useShownBranch } from "./Branches.tsx";
import { chatTree, Conversation, rootChats, rootIdOf } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { ChatHeader, useChatActionRequest } from "./ChatHeader.tsx";
import { useContextMenu } from "./Menu.tsx";
import { ChatPanel, tasksOf, useChatPanelShown } from "./ChatPanel.tsx";
import { Icon } from "./icons.tsx";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import { ProjectDetailsEditor } from "./ProjectDetailsEditor.tsx";
import { ProjectPage, StatusPill } from "./ProjectPage.tsx";
import { RepositorySetup } from "./RepositorySetup.tsx";
import { countOf, projectSummary, shownTags, statusPill, tagsByUse } from "./project-format.ts";
import { ListSkeleton } from "./Loading.tsx";
import { askToLeave } from "./leave-guard.ts";

interface ProjectViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onShowList: () => void;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  /** The chat that the address names; its project and clone open with it. */
  readonly linkedChat: SessionRecord | null;
  readonly onLinkedChatOpened: () => void;
  /** Offline and the open problems, shown at the top of the main area. */
  readonly notices: ReactNode;
  readonly approvals: ChatApprovals;
  /** The missing setup step that stops every chat, or null. */
  readonly blocker: ChatBlocker | null;
  /** True when Eva's machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
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

/** About three rows of tag chips on a phone. */
const shortTagListLength = 6;

/** What the main column shows. No page means the list is the page on a phone. */
type Page =
  | { readonly kind: "project" | "details" | "setup"; readonly project: Project }
  | { readonly kind: "chat"; readonly project: Project; readonly clone: CloneDetails; readonly chatId: string };

export function ProjectView({
  sessions,
  live,
  sidebarOpen,
  onShowList,
  onChanged,
  onNavigate,
  linkedChat,
  onLinkedChatOpened,
  notices,
  approvals,
  blocker,
  voiceNotes,
}: ProjectViewProps): ReactElement {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [tag, setTag] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagChips = shownTags(allTags, tag, tagsOpen, shortTagListLength);
  /**
   * Null until the first read, so the list never says "No project matches." too early. "failed"
   * when the first read failed: no list is known, and a later failure keeps the list it has.
   */
  const [projects, setProjects] = useState<Project[] | "failed" | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  /** `failed` when the read failed: the project may have clones that the page cannot show. */
  const [loaded, setLoaded] = useState<{
    readonly projectId: string;
    readonly clones: CloneDetails[];
    readonly failed?: boolean;
  } | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showError = useShowError();

  useEffect(() => {
    // A slow answer to an older search must not replace the answer to a newer one.
    let isCurrent = true;
    const timer = setTimeout(() => {
      api.projects(search, statusWordPattern.test(search) ? "" : status, tagWordPattern.test(search) ? "" : tag).then(
        (found) => {
          if (isCurrent) setProjects(found);
        },
        (caught: unknown) => {
          if (!isCurrent) return;
          setProjects((current) => current ?? "failed");
          showError(caught);
        },
      );
    }, 200);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [search, status, tag, listVersion, showError]);

  // The tags come from every project, so a tag of a closed project is offered too.
  useEffect(() => {
    api.projects("", "").then((all) => setAllTags(tagsByUse(all)), showError);
  }, [listVersion, showError]);

  const openProjectId = page?.project.id ?? null;
  // Null while the clones of the open project load, so the page never says "No clones yet" too early,
  // and never shows the cards of the project that was open before.
  const clones = loaded !== null && loaded.projectId === openProjectId ? loaded.clones : null;
  const clonesFailed = clones !== null && loaded?.failed === true;
  const [cloneVersion, setCloneVersion] = useState(0);
  /** A fetch or a pull of all clones, with its project: a page shows only the work of its own project. */
  const [syncWork, setSyncWork] = useState<{ readonly projectId: string; readonly label: string } | null>(null);
  const openProjectRef = useRef<string | null>(null);
  openProjectRef.current = page?.project.id ?? null;
  const [pulling, setPulling] = useState<string | null>(null);
  /** The clone whose Push sheet is open. */
  const [pushing, setPushing] = useState<CloneDetails | null>(null);
  /** The message of the last push, for a toast. */
  const [pushed, setPushed] = useState<string | null>(null);
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
        setLoaded({ projectId: openProjectId, clones: [], failed: true });
        showError(caught);
      },
    );
    return () => {
      current = false;
    };
  }, [openProjectId, cloneVersion, showError]);

  const actionRequest = useChatActionRequest();
  const clearAction = actionRequest.clear;

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
          clearAction();
          setPage({ kind: "chat", project, clone, chatId: linkedId });
        }
      } catch (caught) {
        showError(caught);
      }
      onLinkedChatOpened();
    })();
  }, [linkedId, linkedProjectId, linkedClone, showError, onLinkedChatOpened, clearAction]);

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

  // The details page can hold unsaved changes, so each move away from it asks first.
  const open = (next: Page | null): void =>
    askToLeave(() => {
      setError(null);
      setPage(next);
      // A chat may have changed files or the branch, so the clone cards ask git again.
      if (next?.kind === "project") setCloneVersion((version) => version + 1);
      onNavigate();
    });

  const startChat = async (project: Project, clone: CloneDetails): Promise<void> => {
    try {
      const chat = await api.newProjectChat(project.id, clone.name, "default");
      await onChanged();
      open({ kind: "chat", project, clone, chatId: chat.id });
    } catch (caught) {
      showError(caught);
    }
  };

  /** Runs a fetch or a pull of all clones, and shows the fresh cards and each clone that failed. */
  const syncAll = useCallback(
    async (projectId: string, work: string, run: () => Promise<CloneFetch>): Promise<void> => {
      setSyncWork({ projectId, label: work });
      try {
        const result = await run();
        setLoaded((current) =>
          current === null || current.projectId === projectId ? { projectId, clones: result.clones } : current,
        );
        if (openProjectRef.current === projectId)
          setError(result.problems.length === 0 ? null : result.problems.join(" "));
      } catch (caught) {
        showError(caught);
      } finally {
        setSyncWork((current) => (current?.projectId === projectId ? null : current));
      }
    },
    [showError],
  );

  // A fetch on each open of a project, so the cards count the commits to pull. It needs the network,
  // so the cards show first, with the counts of the last fetch.
  useEffect(() => {
    if (openProjectId === null) return;
    void syncAll(openProjectId, "Eva checks the remote of each clone.", () => api.fetchClones(openProjectId));
  }, [openProjectId, syncAll]);

  const pullOne = async (project: Project, clone: CloneDetails): Promise<void> => {
    setPulling(clone.name);
    try {
      await api.pullClone(project.id, clone.name);
      setCloneVersion((version) => version + 1);
    } catch (caught) {
      showError(caught);
    } finally {
      setPulling(null);
    }
  };

  const pushOne = async (project: Project, clone: CloneDetails, note: string): Promise<void> => {
    const { message } = await api.pushClone(project.id, clone.name, note);
    setPushing(null);
    const subject = message.split("\n")[0] ?? "";
    setPushed(subject === "" ? `Pushed ${clone.name}.` : `Pushed ${clone.name}: ${subject}`);
    setCloneVersion((version) => version + 1);
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

  /** Rethrows, so the question stays open after a refusal. */
  const deleteClone = async (project: Project, clone: CloneDetails): Promise<void> => {
    try {
      await api.deleteClone(project.id, clone.name);
    } catch (caught) {
      showError(caught);
      throw caught;
    }
    setCloneVersion((version) => version + 1);
    setListVersion((version) => version + 1);
    // The chats of the clone are gone, so the list of chats changes too.
    await onChanged();
  };

  // The filters may hide the new project, but its page opens all the same.
  const openCreated = async (projectId: string): Promise<void> => {
    setCreating(false);
    setListVersion((version) => version + 1);
    try {
      const created = (await api.projects("", "")).find((candidate) => candidate.id === projectId);
      if (created !== undefined) open({ kind: "project", project: created });
    } catch (caught) {
      showError(caught);
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
  const branch = useShownBranch(tree, linkedChat?.id ?? null);
  const branchStates = useBranchStates(tree, branch.id, approvals.pending, live);
  // Only the chat page shows a conversation: on the other pages the tree is empty, so no chat is on screen.
  // Only the shown branch shows its requests as cards, so a hidden branch gets the notice.
  useShownChat(approvals.onShowChat, branch.id === null ? [] : [branch.id]);
  const approvalSessionIds = approvals.pending.map((approval) => approval.sessionId);
  const isWorking = (candidate: SessionRecord): boolean =>
    chatTree(candidate, sessions).some((session) => live.steps[session.id] !== undefined);
  const stateOf = (candidate: SessionRecord): ChatState =>
    chatState(chatTree(candidate, sessions), (sessionId) => live.steps[sessionId] !== undefined, approvalSessionIds);
  // On a phone, the open list covers the chat.
  useMarkSeen(branch.id === null ? [] : seenPart(tree, branch.id), !sidebarOpen);
  const [panelShown, togglePanel] = useChatPanelShown();
  const chatDetails = {
    tree,
    shownId: branch.id,
    onChanged,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };

  return (
    <div className={`layout${page === null ? " list-home" : ""}`}>
      <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Projects">
        <div className="list-title-row">
          <h2 className="list-title">Projects</h2>
          <button className="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New project
          </button>
        </div>
        <input
          className="project-search"
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
            {tagChips.shown.map((candidate) => (
              <button
                key={candidate}
                className="filter-chip"
                aria-pressed={tag === candidate}
                onClick={() => setTag(tag === candidate ? "" : candidate)}
              >
                #{candidate}
              </button>
            ))}
            {(tagsOpen || tagChips.hidden > 0) && (
              <button className="filter-chip more" aria-expanded={tagsOpen} onClick={() => setTagsOpen(!tagsOpen)}>
                {tagsOpen ? "Fewer tags" : `+${tagChips.hidden} more`}
              </button>
            )}
          </div>
        )}
        {projects === null && <ListSkeleton label="Loading the projects…" rows={4} />}
        {projects === "failed" && (
          <div className="muted" role="status">
            Eva could not read the projects.{" "}
            <button
              onClick={() => {
                setProjects(null);
                setListVersion((version) => version + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {Array.isArray(projects) && projects.length === 0 && <span className="muted">No project matches.</span>}
        {Array.isArray(projects) &&
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              chatCount={chatCount(project)}
              isOpen={page?.project.id === project.id}
              onOpen={(kind) => open({ kind, project })}
              onNewClone={() =>
                askToLeave(() => {
                  open({ kind: "project", project });
                  void newClone(project);
                })
              }
            />
          ))}
      </nav>
      {creating && (
        <NewProjectDialog onClose={() => setCreating(false)} onCreated={(projectId) => void openCreated(projectId)} />
      )}
      {sidebarOpen && page !== null && (
        <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />
      )}
      <main className="main">
        {notices}
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
            <ChatHeader
              key={actionRequest.headerProps(chat.id).key}
              startWith={actionRequest.headerProps(chat.id).startWith}
              chat={chat}
              details={chatDetails}
              subtitle={
                <span className="crumbs">
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
                </span>
              }
              extra={
                <>
                  {page.clone.pullRequest !== null && <span className="pill idle">PR #{page.clone.pullRequest}</span>}
                  {/* Eva adds no prompt and no skill here: the chip only says which mode runs. */}
                  <span className="mode-chip soft">
                    <Icon name="briefcase" /> <span className="mode-chip-label">Project mode</span>
                  </span>
                  <BranchesButton tree={tree} shown={branch} states={branchStates} />
                </>
              }
              onShowList={onShowList}
              panelShown={panelShown}
              onTogglePanel={togglePanel}
              onChanged={onChanged}
            />
            <Conversation
              root={chat}
              shown={branch}
              sessions={sessions}
              live={live}
              onChanged={onChanged}
              approvals={approvals}
              blocker={blocker}
              voiceNotes={voiceNotes}
              projectTitle={page.project.title}
            />
          </>
        ) : (
          <ProjectPage
            project={page.project}
            clones={clones}
            chatsOf={chatsOf}
            stateOf={stateOf}
            isWorking={isWorking}
            error={error}
            clonesFailed={clonesFailed}
            onBackToList={() => open(null)}
            onDetails={() => open({ kind: "details", project: page.project })}
            onSetup={() => open({ kind: "setup", project: page.project })}
            onNewClone={() => void newClone(page.project)}
            onOpenChat={(clone, picked, action) => {
              if (action === undefined) clearAction();
              else actionRequest.ask(picked.id, action);
              open({ kind: "chat", project: page.project, clone, chatId: picked.id });
            }}
            onNewChat={(clone) => void startChat(page.project, clone)}
            onDeleteClone={(clone) => deleteClone(page.project, clone)}
            syncWork={syncWork?.projectId === page.project.id ? syncWork.label : null}
            pulling={pulling}
            onCheckRemotes={() =>
              void syncAll(page.project.id, "Eva checks the remote of each clone.", () =>
                api.fetchClones(page.project.id),
              )
            }
            onPullAll={() =>
              void syncAll(page.project.id, "Eva pulls each clone that is behind.", () =>
                api.pullClones(page.project.id),
              )
            }
            onPull={(clone) => void pullOne(page.project, clone)}
            onPush={setPushing}
          />
        )}
        {pushing !== null && page?.kind === "project" && (
          <PushCloneDialog
            clone={pushing}
            onClose={() => setPushing(null)}
            onPush={(note) => pushOne(page.project, pushing, note)}
          />
        )}
        {pushed !== null && <Toast message={pushed} onClose={() => setPushed(null)} />}
      </main>
      {/* The inspector is about one chat, so a project page has none. */}
      {chat !== undefined && <ChatPanel shown={panelShown} {...chatDetails} />}
    </div>
  );
}

/** A project in the list. Its context menu opens the project's pages at once. */
function ProjectCard({
  project,
  chatCount,
  isOpen,
  onOpen,
  onNewClone,
}: {
  readonly project: Project;
  readonly chatCount: number;
  readonly isOpen: boolean;
  readonly onOpen: (kind: "project" | "details" | "setup") => void;
  readonly onNewClone: () => void;
}): ReactElement {
  const { props, menu } = useContextMenu(
    [
      { label: "Open", icon: "briefcase", onChoose: () => onOpen("project") },
      { label: "Details", icon: "pen", onChoose: () => onOpen("details") },
      { label: "Repository setup", icon: "gear", onChoose: () => onOpen("setup") },
      { label: "New clone", icon: "plus", onChoose: onNewClone },
    ],
    `Actions of “${project.title}”`,
  );
  return (
    <>
      <button className="project-card" aria-current={isOpen} onClick={() => onOpen("project")} {...props}>
        <span className="card-row">
          <b>{project.title}</b>
          <StatusPill pill={statusPill(project.frontMatter.status)} />
        </span>
        <span className="card-row muted">
          <span>{projectSummary(project.clones.length, chatCount)}</span>
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
      {menu}
    </>
  );
}

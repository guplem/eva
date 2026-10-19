/**
 * Project mode: projects with search and filters, their clones, "New clone", the
 * conversation of the selected clone with its branch and pull request, the project details, and
 * the repository setup.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { api, type CloneDetails, type Project, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { chatTree, Conversation, DeleteChatButton, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { ChatInfoButton, ChatPanel, tasksOf } from "./ChatPanel.tsx";
import { PhoneListHeader, ShowListButton } from "./MainNav.tsx";
import { ProjectDetailsEditor } from "./ProjectDetailsEditor.tsx";
import { RepositorySetup } from "./RepositorySetup.tsx";

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
}

/**
 * The filter words that parseProjectQuery reads in the search text. A typed word wins over its
 * select. Keep these patterns in step with the parser in `core/projects/project-catalog.ts`.
 */
const statusWordPattern = /(^|\s)status:(idea|active|paused|closed|any)(\s|$)/i;
const tagWordPattern = /(^|\s)(tag:|#)\S/i;

interface Selection {
  readonly project: Project;
  readonly clone: CloneDetails;
}

/** A project page that takes the place of the conversation. */
interface Panel {
  readonly kind: "details" | "setup";
  readonly project: Project;
}

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
}: ProjectViewProps): ReactElement {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [tag, setTag] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [clones, setClones] = useState<CloneDetails[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
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

  // A linked Project chat opens in its clone, whatever the search and the filters show.
  const linkedId = linkedChat?.mode === "project" ? linkedChat.id : null;
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
          setOpenProject(project.id);
          setClones(details);
          setSelection({ project, clone });
          setSelectedChatId(linkedId);
          setPanel(null);
        }
      } catch (caught) {
        showError(caught);
      }
      onLinkedChatOpened();
    })();
  }, [linkedId, linkedProjectId, linkedClone, showError, onLinkedChatOpened]);

  const openClones = async (project: Project): Promise<void> => {
    setOpenProject(project.id === openProject ? null : project.id);
    try {
      setClones(await api.clones(project.id));
    } catch (caught) {
      showError(caught);
    }
  };

  const selectClone = (next: Selection): void => {
    setSelection(next);
    setSelectedChatId(null);
    setPanel(null);
    onNavigate();
  };

  const startChat = async (current: Selection): Promise<void> => {
    try {
      const chat = await api.newProjectChat(current.project.id, current.clone.name, "default");
      await onChanged();
      setSelectedChatId(chat.id);
      setPanel(null);
      onNavigate();
    } catch (caught) {
      showError(caught);
    }
  };

  const newClone = async (project: Project): Promise<void> => {
    setError(null);
    try {
      const created = await api.newClone(project.id);
      const details = await api.clones(project.id);
      setClones(details);
      const clone = details.find((candidate) => candidate.name === created.name);
      if (clone !== undefined) selectClone({ project, clone });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const cloneChats =
    selection === null ? [] : rootChats(sessions.filter((session) => session.startFolder === selection.clone.path));
  // The newest chat opens first, as in Assistant mode.
  const chat = cloneChats.find((candidate) => candidate.id === selectedChatId) ?? cloneChats[0];
  const tree = chat === undefined ? [] : chatTree(chat, sessions);
  const chatDetails = {
    tree,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };

  return (
    <div className="layout">
      <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Projects">
        <input
          aria-label="Search projects"
          placeholder="Search projects"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Any status</option>
          <option value="idea">Idea</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="closed">Closed</option>
        </select>
        {allTags.length > 0 && (
          <select aria-label="Tag" value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">Any tag</option>
            {allTags.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        )}
        {error !== null && (
          <span className="chip" role="alert">
            {error}
          </span>
        )}
        {projects.length === 0 && <span className="chip">No project matches.</span>}
        {projects.map((project) => (
          <div key={project.id}>
            <button
              className="list-item"
              aria-expanded={openProject === project.id}
              onClick={() => void openClones(project)}
            >
              {project.title}
              {project.warnings.length > 0 && (
                <span className="badge warning">
                  {project.warnings.length} {project.warnings.length === 1 ? "warning" : "warnings"}
                </span>
              )}
              <div className="muted">{project.id}</div>
            </button>
            {openProject === project.id && (
              <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                {/* The text shows in the list, not in a tooltip: a phone has no hover. */}
                {project.warnings.length > 0 && (
                  <ul className="warnings" aria-label={`Warnings of ${project.title}`}>
                    {project.warnings.map((warning, index) => (
                      <li key={`${String(index)}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                )}
                {clones.map((clone) => (
                  <div key={clone.name} style={{ display: "contents" }}>
                    <button
                      className="list-item"
                      aria-current={panel === null && selection?.clone.path === clone.path}
                      onClick={() => selectClone({ project, clone })}
                    >
                      {clone.name}
                    </button>
                    {selection?.clone.path === clone.path && (
                      <div role="group" aria-label="Chats in this clone" className="clone-chats">
                        {cloneChats.map((candidate) => (
                          <button
                            key={candidate.id}
                            className="list-item"
                            aria-current={candidate.id === chat?.id}
                            onClick={() => {
                              setSelectedChatId(candidate.id);
                              setPanel(null);
                              onNavigate();
                            }}
                          >
                            {candidate.title}
                            <div className="muted">{candidate.source}</div>
                          </button>
                        ))}
                        <button onClick={() => void startChat(selection)}>New chat</button>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => void newClone(project)}>New clone</button>
                <button
                  aria-current={panel?.kind === "details" && panel.project.id === project.id}
                  onClick={() => {
                    setPanel({ kind: "details", project });
                    onNavigate();
                  }}
                >
                  Project details
                </button>
                <button
                  aria-current={panel?.kind === "setup" && panel.project.id === project.id}
                  onClick={() => {
                    setPanel({ kind: "setup", project });
                    onNavigate();
                  }}
                >
                  Repository setup
                </button>
              </div>
            )}
          </div>
        ))}
      </nav>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
      <main className="main">
        {/* The project pages have their own title, so their phone header holds only the menu button. */}
        {panel !== null && <PhoneListHeader onShowList={onShowList} />}
        {notices}
        {panel?.kind === "details" ? (
          <ProjectDetailsEditor
            key={panel.project.id}
            projectId={panel.project.id}
            onSaved={() => setListVersion((version) => version + 1)}
          />
        ) : panel?.kind === "setup" ? (
          <RepositorySetup key={panel.project.id} projectId={panel.project.id} title={panel.project.title} />
        ) : selection === null ? (
          <>
            <PhoneListHeader title="Projects" onShowList={onShowList} />
            <div className="empty">Pick a project and one of its clones.</div>
          </>
        ) : (
          <>
            <div className="main-header">
              <ShowListButton onClick={onShowList} />
              <h1>
                {selection.project.title} · {selection.clone.name}
              </h1>
              {selection.clone.branch !== null && <span className="badge">{selection.clone.branch}</span>}
              {selection.clone.pullRequest !== null && <span className="badge">PR #{selection.clone.pullRequest}</span>}
              {chat !== undefined && <ChatInfoButton {...chatDetails} />}
              {chat !== undefined && <DeleteChatButton chat={chat} onChanged={onChanged} />}
            </div>
            {chat === undefined ? (
              <div className="empty">
                <button className="primary" onClick={() => void startChat(selection)}>
                  Start a chat in this clone
                </button>
              </div>
            ) : (
              <Conversation root={chat} sessions={sessions} live={live} onChanged={onChanged} />
            )}
          </>
        )}
      </main>
      <ChatPanel {...chatDetails} />
    </div>
  );
}

/** Every tag of these projects once, in alphabetical order. The filter ignores case, so the list does too. */
function tagsOf(projects: readonly Project[]): string[] {
  return [...new Set(projects.flatMap((project) => project.frontMatter.tags.map((tag) => tag.toLowerCase())))].sort(
    (first, second) => first.localeCompare(second),
  );
}

/**
 * Project mode (mockups/project-mode.png): projects with search and filters, their clones,
 * "New clone", and the conversation of the selected clone with its branch and pull request.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type CloneDetails, type Project, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { Conversation, rootChats } from "./Conversation.tsx";

interface ProjectViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
}

interface Selection {
  readonly project: Project;
  readonly clone: CloneDetails;
}

export function ProjectView({ sessions, live, sidebarOpen, onChanged, onNavigate }: ProjectViewProps): ReactElement {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [projects, setProjects] = useState<Project[]>([]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [clones, setClones] = useState<CloneDetails[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.projects(search, status).then(setProjects);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, status]);

  const openClones = async (project: Project): Promise<void> => {
    setOpenProject(project.id === openProject ? null : project.id);
    setClones(await api.clones(project.id));
  };

  const newClone = async (project: Project): Promise<void> => {
    setError(null);
    try {
      const created = await api.newClone(project.id);
      const details = await api.clones(project.id);
      setClones(details);
      const clone = details.find((candidate) => candidate.name === created.name);
      if (clone !== undefined) {
        setSelection({ project, clone });
        onNavigate();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const cloneChats =
    selection === null ? [] : rootChats(sessions.filter((session) => session.startFolder === selection.clone.path));
  const chat = cloneChats[0];

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
              <div className="muted">{project.id}</div>
            </button>
            {openProject === project.id && (
              <div style={{ paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                {clones.map((clone) => (
                  <button
                    key={clone.name}
                    className="list-item"
                    aria-current={selection?.clone.path === clone.path}
                    onClick={() => {
                      setSelection({ project, clone });
                      onNavigate();
                    }}
                  >
                    {clone.name}
                  </button>
                ))}
                <button onClick={() => void newClone(project)}>New clone</button>
              </div>
            )}
          </div>
        ))}
      </nav>
      <main className="main">
        {selection === null ? (
          <div className="empty">Pick a project and one of its clones.</div>
        ) : (
          <>
            <div className="main-header">
              <h1>
                {selection.project.title} · {selection.clone.name}
              </h1>
              {selection.clone.branch !== null && <span className="badge">{selection.clone.branch}</span>}
              {selection.clone.pullRequest !== null && <span className="badge">PR #{selection.clone.pullRequest}</span>}
            </div>
            {chat === undefined ? (
              <div className="empty">
                <button
                  className="primary"
                  onClick={() =>
                    void api.newProjectChat(selection.project.id, selection.clone.name, "default").then(onChanged)
                  }
                >
                  Start a chat in this clone
                </button>
              </div>
            ) : (
              <Conversation root={chat} sessions={sessions} live={live} onChanged={onChanged} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

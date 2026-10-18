/**
 * The details of a project: a form for the common front matter fields and the title, and the
 * whole `AGENTS.md` for everything else. Each save names the version that it read, so a change
 * made meanwhile on another device or by an agent is never overwritten.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, ApiError, type ProjectDetails, type ProjectFile } from "./api.ts";

const statusChoices = [
  { value: "", label: "None" },
  { value: "idea", label: "Idea" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
] as const;

type Loading = { readonly state: "loading" } | { readonly state: "failed"; readonly reason: string };
type Note = { readonly kind: "saved" | "failed" | "changed"; readonly text: string } | null;

interface ProjectDetailsEditorProps {
  readonly projectId: string;
  /** Such as the project list: it shows the new title and status. */
  readonly onSaved: () => void;
}

export function ProjectDetailsEditor({ projectId, onSaved }: ProjectDetailsEditorProps): ReactElement {
  const [file, setFile] = useState<ProjectFile | Loading>({ state: "loading" });
  const [details, setDetails] = useState<ProjectDetails>({ title: "", status: null, tags: [], repos: [] });
  const [tagDraft, setTagDraft] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);

  const show = useCallback((next: ProjectFile): void => {
    setFile(next);
    setText(next.text);
    setTagDraft("");
    setRepoDraft("");
    if (next.details !== null) setDetails(next.details);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setNote(null);
    try {
      show(await api.projectFile(projectId));
    } catch (caught) {
      setFile({ state: "failed", reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [projectId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (write: (version: string) => Promise<ProjectFile>): Promise<void> => {
    if (!("version" in file)) return;
    setNote(null);
    try {
      show(await write(file.version));
      setNote({ kind: "saved", text: "Saved." });
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setNote({
          kind: "changed",
          text: "The file changed since you opened it. Load it again, then redo your change.",
        });
      } else {
        setNote({ kind: "failed", text: caught instanceof Error ? caught.message : String(caught) });
      }
    }
  };

  // A value typed in an Add field but not added yet still counts.
  const saveDetails = (): Promise<void> =>
    save((version) =>
      api.saveProjectDetails(projectId, version, {
        ...details,
        tags: [...details.tags, ...splitWords(tagDraft)],
        repos: [...details.repos, ...splitWords(repoDraft)],
      }),
    );

  if (!("version" in file)) {
    return (
      <div className="settings">
        <div className="muted" role="status">
          {file.state === "loading" ? "Reading the project…" : `Eva could not read the project: ${file.reason}`}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="main-header">
        <h1>{titleOf(file, projectId)} · Details</h1>
      </div>
      <div className="settings">
        {note !== null && (
          <div className="settings-notice" role={note.kind === "saved" ? "status" : "alert"}>
            <span style={{ flex: 1 }}>{note.text}</span>
            {note.kind === "changed" && <button onClick={() => void load()}>Load again</button>}
          </div>
        )}
        {file.details === null ? (
          <div className="chip">Eva cannot read the front matter. Fix it in the file below.</div>
        ) : (
          <fieldset>
            <legend>Details</legend>
            <div className="muted">
              Created {file.details.created ?? "(not set)"}. The folder name holds this date, so it stays.
            </div>
            <label>
              Title
              <input
                value={details.title}
                placeholder={projectId}
                onChange={(event) => setDetails({ ...details, title: event.target.value })}
              />
            </label>
            <label>
              Project status
              <select
                value={details.status ?? ""}
                onChange={(event) =>
                  setDetails({ ...details, status: event.target.value === "" ? null : statusOf(event.target.value) })
                }
              >
                {statusChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <ListField
              name="tag"
              heading="Tags"
              values={details.tags}
              draft={tagDraft}
              onDraft={setTagDraft}
              onChange={(tags) => setDetails({ ...details, tags })}
            />
            <ListField
              name="repository"
              heading="Repositories"
              values={details.repos}
              draft={repoDraft}
              onDraft={setRepoDraft}
              onChange={(repos) => setDetails({ ...details, repos })}
            />
            <div className="muted">Removing a repository keeps its clones.</div>
            <div>
              <button className="primary" onClick={() => void saveDetails()}>
                Save details
              </button>
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>Whole file</legend>
          <label>
            AGENTS.md
            <textarea
              className="project-file"
              value={text}
              rows={16}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div>
            <button onClick={() => void save((version) => api.saveProjectFile(projectId, version, text))}>
              Save the file
            </button>
          </div>
        </fieldset>
      </div>
    </>
  );
}

interface ListFieldProps {
  /** Such as "tag": it names the Add and Remove buttons for a screen reader. */
  readonly name: string;
  readonly heading: string;
  readonly values: readonly string[];
  readonly draft: string;
  readonly onDraft: (draft: string) => void;
  readonly onChange: (values: string[]) => void;
}

function ListField({ name, heading, values, draft, onDraft, onChange }: ListFieldProps): ReactElement {
  const add = (): void => {
    onChange([...values, ...splitWords(draft)]);
    onDraft("");
  };
  return (
    <div className="edit-list">
      <span>{heading}</span>
      {values.length === 0 && <span className="muted">None.</span>}
      <ul aria-label={heading}>
        {values.map((value, index) => (
          <li key={`${String(index)}-${value}`} className="check-row">
            <span style={{ flex: 1 }}>{value}</span>
            <button
              aria-label={`Remove the ${name} ${value}`}
              onClick={() => onChange(values.filter((_, other) => other !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="check-row">
        <input
          style={{ flex: 1 }}
          aria-label={`Add a ${name}`}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <button aria-label={`Add the ${name}`} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/** A tag or repository has no space, so a space or a comma separates two of them. */
function splitWords(text: string): string[] {
  return text.split(/[\s,]+/).filter((word) => word.length > 0);
}

function statusOf(value: string): ProjectDetails["status"] {
  return value === "idea" || value === "active" || value === "paused" || value === "closed" ? value : null;
}

function titleOf(file: ProjectFile, projectId: string): string {
  const title = file.details?.title ?? "";
  return title === "" ? projectId : title;
}

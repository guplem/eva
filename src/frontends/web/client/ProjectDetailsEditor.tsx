/**
 * The details of a project: a form for the common front matter fields and the title, and the
 * whole `AGENTS.md` for everything else. Each save names the version that it read, so a change
 * made meanwhile on another device or by an agent is never overwritten.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, ApiError, type ProjectDetails, type ProjectFile } from "./api.ts";
import { BackButton } from "./ProjectPage.tsx";
import { ProgressBar } from "./Loading.tsx";

const statusChoices = [
  { value: "", label: "None" },
  { value: "idea", label: "Idea" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
] as const;

const emptyDetails: ProjectDetails = { title: "", status: null, tags: [], repos: [] };

type Loading = { readonly state: "loading" } | { readonly state: "failed"; readonly reason: string };
type Problem = { readonly kind: "failed" | "changed"; readonly text: string } | null;

interface ProjectDetailsEditorProps {
  readonly projectId: string;
  /** Runs after each save, so the project list can show the new title and status. */
  readonly onSaved: () => void;
  /** Goes back to the project page. */
  readonly onBack: () => void;
}

export function ProjectDetailsEditor({ projectId, onSaved, onBack }: ProjectDetailsEditorProps): ReactElement {
  const [file, setFile] = useState<ProjectFile | Loading>({ state: "loading" });
  const [details, setDetails] = useState<ProjectDetails>(emptyDetails);
  const [tagDraft, setTagDraft] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: ProjectFile): void => {
    setFile(next);
    setText(next.text);
    setTagDraft("");
    setRepoDraft("");
    setDetails(next.details ?? emptyDetails);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setProblem(null);
    setSaved("");
    try {
      show(await api.projectFile(projectId));
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      // A failed reload keeps the page and its edits; only a failed first load has nothing to show.
      setFile((current) => ("version" in current ? current : { state: "failed", reason }));
      setProblem({ kind: "failed", text: `Eva could not read the project: ${reason}` });
    }
  }, [projectId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!("version" in file)) {
    return (
      <div className="settings">
        {file.state === "loading" ? (
          <ProgressBar label="Reading the project…" />
        ) : (
          <div className="muted" role="status">
            Eva could not read the project: {file.reason}
          </div>
        )}
        {file.state === "failed" && (
          <div>
            <button onClick={() => void load()}>Try again</button>
          </div>
        )}
      </div>
    );
  }

  const formChanged =
    file.details !== null && (!sameDetails(details, file.details) || tagDraft.trim() !== "" || repoDraft.trim() !== "");
  const textChanged = text !== file.text;

  const save = async (write: (version: string) => Promise<ProjectFile>): Promise<void> => {
    setProblem(null);
    setSaved("");
    setBusy(true);
    try {
      show(await write(file.version));
      setSaved("Saved.");
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "project_changed") {
        setProblem({
          kind: "changed",
          text: "The file changed since you opened it. Load it again, then redo your change.",
        });
      } else {
        setProblem({ kind: "failed", text: caught instanceof Error ? caught.message : String(caught) });
      }
    } finally {
      setBusy(false);
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

  /** Each edit makes an old "Saved." untrue. */
  const edit = (change: () => void): void => {
    setSaved("");
    change();
  };

  return (
    <>
      <div className="main-header">
        <BackButton label="Back" onClick={onBack} />
        <h1>{titleOf(file, projectId)} · Details</h1>
        <button onClick={() => void load()} disabled={busy}>
          Load again
        </button>
      </div>
      <div className="settings">
        {/* Always present, so a screen reader announces the new text. */}
        <div role="status" className="muted">
          {saved}
        </div>
        {problem !== null && (
          <div className="callout danger" role="alert">
            {problem.text}
          </div>
        )}
        {file.details === null ? (
          <div className="chip">Eva cannot read the front matter. Fix it in the file below.</div>
        ) : (
          // One part waits while the other has a change: a save loads the new file into both parts.
          <fieldset disabled={busy || textChanged}>
            <legend>Details</legend>
            <div className="muted">
              Created {file.details.created ?? "(not set)"}. The folder name holds this date, so it stays.
            </div>
            <label>
              Title
              <input
                value={details.title}
                placeholder={projectId}
                onChange={(event) => edit(() => setDetails({ ...details, title: event.target.value }))}
              />
            </label>
            <label>
              Project status
              <select
                value={details.status ?? ""}
                onChange={(event) => edit(() => setDetails({ ...details, status: statusOf(event.target.value) }))}
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
              onDraft={(draft) => edit(() => setTagDraft(draft))}
              onChange={(tags) => edit(() => setDetails({ ...details, tags }))}
            />
            <ListField
              name="repository"
              heading="Repositories"
              values={details.repos}
              draft={repoDraft}
              onDraft={(draft) => edit(() => setRepoDraft(draft))}
              onChange={(repos) => edit(() => setDetails({ ...details, repos }))}
            />
            <div className="muted">Removing a repository keeps its clones.</div>

            {textChanged && <div className="muted">The details wait until you save or load again the whole file.</div>}
            <div>
              <button className="primary" onClick={() => void saveDetails()}>
                Save details
              </button>
            </div>
          </fieldset>
        )}
        <fieldset disabled={busy || formChanged}>
          <legend>Whole file</legend>
          <label>
            AGENTS.md
            <textarea
              className="project-file"
              value={text}
              rows={16}
              spellCheck={false}
              onChange={(event) => edit(() => setText(event.target.value))}
            />
          </label>
          {formChanged && <div className="muted">The file waits until you save or load again the details.</div>}
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
            // Enter also ends a word on an Android or CJK keyboard; that Enter is not an Add.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) add();
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

function sameDetails(first: ProjectDetails, second: ProjectDetails): boolean {
  const sameList = (one: readonly string[], two: readonly string[]): boolean =>
    one.length === two.length && one.every((value, index) => value === two[index]);
  return (
    first.title === second.title &&
    first.status === second.status &&
    sameList(first.tags, second.tags) &&
    sameList(first.repos, second.repos)
  );
}

function titleOf(file: ProjectFile, projectId: string): string {
  const title = file.details?.title ?? "";
  return title === "" ? projectId : title;
}

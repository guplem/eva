/**
 * The details of a project: a form for the common front matter fields and the title, and the
 * whole `AGENTS.md` for everything else. Each save names the version that it read, so a change
 * made meanwhile on another device or by an agent is never overwritten.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, ApiError, type ProjectDetails, type ProjectFile } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { BackButton } from "./MainNav.tsx";
import { ProgressBar } from "./Loading.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card, SelectField } from "./SettingsParts.tsx";

export const statusChoices = [
  { value: "", label: "None" },
  { value: "idea", label: "Idea" },
  { value: "active", label: "Active" },
  { value: "in-use", label: "In use" },
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

  const loaded = "version" in file ? file : null;
  const formChanged =
    loaded !== null &&
    loaded.details !== null &&
    (!sameDetails(details, loaded.details) || tagDraft.trim() !== "" || repoDraft.trim() !== "");
  const textChanged = loaded !== null && text !== loaded.text;
  /** The save of the part with a change. A hook cannot wait for the load, so the render below sets it. */
  let saveChanges = (): Promise<boolean> => Promise.resolve(false);
  const askFirst = useLeaveGuard(formChanged || textChanged, () => saveChanges());

  const loading = !("version" in file) && file.state === "loading";
  const header = (title: string): ReactElement => (
    <div className="main-header">
      <BackButton label="Back" onClick={onBack} />
      <h1>{title} · Details</h1>
      <button className="outline" onClick={() => askFirst(() => void load(), "load again")} disabled={busy || loading}>
        <Icon name="restart" />
        Load again
      </button>
    </div>
  );

  if (!("version" in file)) {
    return (
      <>
        {header(projectId)}
        <div className="settings-page">
          {file.state === "loading" ? (
            <section className="card">
              <ProgressBar label="Reading the project…" />
            </section>
          ) : (
            <div className="callout danger" role="status">
              Eva could not read the project ({file.reason}). Press Load again to try again.
            </div>
          )}
        </div>
      </>
    );
  }

  const save = async (write: (version: string) => Promise<ProjectFile>): Promise<boolean> => {
    setProblem(null);
    setSaved("");
    setBusy(true);
    try {
      show(await write(file.version));
      setSaved("Saved.");
      onSaved();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "project_changed") {
        setProblem({
          kind: "changed",
          text: "The file changed since you opened it. Load it again, then redo your change.",
        });
      } else {
        setProblem({ kind: "failed", text: caught instanceof Error ? caught.message : String(caught) });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  // A value typed in an Add field but not added yet still counts.
  const saveDetails = (): Promise<boolean> =>
    save((version) =>
      api.saveProjectDetails(projectId, version, {
        ...details,
        tags: [...details.tags, ...splitWords(tagDraft)],
        repos: [...details.repos, ...splitWords(repoDraft)],
      }),
    );

  const saveFile = (): Promise<boolean> => save((version) => api.saveProjectFile(projectId, version, text));
  // Only one part can have a change: the other part waits for it.
  saveChanges = () => (formChanged ? saveDetails() : saveFile());

  /** Each edit makes an old "Saved." untrue. */
  const edit = (change: () => void): void => {
    setSaved("");
    change();
  };

  return (
    <>
      {header(titleOf(file, projectId))}
      <div className="settings-page">
        {/* Always present, so a screen reader announces the new text. */}
        <div role="status" className="field-hint">
          {saved}
        </div>
        {problem !== null && (
          <div className="callout danger" role="alert">
            {problem.text}
          </div>
        )}
        {file.details === null ? (
          <div className="callout warning">Eva cannot read the front matter. Fix it in the file below.</div>
        ) : (
          <Card
            icon="pen"
            title="Details"
            description={`Created ${file.details.created ?? "(not set)"}. The folder name holds this date, so it stays.`}
          >
            {/* One part waits while the other has a change: a save loads the new file into both parts. */}
            <fieldset className="card-fields" disabled={busy || textChanged}>
              <label className="field">
                <span className="field-label">Title</span>
                <input
                  value={details.title}
                  placeholder={projectId}
                  onChange={(event) => edit(() => setDetails({ ...details, title: event.target.value }))}
                />
              </label>
              <SelectField
                label="Project status"
                value={details.status ?? ""}
                choices={statusChoices}
                onChange={(value) => edit(() => setDetails({ ...details, status: statusOf(value) }))}
              />
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
                icon="branch"
                hint="Removing a repository keeps its clones."
                values={details.repos}
                draft={repoDraft}
                onDraft={(draft) => edit(() => setRepoDraft(draft))}
                onChange={(repos) => edit(() => setDetails({ ...details, repos }))}
              />
              {textChanged && (
                <div className="field-hint">The details wait until you save or load again the whole file.</div>
              )}
              <div className="button-row">
                <SaveButton className="primary" onSave={saveDetails}>
                  Save details
                </SaveButton>
              </div>
            </fieldset>
          </Card>
        )}
        <Card icon="file" title="Whole file" description="The project file as text, with every field and note.">
          <fieldset className="card-fields" disabled={busy || formChanged}>
            <label className="field">
              <span className="field-label">AGENTS.md</span>
              <textarea
                className="project-file"
                value={text}
                rows={16}
                spellCheck={false}
                onChange={(event) => edit(() => setText(event.target.value))}
              />
            </label>
            {formChanged && <div className="field-hint">The file waits until you save or load again the details.</div>}
            <div className="button-row">
              <SaveButton onSave={saveFile}>Save the file</SaveButton>
            </div>
          </fieldset>
        </Card>
      </div>
    </>
  );
}

interface ListFieldProps {
  /** Such as "tag": it names the Add and Remove buttons for a screen reader. */
  readonly name: string;
  readonly heading: string;
  /** A round icon at the left of each value. */
  readonly icon?: IconName;
  readonly hint?: string;
  readonly values: readonly string[];
  readonly draft: string;
  readonly onDraft: (draft: string) => void;
  readonly onChange: (values: string[]) => void;
}

function ListField({ name, heading, icon, hint, values, draft, onDraft, onChange }: ListFieldProps): ReactElement {
  const add = (): void => {
    onChange([...values, ...splitWords(draft)]);
    onDraft("");
  };
  return (
    <div className="field">
      <span className="field-label">{heading}</span>
      {values.length === 0 ? (
        <span className="field-hint">None.</span>
      ) : (
        <ul className="device-list" aria-label={heading}>
          {values.map((value, index) => (
            <li key={`${String(index)}-${value}`}>
              {icon !== undefined && (
                <span className="device-icon">
                  <Icon name={icon} />
                </span>
              )}
              <span className="device-text">{value}</span>
              <button
                className="ghost"
                aria-label={`Remove the ${name} ${value}`}
                onClick={() => onChange(values.filter((_, other) => other !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint !== undefined && <span className="field-hint">{hint}</span>}
      <div className="inline-form">
        <input
          aria-label={`Add a ${name}`}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter also ends a word on an Android or CJK keyboard; that Enter is not an Add.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) add();
          }}
        />
        <button className="soft" aria-label={`Add the ${name}`} onClick={add}>
          <Icon name="plus" />
          Add
        </button>
      </div>
    </div>
  );
}

/** A tag or repository has no space, so a space or a comma separates two of them. */
export function splitWords(text: string): string[] {
  return text.split(/[\s,]+/).filter((word) => word.length > 0);
}

/** The status of a choice of `statusChoices`, or null for None and for any other value. */
export function statusOf(value: string): ProjectDetails["status"] {
  const choice = statusChoices.find((candidate) => candidate.value === value);
  return choice === undefined || choice.value === "" ? null : choice.value;
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

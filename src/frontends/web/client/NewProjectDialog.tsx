/**
 * The "New project" form, in the sheet of the "Add schedule" form. Eva creates the folder and
 * its `AGENTS.md`, and a GitHub repository of a type and a Drive folder when the person asks.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type NewProjectResult, type ProjectDetails, type PublicSettings } from "./api.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { repositoryTypes, repositoryTypeOf, type RepositoryTypeName } from "../../../core/projects/repository-types.ts";
import type { RepositoryVisibility } from "../../../core/vault/github-repositories.ts";
import { repositoryNotes, stepProblems, unavailableSteps, unavailableTypes } from "./new-project-form.ts";
import { splitWords, statusChoices, statusOf } from "./ProjectDetailsEditor.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { useBackLayer } from "./back-layer-hook.ts";
import { dialogBackdropClass } from "./Dialog.tsx";

interface NewProjectDialogProps {
  readonly onClose: () => void;
  /** Runs once the project exists, with the id of its folder. */
  readonly onCreated: (projectId: string) => void;
}

export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps): ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<NonNullable<ProjectDetails["status"]>>("active");
  const [tags, setTags] = useState("");
  const [github, setGithub] = useState(false);
  // Standard and private: what Eva made before repository types (#681).
  const [type, setType] = useState<RepositoryTypeName>("standard");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("private");
  // A type gives its own visibility only until the person picks one.
  const [visibilityPicked, setVisibilityPicked] = useState(false);
  const [drive, setDrive] = useState(false);
  /** Null while the read runs. */
  const [settings, setSettings] = useState<PublicSettings | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed step leaves the project in place: the sheet says why before it opens the project.
  const [created, setCreated] = useState<NewProjectResult | null>(null);

  const typed = name.trim() !== "" || description.trim() !== "" || tags.trim() !== "";
  // Create makes a folder and can make a GitHub repository, so the question offers no save.
  // While Create runs, the guard waits: the new project then opens with no question.
  const askFirst = useLeaveGuard(typed && created === null && !busy, null);

  const leave = (): void => {
    if (busy) return;
    // The project exists already, so the list must show it.
    if (created === null) askFirst(onClose);
    else onCreated(created.projectId);
  };
  useBackLayer(true, leave);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Without the settings, both steps stay off, so a send never asks for a step that cannot run.
  useEffect(() => {
    api.settings().then(setSettings, () => setSettings("failed"));
  }, []);
  const unreadable = "Eva could not read the settings. Close the form and try again.";
  const unavailable =
    settings === null || settings === "failed" ? { github: unreadable, drive: unreadable } : unavailableSteps(settings);
  const typeReasons = settings === null || settings === "failed" ? null : unavailableTypes(settings);
  const typeReason = typeReasons === null ? unreadable : typeReasons[type];
  const notes = repositoryNotes(type, visibility);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createProject({
        name: name.trim(),
        description,
        status,
        tags: splitWords(tags),
        repository: github && unavailable.github === null && typeReason === null ? { type, visibility } : null,
        drive: drive && unavailable.drive === null,
      });
      if (stepProblems(result).length === 0) onCreated(result.projectId);
      else setCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const step = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    reason: string | null,
  ): ReactElement => (
    <label className="check-row">
      <input
        type="checkbox"
        checked={checked && reason === null}
        disabled={reason !== null || busy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {reason !== null && <span className="field-hint step-reason">{reason}</span>}
      </span>
    </label>
  );

  return (
    // A tap beside the sheet does not close it, so a slip never loses a half-written form.
    <div className={dialogBackdropClass("schedule-backdrop")}>
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label="New project">
        <h2>New project</h2>
        {created !== null ? (
          <>
            <p>The project exists, but one step failed. You can do that step by hand later.</p>
            {stepProblems(created).map((problem) => (
              <div key={problem} role="status" className="schedule-form-error">
                {problem}
              </div>
            ))}
            <div className="schedule-sheet-actions">
              <button type="button" className="primary" onClick={() => onCreated(created.projectId)}>
                Open the project
              </button>
            </div>
          </>
        ) : (
          <form
            className="schedule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              Name
              <input
                value={name}
                placeholder="Example app"
                required
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={description}
                placeholder="What the project is, in a sentence or two."
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={status}
                disabled={busy}
                onChange={(event) => setStatus(statusOf(event.target.value) ?? "active")}
              >
                {statusChoices
                  .filter((choice) => choice.value !== "")
                  .map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Tags (separate them with spaces)
              <input
                value={tags}
                placeholder="work web"
                disabled={busy}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
            {settings === null ? (
              <ProgressBar label="Eva reads which steps she can do." />
            ) : (
              <>
                {step("Create a GitHub repository", github, setGithub, unavailable.github)}
                {github && unavailable.github === null && (
                  <>
                    <label>
                      Repository type
                      <select
                        value={type}
                        disabled={busy}
                        onChange={(event) => {
                          const chosen = repositoryTypeOf(event.target.value);
                          if (chosen === null) return;
                          setType(chosen.name);
                          if (!visibilityPicked) setVisibility(chosen.defaultVisibility);
                        }}
                      >
                        {repositoryTypes.map((choice) => (
                          <option key={choice.name} value={choice.name} disabled={typeReasons?.[choice.name] !== null}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                      <span className="field-hint">{typeReason ?? repositoryTypeOf(type)?.description}</span>
                    </label>
                    <label>
                      Visibility
                      <select
                        value={visibility}
                        disabled={busy}
                        onChange={(event) => {
                          setVisibilityPicked(true);
                          setVisibility(event.target.value === "public" ? "public" : "private");
                        }}
                      >
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                    {notes.warning !== null && <div className="callout warning">{notes.warning}</div>}
                    {notes.note !== null && <div className="callout">{notes.note}</div>}
                  </>
                )}
                {step("Create a Google Drive folder", drive, setDrive, unavailable.drive)}
              </>
            )}
            {error !== null && (
              <div role="status" className="schedule-form-error">
                {error}
              </div>
            )}
            <div className="schedule-sheet-actions">
              <button type="submit" className="primary" disabled={busy || name.trim() === ""} aria-busy={busy}>
                {busy && <ButtonSpinner />}
                {busy ? "Creating…" : "Create project"}
              </button>
              <span className="spacer" />
              <button type="button" onClick={() => askFirst(onClose)} disabled={busy}>
                Cancel
              </button>
            </div>
            {busy && <ProgressBar label="Eva creates the project and sets up its steps…" />}
          </form>
        )}
      </div>
    </div>
  );
}

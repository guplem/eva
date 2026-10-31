/**
 * The widget list of Personalize (#691): each widget project, each widget that the person added by
 * its address, and each widget that ships with Eva. A widget does nothing until the person turns
 * it on; then Eva asks for its inputs and shows what it may do. The person approves all or nothing.
 */
import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from "react";
import { api, ApiError, type WidgetInputValue, type WidgetItem, type WidgetReview } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { Card, errorText, SelectField, type SettingsContext } from "./SettingsParts.tsx";
import { WidgetInputs, WidgetPermissions } from "./WidgetInputs.tsx";
import {
  checkChoices,
  updateCheckNote,
  initialValues,
  missingInputs,
  promptLine,
  sentValues,
  type FormValues,
} from "./widget-form.ts";

const stateWords: Readonly<Record<WidgetItem["state"], { readonly label: string; readonly className: string }>> = {
  on: { label: "On", className: "pill done" },
  off: { label: "Off", className: "pill" },
  approve: { label: "Approve on this computer", className: "pill missing" },
};

const sourceWords: Readonly<Record<WidgetItem["sources"][number], string>> = {
  list: "Added",
  project: "Your project",
  base: "Ships with Eva",
};

export function WidgetsCard({ context }: { readonly context: SettingsContext }): ReactElement | null {
  const { notify } = context;
  /** Null until the list loads, and when no vault holds the list. */
  const [items, setItems] = useState<readonly WidgetItem[] | null>(null);
  const [noVault, setNoVault] = useState(false);
  const [checking, setChecking] = useState(false);
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [activating, setActivating] = useState<WidgetItem | null>(null);
  const [removing, setRemoving] = useState<WidgetItem | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .widgets()
      .then((listed) => {
        if (!current) return;
        setItems(listed);
        setChecking(true);
        // Each manifest comes from GitHub, so the list shows first, and the problems after.
        return api.checkWidgets().then((checked) => {
          if (current) setItems(checked);
        });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 409) setNoVault(true);
        else notify(errorText(error));
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [notify]);

  const run = useCallback(
    async (work: () => Promise<readonly WidgetItem[]>): Promise<void> => {
      try {
        setItems(await work());
      } catch (error) {
        notify(errorText(error));
      }
    },
    [notify],
  );

  const add = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (address.trim() === "") return;
    setAdding(true);
    await run(async () => {
      const added = await api.addWidget(address.trim());
      setAddress("");
      return added;
    });
    setAdding(false);
  };

  const turnOn = async (item: WidgetItem): Promise<void> => {
    try {
      setItems(await api.setWidgetEnabled(item.id, true));
    } catch (error) {
      // No approval on this computer, or one that no longer fits the vault: ask the person.
      if (error instanceof ApiError && error.code === "widget_needs_approval") setActivating(item);
      else notify(errorText(error));
    }
  };

  const checkUpdates = async (): Promise<void> => {
    setCheckingUpdates(true);
    await run(async () => {
      const checked = await api.checkWidgetUpdates();
      notify(
        updateCheckNote(
          checked.filter((item) => item.update !== null).length,
          checked.filter((item) => item.checkProblem !== null).length,
        ),
      );
      return checked;
    });
    setCheckingUpdates(false);
  };

  if (noVault) return null;
  return (
    <>
      <Card
        item="widgets"
        title="Widgets"
        description="Widgets show on Eva's home page, in a grid. Each one does nothing until you turn it on and approve what it may do on this computer. The list, the order and the inputs live in your vault, in .eva/widgets.json."
      >
        <form className="inline-form" onSubmit={(event) => void add(event)}>
          <label className="field grow">
            <span className="field-label">Add a widget</span>
            <input
              value={address}
              placeholder="https://github.com/owner/name"
              autoComplete="off"
              onChange={(event) => setAddress(event.target.value)}
            />
            <span className="field-hint">The address of the widget's GitHub repository.</span>
          </label>
          <button
            className="primary"
            type="submit"
            aria-busy={adding}
            aria-disabled={address.trim() === "" ? "true" : undefined}
          >
            {adding && <ButtonSpinner />}
            Add
          </button>
        </form>
        {adding && <ProgressBar label="Adding the widget" />}
        {items === null && <ProgressBar label="Opening the widget list" />}
        {checking && <ProgressBar label="Reading the manifest of each widget" />}
        {items !== null && items.length === 0 && <p className="empty">No widget yet.</p>}
        {items !== null && items.length > 0 && (
          <ul className="widget-list" aria-label="Widgets">
            {items.map((item, index) => (
              <WidgetRow
                key={item.id}
                item={item}
                first={index === 0}
                last={index === items.length - 1}
                onTurnOn={() => void turnOn(item)}
                onTurnOff={() => void run(() => api.setWidgetEnabled(item.id, false))}
                onApprove={() => setActivating(item)}
                onRefuse={() => void run(() => api.refuseWidgetUpdate(item.id))}
                onMove={(direction) => void run(() => api.moveWidget(item.id, direction))}
                onRemove={() => setRemoving(item)}
              />
            ))}
          </ul>
        )}
        {activating !== null && (
          <WidgetActivation
            item={activating}
            onClose={() => setActivating(null)}
            onApproved={(next) => {
              setActivating(null);
              setItems(next);
              notify(
                activating.update !== null
                  ? `${activating.name} is up to date.`
                  : `${activating.name} is on. It shows on the home page.`,
              );
            }}
          />
        )}
        {removing !== null && (
          <Dialog label={`Remove ${removing.name}`} closeLabel="Cancel" onClose={() => setRemoving(null)}>
            <h2>Remove {removing.name}?</h2>
            <p>
              Its permissions and its copy on this computer go, and it leaves your list. Your data in the vault stays.
              {removing.sources.includes("project") && " Your widget project stays in the list, off."}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const target = removing;
                  setRemoving(null);
                  void run(() => api.removeWidget(target.id));
                }}
              >
                <Icon name="trash" />
                Remove
              </button>
            </div>
          </Dialog>
        )}
      </Card>
      <Card
        item="widget-updates"
        title="Widget updates"
        description="Eva installs a new version of a widget by herself when it asks for nothing new. When it asks for more, the old version keeps running, and Eva asks you first. Each computer checks its own widgets."
      >
        <SelectField
          label="Check my widgets every"
          value={String(context.settings.config.widgets.checkIntervalMinutes)}
          choices={checkChoices(context.settings.config.widgets.checkIntervalMinutes)}
          hint="Your own widgets: the widget projects of your vault. Eva checks every other widget once a day."
          onChange={(value) => void context.saveNow({ widgets: { checkIntervalMinutes: Number(value) } })}
        />
        <div className="button-row">
          <button
            type="button"
            aria-busy={checkingUpdates}
            aria-disabled={checkingUpdates ? "true" : undefined}
            onClick={() => !checkingUpdates && void checkUpdates()}
          >
            {checkingUpdates && <ButtonSpinner />}
            Check for updates
          </button>
        </div>
        {checkingUpdates && <ProgressBar label="Checking each widget for a new version" />}
      </Card>
    </>
  );
}

function WidgetRow({
  item,
  first,
  last,
  onTurnOn,
  onTurnOff,
  onApprove,
  onRefuse,
  onMove,
  onRemove,
}: {
  readonly item: WidgetItem;
  readonly first: boolean;
  readonly last: boolean;
  readonly onTurnOn: () => void;
  readonly onTurnOff: () => void;
  readonly onApprove: () => void;
  readonly onRefuse: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}): ReactElement {
  const state = stateWords[item.state];
  const blocked = item.problems !== null && item.problems.length > 0;
  return (
    <li className="widget-row">
      <div className="widget-row-head">
        <div className="widget-row-name">
          <strong>{item.name}</strong>
          <a href={item.repository} target="_blank" rel="noreferrer">
            {item.repository.replace(/^https:\/\/github\.com\//, "")}
          </a>
          <span className="field-hint">By {item.owner}</span>
        </div>
        <span className={state.className}>{state.label}</span>
      </div>
      <div className="widget-row-pills">
        {item.sources.map((source) => (
          <span key={source} className="pill">
            {sourceWords[source]}
          </span>
        ))}
        {item.size !== null && <span className="pill">{item.size}</span>}
      </div>
      {blocked && (
        <div className="callout danger">
          This widget cannot turn on:
          <ul>
            {item.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {item.checkProblem !== null && (
        <div className="callout warning">
          Eva could not check this widget for updates: {item.checkProblem} The installed version keeps running.
        </div>
      )}
      {item.update !== null && (
        <div className="callout warning">
          An update waits. The old version keeps running until you approve it.
          <ul>
            {[...item.update.permissions, ...item.update.reasons].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {item.update.notes.length > 0 && (
            <>
              What changed:
              <ul>
                {item.update.notes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button type="button" className="primary" onClick={onApprove}>
              Review the update
            </button>
            <button type="button" className="ghost" onClick={onRefuse}>
              Keep this version
            </button>
          </div>
        </div>
      )}
      <div className="button-row">
        {item.state === "off" && (
          <button
            type="button"
            className="primary"
            aria-disabled={blocked ? "true" : undefined}
            onClick={() => !blocked && onTurnOn()}
          >
            Turn on
          </button>
        )}
        {item.state === "approve" && (
          <button
            type="button"
            className="primary"
            aria-disabled={blocked ? "true" : undefined}
            onClick={() => !blocked && onApprove()}
          >
            Approve
          </button>
        )}
        {item.state !== "off" && (
          <button type="button" className="ghost" onClick={onTurnOff}>
            Turn off
          </button>
        )}
        <button
          type="button"
          className="ghost icon-button"
          aria-label={`Move ${item.name} up`}
          aria-disabled={first ? "true" : undefined}
          onClick={() => !first && onMove("up")}
        >
          <Icon name="back" className="widget-move-up" />
        </button>
        <button
          type="button"
          className="ghost icon-button"
          aria-label={`Move ${item.name} down`}
          aria-disabled={last ? "true" : undefined}
          onClick={() => !last && onMove("down")}
        >
          <Icon name="down" />
        </button>
        {item.sources.includes("list") && (
          <button type="button" className="ghost danger" onClick={onRemove}>
            <Icon name="trash" />
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The activation: the inputs and the permission screen of one commit. A "no" leaves the widget off.
 * Eva checks every value again and approves exactly the reviewed commit.
 */
function WidgetActivation({
  item,
  onClose,
  onApproved,
}: {
  readonly item: WidgetItem;
  readonly onClose: () => void;
  readonly onApproved: (items: WidgetItem[]) => void;
}): ReactElement {
  const [review, setReview] = useState<WidgetReview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .reviewWidget(item.id)
      .then((read) => {
        if (!current) return;
        setReview(read);
        if (read.manifest !== null) setValues(initialValues(read.manifest, read.values));
      })
      .catch((error: unknown) => {
        if (current) setProblem(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [item.id]);

  const manifest = review?.manifest ?? null;
  const missing = manifest === null ? [] : missingInputs(manifest, values);
  const set = (id: string, value: WidgetInputValue | undefined): void => {
    setValues((old) => ({ ...old, [id]: value }));
    // The warning was for the old values: another folder needs a new check.
    setConflict(null);
  };

  const approve = async (readOnly = false): Promise<void> => {
    if (review === null || manifest === null || missing.length > 0) return;
    setSaving(true);
    setProblem(null);
    setConflict(null);
    try {
      onApproved(await api.approveWidget(item.id, review.commit, sentValues(manifest, values), readOnly));
    } catch (error) {
      // A conflict of the data formats has a way out: the widget can turn on with read access only (#692).
      if (error instanceof ApiError && error.code === "widget_format_conflict") setConflict(error.message);
      else setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const line = manifest === null ? null : promptLine(manifest, values);
  // An update of an installed widget: the dialog names what is new since the approved version.
  const updating = review !== null && review.installed !== null && review.installed !== review.commit;
  const verb = updating ? "Update" : "Turn on";

  return (
    <>
      <Dialog label={`${verb} ${item.name}`} closeLabel="Cancel" closeDisabled={saving} onClose={onClose}>
        <h2>
          {verb} {manifest?.name ?? item.name}
        </h2>
        <p className="field-hint">
          A widget is code from its author, {item.owner}, at{" "}
          <a href={item.repository} target="_blank" rel="noreferrer">
            {item.repository}
          </a>
          . Turn it on only when you trust its author.
        </p>
        {review === null && problem === null && <ProgressBar label="Reading the widget" />}
        {review !== null && manifest === null && (
          <div className="callout danger">
            This widget cannot turn on:
            <ul>
              {review.problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {manifest !== null && (
          <div className="widget-activation">
            {updating && review.added !== null && (
              <div className="callout warning">
                {review.added.length === 0 ? (
                  "This version asks for nothing new."
                ) : (
                  <>
                    New in this version:
                    <ul>
                      {review.added.map((added) => (
                        <li key={added}>{added}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <WidgetInputs manifest={manifest} values={values} onChange={set} />
            <WidgetPermissions manifest={manifest} values={values} />
            {line !== null && (
              <div className="field">
                <span className="field-label">What this widget tells Eva</span>
                <span>{line}</span>
                <span className="field-hint">
                  Eva adds this line to her prompt in each new chat, so she saves your data where the widget reads it.
                </span>
              </div>
            )}
            {missing.length > 0 && <div className="callout warning">Fill in: {missing.join(", ")}.</div>}
            {problem !== null && <div className="callout danger">{problem}</div>}
            {conflict !== null && <div className="callout warning">{conflict}</div>}
            <div className="button-row">
              <button
                type="button"
                className="primary"
                aria-busy={saving}
                aria-disabled={missing.length > 0 || saving ? "true" : undefined}
                onClick={() => void approve()}
              >
                {saving && <ButtonSpinner />}
                {updating ? "Approve and update" : "Approve and turn on"}
              </button>
              {conflict !== null && (
                <button
                  type="button"
                  className="ghost"
                  aria-disabled={saving ? "true" : undefined}
                  onClick={() => void approve(true)}
                >
                  Turn on with read access only
                </button>
              )}
            </div>
            {saving && <ProgressBar label="Installing the widget" />}
          </div>
        )}
        {manifest === null && problem !== null && <div className="callout danger">{problem}</div>}
      </Dialog>
    </>
  );
}

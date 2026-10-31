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
import { Card, ChoiceChips, errorText, SelectField, type SettingsContext } from "./SettingsParts.tsx";
import { VaultPicker } from "./VaultPicker.tsx";
import {
  formInputs,
  initialValues,
  missingInputs,
  permissionLines,
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

  if (noVault) return null;
  return (
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
            notify(`${activating.name} is on. It shows on the home page.`);
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
  );
}

function WidgetRow({
  item,
  first,
  last,
  onTurnOn,
  onTurnOff,
  onApprove,
  onMove,
  onRemove,
}: {
  readonly item: WidgetItem;
  readonly first: boolean;
  readonly last: boolean;
  readonly onTurnOn: () => void;
  readonly onTurnOff: () => void;
  readonly onApprove: () => void;
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
  const [values, setValues] = useState<FormValues>({});
  const [picking, setPicking] = useState<{ readonly id: string; readonly kind: "folder" | "file" } | null>(null);
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
  const set = (id: string, value: WidgetInputValue | undefined): void => setValues((old) => ({ ...old, [id]: value }));

  const approve = async (): Promise<void> => {
    if (review === null || manifest === null || missing.length > 0) return;
    setSaving(true);
    setProblem(null);
    try {
      onApproved(await api.approveWidget(item.id, review.commit, sentValues(manifest, values)));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog label={`Turn on ${item.name}`} closeLabel="Cancel" closeDisabled={saving} onClose={onClose}>
        <h2>Turn on {manifest?.name ?? item.name}</h2>
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
            {formInputs(manifest).map((input) => (
              <InputField
                key={input.id}
                input={input}
                value={values[input.id]}
                onChange={(value) => set(input.id, value)}
                onPick={(kind) => setPicking({ id: input.id, kind })}
              />
            ))}
            <div className="field">
              <span className="field-label">What this widget may do</span>
              {permissionLines(manifest, values).length === 0 ? (
                <span className="field-hint">Nothing: it only shows its own page.</span>
              ) : (
                <ul className="widget-permissions">
                  {permissionLines(manifest, values).map((line) => (
                    <li key={line.text}>
                      <Icon name={line.icon} />
                      <span>
                        <strong>{line.text}</strong>
                        <span className="field-hint">{line.why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <span className="field-hint">
                It reaches only these places and hosts. A change of the widget gives it nothing until you approve it
                again.
              </span>
            </div>
            {missing.length > 0 && <div className="callout warning">Fill in: {missing.join(", ")}.</div>}
            {problem !== null && <div className="callout danger">{problem}</div>}
            <div className="button-row">
              <button
                type="button"
                className="primary"
                aria-busy={saving}
                aria-disabled={missing.length > 0 || saving ? "true" : undefined}
                onClick={() => void approve()}
              >
                {saving && <ButtonSpinner />}
                Approve and turn on
              </button>
            </div>
            {saving && <ProgressBar label="Installing the widget" />}
          </div>
        )}
        {manifest === null && problem !== null && <div className="callout danger">{problem}</div>}
      </Dialog>
      {picking !== null && (
        <VaultPicker
          label={picking.kind === "folder" ? "Pick a folder" : "Pick a file"}
          kind={picking.kind}
          start={folderOf(values[picking.id], picking.kind)}
          onClose={() => setPicking(null)}
          onPick={(path) => {
            set(picking.id, path);
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

/** The folder where the picker opens: the current folder, or the folder of the current file. */
function folderOf(value: WidgetInputValue | undefined, kind: "folder" | "file"): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  const path = value.trim();
  if (kind === "folder") return path;
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function InputField({
  input,
  value,
  onChange,
  onPick,
}: {
  readonly input: ReturnType<typeof formInputs>[number];
  readonly value: WidgetInputValue | undefined;
  readonly onChange: (value: WidgetInputValue | undefined) => void;
  readonly onPick: (kind: "folder" | "file") => void;
}): ReactElement {
  const label = input.required ? `${input.label} (required)` : input.label;
  const hint = (
    <>
      {input.description} <em>Why: {input.why}</em>
    </>
  );
  if (input.type === "folder" || input.type === "file") {
    const kind = input.type;
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <div className="inline-form">
          <span className="widget-picked">{typeof value === "string" && value !== "" ? value : "Nothing picked"}</span>
          <button type="button" className="ghost" onClick={() => onPick(kind)}>
            <Icon name={kind === "folder" ? "folder" : "file"} />
            {kind === "folder" ? "Pick a folder" : "Pick a file"}
          </button>
        </div>
        <span className="field-hint">{hint}</span>
      </div>
    );
  }
  if (input.type === "choice") {
    const choices = [
      { value: "", label: "None" },
      ...(input.choices ?? []).map((choice) => ({ value: choice, label: choice })),
    ];
    return (
      <SelectField
        label={label}
        value={typeof value === "string" ? value : ""}
        choices={choices}
        hint={hint}
        onChange={(picked) => onChange(picked === "" ? undefined : picked)}
      />
    );
  }
  if (input.type === "boolean") {
    return (
      <ChoiceChips
        label={label}
        value={value === true ? "yes" : value === false ? "no" : ""}
        choices={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        hint={`${input.description} Why: ${input.why}`}
        onChange={(picked) => onChange(picked === "yes")}
      />
    );
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type={input.type === "number" ? "number" : input.type === "url" ? "url" : "text"}
        value={value === undefined || typeof value === "boolean" ? "" : String(value)}
        autoComplete="off"
        onChange={(event) => {
          const text = event.target.value;
          if (input.type !== "number") onChange(text);
          else onChange(text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));
        }}
      />
      <span className="field-hint">{hint}</span>
    </label>
  );
}

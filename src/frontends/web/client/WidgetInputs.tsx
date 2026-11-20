/**
 * The input fields of a widget and the list of what it may do (#691). The activation in Settings
 * and the preview of a clone (#693) ask for the same values in the same way.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { WidgetManifest } from "../../../core/widgets/widget-contract.ts";
import type { DefaultPlace } from "../../../core/widgets/widget-defaults.ts";
import { defaultPath } from "../../../core/widgets/widget-places.ts";
import { api, type WidgetInputValue } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { ChoiceChips, errorText, SelectField } from "./SettingsParts.tsx";
import { VaultPicker } from "./VaultPicker.tsx";
import { defaultChoice, formInputs, ownValue, permissionLines, type FormValues } from "./widget-form.ts";

/** A field for each input of the manifest, with the vault picker for a folder or a file. */
export function WidgetInputs({
  manifest,
  values,
  onChange,
}: {
  readonly manifest: WidgetManifest;
  readonly values: FormValues;
  readonly onChange: (id: string, value: WidgetInputValue | undefined) => void;
}): ReactElement {
  const [picking, setPicking] = useState<{
    readonly id: string;
    readonly kind: "folder" | "file";
    readonly writes: boolean;
  } | null>(null);
  const places = useDefaultPlaces(manifest);
  return (
    <>
      {formInputs(manifest).map((input) => {
        const path = defaultPath(input);
        return (
          <InputField
            key={input.id}
            input={input}
            value={ownValue(values, input.id)}
            defaultPlace={path === null ? undefined : places[path]}
            onChange={(value) => onChange(input.id, value)}
            onPick={(kind) => setPicking({ id: input.id, kind, writes: input.access === "write" })}
          />
        );
      })}
      {picking !== null && (
        <VaultPicker
          label={picking.kind === "folder" ? "Pick a folder" : "Pick a file"}
          newFile={picking.writes}
          kind={picking.kind}
          start={folderOf(ownValue(values, picking.id), picking.kind)}
          onClose={() => setPicking(null)}
          onPick={(path) => {
            onChange(picking.id, path);
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

/**
 * What the vault holds at each default place of the manifest (#984), by its path. A path that the
 * core has not answered yet is missing, so its button shows only once Eva knows which one fits.
 */
function useDefaultPlaces(manifest: WidgetManifest): Readonly<Record<string, DefaultPlace>> {
  const [places, setPlaces] = useState<Readonly<Record<string, DefaultPlace>>>({});
  const paths = [...new Set(formInputs(manifest).flatMap((input) => defaultPath(input) ?? []))];
  const key = paths.join("\n");
  useEffect(() => {
    if (key === "") return;
    let current = true;
    api
      .widgetPlaces(key.split("\n"))
      .then((found) => current && setPlaces(found))
      // With no answer, the form shows no default button: "Pick a folder" still works.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [key]);
  return places;
}

/** "What this widget may do": each place, the location and each host, with its reason. */
export function WidgetPermissions({
  manifest,
  values,
}: {
  readonly manifest: WidgetManifest;
  readonly values: FormValues;
}): ReactElement {
  const lines = permissionLines(manifest, values);
  return (
    <div className="field">
      <span className="field-label">What this widget may do</span>
      {lines.length === 0 ? (
        <span className="field-hint">Nothing: it only shows its own page.</span>
      ) : (
        <ul className="widget-permissions">
          {lines.map((line) => (
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
        It reaches only these places and hosts. A change of the widget gives it nothing until you approve it again.
      </span>
    </div>
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
  defaultPlace,
  onChange,
  onPick,
}: {
  readonly input: ReturnType<typeof formInputs>[number];
  readonly value: WidgetInputValue | undefined;
  /** What the vault holds at the input's default place, once the core answered. */
  readonly defaultPlace: DefaultPlace | undefined;
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
    return (
      <PlaceField
        input={input}
        label={label}
        hint={hint}
        value={value}
        defaultPlace={defaultPlace}
        onChange={onChange}
        onPick={onPick}
      />
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

/**
 * A folder or a file input: the pick, and the default place with one tap (#984). The button says
 * "Use the default folder" or "Create the default folder". A phone has no hover, so the path also
 * shows as text under the row. Nothing is created or picked before the tap.
 */
function PlaceField({
  input,
  label,
  hint,
  value,
  defaultPlace,
  onChange,
  onPick,
}: {
  readonly input: ReturnType<typeof formInputs>[number];
  readonly label: string;
  readonly hint: ReactElement;
  readonly value: WidgetInputValue | undefined;
  readonly defaultPlace: DefaultPlace | undefined;
  readonly onChange: (value: WidgetInputValue | undefined) => void;
  readonly onPick: (kind: "folder" | "file") => void;
}): ReactElement {
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kind = input.type === "file" ? "file" : "folder";
  const picked = typeof value === "string" && value.trim() !== "";
  const choice = picked ? null : defaultChoice(input, defaultPlace);
  const useDefault = (): void => {
    if (choice === null || creating) return;
    if (choice.action === "use") {
      onChange(choice.path);
      return;
    }
    setCreating(true);
    setProblem(null);
    api
      .createWidgetFolder(choice.path)
      .then(() => onChange(choice.path))
      .catch((error: unknown) => setProblem(errorText(error)))
      .finally(() => setCreating(false));
  };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="inline-form widget-place">
        <span className="widget-picked">{picked ? value : "Nothing picked"}</span>
        {/* One group, so the buttons wrap together under the text. */}
        <span className="button-row">
          {choice !== null && (
            <button
              type="button"
              className="ghost"
              data-tooltip={choice.tooltip}
              aria-busy={creating ? "true" : undefined}
              aria-disabled={creating ? "true" : undefined}
              onClick={useDefault}
            >
              {creating ? <ButtonSpinner /> : <Icon name={choice.action === "create" ? "plus" : "check"} />}
              {choice.label}
            </button>
          )}
          <button type="button" className="ghost" onClick={() => onPick(kind)}>
            <Icon name={kind} />
            {kind === "folder" ? "Pick a folder" : "Pick a file"}
          </button>
        </span>
      </div>
      {choice !== null && (
        <span className="field-hint">
          Default {kind}: <code>{choice.path}</code>
        </span>
      )}
      {creating && <ProgressBar label="Creating the folder" />}
      {problem !== null && <span className="callout danger">{problem}</span>}
      <span className="field-hint">{hint}</span>
    </div>
  );
}

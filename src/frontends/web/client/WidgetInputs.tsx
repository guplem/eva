/**
 * The input fields of a widget and the list of what it may do (#691). The activation in Settings
 * and the preview of a clone (#693) ask for the same values in the same way.
 */
import { useState, type ReactElement } from "react";
import type { WidgetManifest } from "../../../core/widgets/widget-contract.ts";
import type { WidgetInputValue } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ChoiceChips, SelectField } from "./SettingsParts.tsx";
import { VaultPicker } from "./VaultPicker.tsx";
import { formInputs, ownValue, permissionLines, type FormValues } from "./widget-form.ts";

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
  return (
    <>
      {formInputs(manifest).map((input) => (
        <InputField
          key={input.id}
          input={input}
          value={ownValue(values, input.id)}
          onChange={(value) => onChange(input.id, value)}
          onPick={(kind) => setPicking({ id: input.id, kind, writes: input.access === "write" })}
        />
      ))}
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

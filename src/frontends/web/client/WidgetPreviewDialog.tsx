/**
 * The preview of a widget from a clone (#693): the clone's folder as it is now, with no push and
 * no merge. "Example data" is the default, and shows the clone's mock files. "My data" shows the
 * person's vault, and asks first for what the widget may do. The switch reloads the widget only.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { api, type PreviewMode, type PreviewPlace, type WidgetInputValue, type WidgetPreview } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { ChoiceChips, errorText } from "./SettingsParts.tsx";
import { currentScheme, WidgetFrameView } from "./WidgetGrid.tsx";
import { WidgetInputs, WidgetPermissions } from "./WidgetInputs.tsx";
import { contractColours } from "./widget-frames.ts";
import { initialValues, missingInputs, sentValues, type FormValues } from "./widget-form.ts";

const modes: readonly { readonly value: PreviewMode; readonly label: string }[] = [
  { value: "example", label: "Example data" },
  { value: "mine", label: "My data" },
];

/** The page's theme, as the grid sends it, so the preview shows the widget in Eva's colours. */
function theme(): { readonly scheme: "light" | "dark"; readonly colors: Record<string, string> } {
  const style = getComputedStyle(document.documentElement);
  return { scheme: currentScheme(), colors: contractColours((name) => style.getPropertyValue(name)) };
}

export function WidgetPreviewDialog({
  place,
  onClose,
}: {
  readonly place: PreviewPlace;
  readonly onClose: () => void;
}): ReactElement {
  const [mode, setMode] = useState<PreviewMode>("example");
  const [preview, setPreview] = useState<WidgetPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const token = useRef<string | null>(null);

  const show = (next: WidgetPreview): void => {
    // The old token ends at once: only the newest preview may read anything.
    if (token.current !== null && token.current !== next.token)
      void api.releaseWidgetFrames([token.current]).catch(() => undefined);
    token.current = next.token;
    setPreview(next);
  };

  useEffect(() => {
    let current = true;
    setPreview(null);
    setProblem(null);
    const { scheme, colors } = theme();
    api
      .previewWidget(place, mode, scheme, colors)
      .then((next) => {
        if (current) show(next);
        else if (next.token !== null) void api.releaseWidgetFrames([next.token]).catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (current) setProblem(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [place, mode, loads]);

  useEffect(
    () => () => {
      if (token.current !== null) void api.releaseWidgetFrames([token.current]).catch(() => undefined);
    },
    [],
  );

  const name = preview?.name ?? place.repository;
  const src = preview?.src ?? null;
  const size = preview?.size ?? null;
  const ask = preview?.ask ?? null;
  return (
    <Dialog label={`Preview of ${name}`} onClose={onClose}>
      <h2>Preview of {name}</h2>
      <p className="field-hint">
        The widget as {place.clone} holds it now. A change shows here with no push and no merge.
      </p>
      <ChoiceChips label="Data" value={mode} choices={modes} onChange={setMode} />
      {mode === "mine" && (
        <p className="field-hint">
          My data reads and changes your real vault. The vault history keeps each change, so you can undo one.
        </p>
      )}
      {preview === null && problem === null && <ProgressBar label="Opening the preview" />}
      {problem !== null && <div className="callout danger">{problem}</div>}
      {preview !== null && preview.problems.length > 0 && (
        <div className="callout danger">
          The manifest of the clone has problems:
          <ul>
            {preview.problems.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {src !== null && size !== null && (
        // The home grid's own layout, so the preview has the size that the home page gives it.
        <div className="widget-grid" role="group" aria-label={`Preview of ${name}`}>
          <div className={`card widget-card size-${size}`}>
            <WidgetFrameView frame={{ name, src }} size={size} scheme={theme().scheme} />
          </div>
        </div>
      )}
      {ask !== null && <PreviewApproval place={place} ask={ask} onShown={show} />}
      <div className="button-row">
        <button type="button" className="ghost" onClick={() => setLoads((count) => count + 1)}>
          <Icon name="sync" />
          Reload
        </button>
      </div>
    </Dialog>
  );
}

/** "My data" for the first time, or with more than the approval gives: the person approves for this clone only. */
function PreviewApproval({
  place,
  ask,
  onShown,
}: {
  readonly place: PreviewPlace;
  readonly ask: NonNullable<WidgetPreview["ask"]>;
  readonly onShown: (preview: WidgetPreview) => void;
}): ReactElement {
  const manifest = ask.manifest;
  const [values, setValues] = useState<FormValues>(() => initialValues(manifest, ask.values));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const missing = missingInputs(manifest, values);
  const set = (id: string, value: WidgetInputValue | undefined): void => {
    setValues((old) => ({ ...old, [id]: value }));
  };
  const approve = async (): Promise<void> => {
    if (missing.length > 0 || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      const { scheme, colors } = theme();
      onShown(await api.approveWidgetPreview(place, ask.digest, sentValues(manifest, values), scheme, colors));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="widget-activation">
      {ask.setUp ? (
        <div className="callout warning">
          {ask.added.length === 0 ? (
            "Fill in what the clone needs."
          ) : (
            <>
              The clone asks for more than the installed widget:
              <ul>
                {ask.added.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <p className="field-hint">This widget is not set up in Eva. Approve what the preview may do with your data.</p>
      )}
      <WidgetInputs manifest={manifest} values={values} onChange={set} />
      {!ask.setUp && <WidgetPermissions manifest={manifest} values={values} />}
      <p className="field-hint">
        This approval is for the preview of this clone only. The installed widget gets nothing from it.
      </p>
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
          Approve for this preview
        </button>
      </div>
      {saving && <ProgressBar label="Approving the preview" />}
    </div>
  );
}

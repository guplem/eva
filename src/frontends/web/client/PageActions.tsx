/**
 * Save and Pin of a page of a chat (#1130). Save keeps the page in `.eva/pages/` after the 7 days
 * of the scratch folder. Pin also saves it, and shows it beside the chat. A saved page shows its
 * state in a word and a check, and its menu removes it.
 */
import { useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { api, type PageFrame } from "./api.ts";
import { useEscape } from "./back-layer-hook.ts";
import { dialogBackdropClass } from "./Dialog.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { MenuButton } from "./Menu.tsx";
import { isPinned, useChatPages } from "./page-context.ts";
import { keptWords, pageName } from "./page-frames.ts";

export type ReadyPage = Extract<PageFrame, { readonly state: "ready" }>;

/** The state of a page in words, and Save or the menu of a saved page. */
export function PageKeep({ marker, page }: { readonly marker: string; readonly page: ReadyPage }): ReactElement {
  const { onChanged } = useChatPages();
  const showError = useShowError();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = pageName(marker);
  const words = keptWords(page.kept);
  if (words === null) {
    const save = async (): Promise<void> => {
      if (saving) return;
      setSaving(true);
      try {
        await api.savePage(marker);
        onChanged();
      } catch (caught) {
        showError(caught);
      } finally {
        setSaving(false);
      }
    };
    return (
      <button
        type="button"
        className="ghost page-action"
        aria-label={`Save ${name}`}
        data-tooltip="Keep this page after 7 days"
        aria-busy={saving}
        onClick={() => void save()}
      >
        {saving ? <ButtonSpinner /> : <Icon name="bookmark" />}
        <span>Save</span>
      </button>
    );
  }
  // A page in a notes folder is a note of the person: the Files page removes it.
  if (page.kept === "note")
    return (
      <span className="page-kept" data-tooltip={page.path}>
        <Icon name="check" /> {words}
      </span>
    );
  return (
    <>
      <MenuButton
        className="ghost page-action page-kept"
        // The name holds the word on the button, so a voice command that says "Saved" finds it.
        name={`${name} is saved`}
        label={`Actions of the saved page ${name}`}
        items={[{ label: "Remove the saved page", icon: "trash", danger: true, onChoose: () => setRemoving(true) }]}
      >
        <Icon name="check" />
        <span>{words}</span>
      </MenuButton>
      {removing && (
        <RemoveQuestion
          name={name}
          marker={marker}
          onKeep={() => setRemoving(false)}
          onRemoved={() => {
            setRemoving(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** Pin, or Unpin for the page that the chat pins. Nothing in a chat that pins nothing. */
export function PagePin({
  marker,
  page,
  words = true,
}: {
  readonly marker: string;
  readonly page: ReadyPage;
  /** False shows only the icon, as in the corner of full screen. */
  readonly words?: boolean;
}): ReactElement | null {
  const { pinned, onPin, onChanged } = useChatPages();
  const showError = useShowError();
  const [busy, setBusy] = useState(false);
  if (onPin === null) return null;
  const on = isPinned(pinned, page.path);
  const name = pageName(marker);
  const press = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onPin(on ? null : marker);
      onChanged();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  };
  const label = on ? `Unpin ${name}` : `Pin ${name} beside the chat`;
  return (
    <button
      type="button"
      className={`${words ? "ghost page-action" : "icon-button widget-full-button"}${on ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={on}
      data-tooltip={on ? "Unpin this page. It stays saved." : "Pin this page beside the chat. Pin also saves it."}
      aria-busy={busy}
      onClick={() => void press()}
    >
      {busy ? <ButtonSpinner /> : <Icon name="pin" />}
      {words && <span>{on ? "Pinned" : "Pin"}</span>}
    </button>
  );
}

/** Asks before a saved page goes. The vault history keeps it, but the chat then shows the "gone" note. */
function RemoveQuestion({
  name,
  marker,
  onKeep,
  onRemoved,
}: {
  readonly name: string;
  readonly marker: string;
  readonly onKeep: () => void;
  readonly onRemoved: () => void;
}): ReactElement {
  const [removing, setRemoving] = useState(false);
  const showError = useShowError();
  useEscape(onKeep, removing);
  const remove = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    try {
      await api.removePage(marker);
      onRemoved();
    } catch (caught) {
      showError(caught);
      setRemoving(false);
    }
  };
  // The body, so no bubble or full-screen layer clips the question or covers it.
  return createPortal(
    <div
      className={dialogBackdropClass("schedule-backdrop page-remove-backdrop")}
      onClick={(event) => event.target === event.currentTarget && !removing && onKeep()}
    >
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={`Remove ${name}?`}>
        <h2>Remove {name}?</h2>
        <p>Eva deletes the saved page, and each chat that shows it says that it is gone. A pin of it goes too.</p>
        <div className="schedule-sheet-actions">
          {/* Not disabled: a disabled button drops the focus, and a failed removal must leave it here. */}
          <button className="danger" aria-disabled={removing} onClick={() => void remove()}>
            Remove
          </button>
          <span className="spacer" />
          <button autoFocus onClick={onKeep}>
            Keep
          </button>
        </div>
        {removing && <ProgressBar label="Eva removes the page." />}
      </div>
    </div>,
    document.body,
  );
}

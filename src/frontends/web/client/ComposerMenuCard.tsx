/**
 * The text actions and saved prompts of the message box menu (issue 661). Each item is one file in
 * the vault, so each one saves and goes on its own, with its own buttons.
 */
import { useEffect, useState, type ReactElement } from "react";
import { modelAliases, modelTierName, type ModelAlias } from "../../../shared/engine-port.ts";
import { api, ApiError, type ComposerMenuItems } from "./api.ts";
import { Icon } from "./icons.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card, ChoiceChips, errorText, type SettingsContext } from "./SettingsParts.tsx";

type Kind = "text-action" | "saved-prompt";

/** An item as the form edits it. A new item has no `previousName` until its first save. */
interface Draft {
  readonly key: number;
  readonly previousName: string | null;
  readonly name: string;
  readonly model: ModelAlias;
  readonly text: string;
}

const modelChoices = modelAliases.map((model) => ({ value: model, label: modelTierName(model) }));

export function ComposerMenuCard({ context }: { readonly context: SettingsContext }): ReactElement | null {
  /** Null until loaded, and when no vault holds the items. */
  const [items, setItems] = useState<ComposerMenuItems | null>(null);
  const { notify } = context;

  useEffect(() => {
    api
      .composerMenu()
      .then(setItems)
      .catch((error: unknown) => {
        // Without a vault, the page shows no card.
        if (!(error instanceof ApiError && error.status === 409)) notify(errorText(error));
      });
  }, [notify]);

  if (items === null) return null;
  return (
    <Card
      item="composer-menu"
      title="Message box menu"
      description="The star in the message box opens these. A text action rewrites the typed text with a model and sends nothing. A saved prompt puts its text at the cursor."
    >
      <ItemList
        kind="text-action"
        title="Text actions"
        hint="The prompt tells the model how to rewrite the text. The model sees only the text in the box."
        drafts={items.textActions.map((action) => ({ ...action, text: action.prompt }))}
        onSaved={setItems}
        notify={notify}
      />
      <ItemList
        kind="saved-prompt"
        title="Saved prompts"
        hint="A text that you send often, such as a request for a summary."
        drafts={items.savedPrompts.map((prompt) => ({ ...prompt, model: "haiku" }))}
        onSaved={setItems}
        notify={notify}
      />
      <span className="field-hint">Each item is a file in your vault, in .eva/settings/.</span>
    </Card>
  );
}

function ItemList({
  kind,
  title,
  hint,
  drafts,
  onSaved,
  notify,
}: {
  readonly kind: Kind;
  readonly title: string;
  readonly hint: string;
  readonly drafts: readonly Omit<Draft, "key" | "previousName">[];
  readonly onSaved: (items: ComposerMenuItems) => void;
  readonly notify: SettingsContext["notify"];
}): ReactElement {
  /** The new items that have no file yet. */
  const [added, setAdded] = useState<readonly number[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const saved = (items: ComposerMenuItems, key?: number): void => {
    if (key !== undefined) setAdded((keys) => keys.filter((each) => each !== key));
    onSaved(items);
  };
  const isAction = kind === "text-action";
  return (
    <div className="field">
      <span className="field-label">{title}</span>
      <span className="field-hint">{hint}</span>
      {drafts.map((draft) => (
        <ItemEditor
          // The name is the key: a rename makes a new file, and the form starts from it.
          key={draft.name}
          kind={kind}
          initial={{ ...draft, key: 0, previousName: draft.name }}
          onSaved={(items) => saved(items)}
          onRemoved={(items) => {
            if (items !== null) saved(items);
          }}
          notify={notify}
        />
      ))}
      {added.map((key) => (
        <ItemEditor
          key={`new-${String(key)}`}
          kind={kind}
          initial={{ key, previousName: null, name: "", model: "haiku", text: "" }}
          onSaved={(items) => saved(items, key)}
          onRemoved={() => setAdded((keys) => keys.filter((each) => each !== key))}
          notify={notify}
        />
      ))}
      <div className="button-row">
        <button
          className="ghost"
          onClick={() => {
            setAdded((keys) => [...keys, nextKey]);
            setNextKey((key) => key + 1);
          }}
        >
          <Icon name="plus" />
          {isAction ? "Add a text action" : "Add a saved prompt"}
        </button>
      </div>
    </div>
  );
}

function ItemEditor({
  kind,
  initial,
  onSaved,
  onRemoved,
  notify,
}: {
  readonly kind: Kind;
  readonly initial: Draft;
  readonly onSaved: (items: ComposerMenuItems) => void;
  /** Gets null for a new item that had no file. */
  readonly onRemoved: (items: ComposerMenuItems | null) => void;
  readonly notify: SettingsContext["notify"];
}): ReactElement {
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(initial.previousName === null);
  const isAction = kind === "text-action";
  const previousName = draft.previousName ?? undefined;

  const save = async (): Promise<boolean> => {
    try {
      const rename = previousName === undefined ? {} : { previousName };
      onSaved(
        isAction
          ? await api.saveTextAction({ name: draft.name, model: draft.model, prompt: draft.text, ...rename })
          : await api.savePrompt({ name: draft.name, text: draft.text, ...rename }),
      );
      return true;
    } catch (error) {
      notify(errorText(error));
      return false;
    }
  };
  const remove = async (): Promise<void> => {
    if (previousName === undefined) {
      onRemoved(null);
      return;
    }
    try {
      onRemoved(isAction ? await api.removeTextAction(previousName) : await api.removePrompt(previousName));
    } catch (error) {
      notify(errorText(error));
    }
  };

  if (!open) {
    return (
      <div className="composer-menu-item">
        <Icon name={isAction ? "pen" : "chat"} />
        <span className="grow">{draft.name}</span>
        <button className="ghost" aria-label={`Edit ${draft.name}`} onClick={() => setOpen(true)}>
          <Icon name="pen" />
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="composer-menu-item open">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={draft.name}
          maxLength={60}
          placeholder={isAction ? "Polish" : "Summary"}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      {isAction && (
        <ChoiceChips
          label="Model"
          hint="Fast answers in seconds. A stronger model writes better and takes longer."
          value={draft.model}
          choices={modelChoices}
          onChange={(model) => setDraft({ ...draft, model })}
        />
      )}
      <label className="field">
        <span className="field-label">{isAction ? "Prompt" : "Text"}</span>
        <textarea
          value={draft.text}
          placeholder={
            isAction
              ? "Fix the spelling and the grammar. Keep the language of the text."
              : "Can you give me a summary of everything that we did so far?"
          }
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      </label>
      <div className="button-row">
        <SaveButton className="primary" onSave={save}>
          Save
        </SaveButton>
        <button className="danger" onClick={() => void remove()}>
          <Icon name="trash" />
          Remove
        </button>
      </div>
    </div>
  );
}

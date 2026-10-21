/**
 * The person's rules for Eva, from the vault's `.eva/assistant.md`: shown as formatted text, edited
 * as plain text, and restored to the default after a warning. Eva's built-in rules show below,
 * read only, so the person sees what the rules add to.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { AssistantRulesView } from "../../../core/modes/assistant-rules.ts";
import { api, ApiError } from "./api.ts";
import { Dialog } from "./ChatPanel.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { nestedWebHtml } from "./web-format.ts";

/** The card title is an `h2`, so a `# Title` in the rules shows as an `h3`. */
const cardHeadingLevel = 2;

const scope =
  "Eva sends these rules at the start of each chat with Eva: in Telegram, in this web app and from a schedule. " +
  "A project chat never uses them: it uses the harness's own prompt and the project's AGENTS.md or CLAUDE.md. " +
  "A change applies from the next new chat.";

export function AssistantRulesCard({ context }: { readonly context: SettingsContext }): ReactElement | null {
  /** "loading" until the first answer, and "none" when no vault holds the rules. */
  const [rules, setRules] = useState<AssistantRulesView | "loading" | "none">("loading");
  /** The text being edited, or null when the card shows the formatted rules. */
  const [draft, setDraft] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify } = context;

  const load = useCallback((): void => {
    api
      .assistantRules()
      .then(setRules)
      .catch((error: unknown) => {
        // Without a vault, the page shows no card for the rules.
        if (error instanceof ApiError && error.status === 409) setRules("none");
        else notify(errorText(error));
      });
  }, [notify]);
  useEffect(load, [load]);
  // A new function at each render would make the dialog move the focus back to Cancel.
  const closeRestore = useCallback((): void => setRestoring(false), []);

  if (rules === "none") return null;
  if (rules === "loading") {
    return (
      <Card item="assistant-rules" title="Eva's rules" description={scope}>
        <ProgressBar label="Reading your rules…" />
      </Card>
    );
  }

  /** Eva can change the rules in a chat, so a save from an old version loads the new text instead. */
  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      notify(await action());
    } catch (error) {
      if (error instanceof ApiError && error.code === "rules_changed") {
        notify("Your rules changed in another place since you opened them. Eva loaded the new text.");
        setDraft(null);
        load();
      } else {
        notify(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const save = (text: string): Promise<void> =>
    run(async () => {
      const saved = await api.saveAssistantRules(rules.version, text);
      setRules({ ...rules, ...saved });
      setDraft(null);
      return "Saved. New chats with Eva use the new rules.";
    });

  const restore = (backup: boolean): Promise<void> =>
    run(async () => {
      const restored = await api.restoreAssistantRules(rules.version, backup);
      setRules({ ...rules, text: restored.text, version: restored.version });
      setRestoring(false);
      setDraft(null);
      return restored.backup === null
        ? "Restored the default rules."
        : `Restored the default rules. Your old rules are in ${restored.backup}.`;
    });

  return (
    <Card item="assistant-rules" title="Eva's rules" description={scope}>
      {draft === null ? (
        <>
          {/* Each set of rules has its own frame and title, so the person sees where theirs end. */}
          <section className="rules-box" aria-labelledby="own-rules-title">
            <span className="field-label" id="own-rules-title">
              Your rules
            </span>
            {rules.text.trim() === "" ? (
              <p className="muted">You have no rules yet. Eva uses only her built-in rules.</p>
            ) : (
              // nestedWebHtml escapes all text and adds only its own tags, so the HTML is safe.
              <div
                className="answer-body rules-text"
                dangerouslySetInnerHTML={{ __html: nestedWebHtml(rules.text, cardHeadingLevel) }}
              />
            )}
          </section>
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={() => setDraft(rules.text)}>
              Edit
            </button>
            <button className="danger" disabled={busy} onClick={() => setRestoring(true)}>
              Restore the default
            </button>
          </div>
        </>
      ) : (
        <label className="field">
          <span className="field-label">Rules in Markdown</span>
          <textarea
            className="project-file"
            value={draft}
            rows={20}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className="field-hint">The rules live in your vault, in .eva/assistant.md.</span>
        </label>
      )}
      {draft !== null && (
        <div className="button-row">
          <button className="primary" disabled={busy} onClick={() => void save(draft)}>
            Save
          </button>
          <button disabled={busy} onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      )}
      <details className="rules-box built-in">
        <summary className="field-label">Eva's built-in rules (read only)</summary>
        <p className="field-hint">
          Each chat with Eva starts with these rules, then yours. Your rules win where the two disagree. An update of
          Eva can change these.
        </p>
        <div
          className="answer-body rules-text"
          dangerouslySetInnerHTML={{ __html: nestedWebHtml(rules.builtIn, cardHeadingLevel) }}
        />
      </details>
      {restoring && <RestoreDialog busy={busy} onRestore={(backup) => void restore(backup)} onClose={closeRestore} />}
    </Card>
  );
}

function ignore(): void {
  // Nothing to do: see RestoreDialog.
}

function RestoreDialog({
  busy,
  onRestore,
  onClose,
}: {
  readonly busy: boolean;
  readonly onRestore: (backup: boolean) => void;
  readonly onClose: () => void;
}): ReactElement {
  const [backup, setBackup] = useState(true);
  return (
    // While the restore runs, Escape and Cancel do nothing: the dialog closes when it ends.
    <Dialog label="Restore the default rules" onClose={busy ? ignore : onClose} closeLabel="Cancel">
      <h2>Restore the default rules?</h2>
      <div className="callout warning">
        Eva replaces all your rules with her default rules. Every rule and fact that you or Eva wrote in them goes away.
        A backup keeps a copy that you can read in Files.
      </div>
      <label className="check-row">
        <input type="checkbox" checked={backup} onChange={(event) => setBackup(event.target.checked)} />
        <span>Save a backup of my rules first, in .eva/ in the vault</span>
      </label>
      <button className="danger" disabled={busy} onClick={() => onRestore(backup)}>
        {backup ? "Save a backup and restore" : "Restore without a backup"}
      </button>
    </Dialog>
  );
}

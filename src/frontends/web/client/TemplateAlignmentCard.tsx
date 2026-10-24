/**
 * The Template alignment card: each part of Eva's template in the vault, such as a skill, and its
 * state. A part that the person changed, and that has a new version, offers three choices.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type TemplatePartView } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { mergeMessage, partStateWords, updatedWords } from "./template-words.ts";

interface Listed {
  readonly parts: readonly TemplatePartView[];
  /** False on a computer that is not the hub: only the hub changes the parts. */
  readonly canChoose: boolean;
}

export function TemplateAlignmentCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const [listed, setListed] = useState<Listed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, reloadSetup } = context;

  const load = useCallback((): void => {
    api
      .templateParts()
      .then(setListed)
      .catch((error: unknown) => notify(errorText(error)));
  }, [notify]);
  useEffect(load, [load]);

  const choose = async (part: TemplatePartView, choice: "new" | "mine"): Promise<void> => {
    setBusy(part.path);
    try {
      setListed(await api.chooseTemplateVersion(part.path, choice));
      // The choice can end the alert, and the notice at the top must follow.
      reloadSetup();
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  // Eva merges in a chat, so the person sees the result and can correct it. The chat starts first:
  // a failed start changes nothing. Then keeping the person's version ends the question, because
  // the merged file is theirs.
  const merge = async (part: TemplatePartView): Promise<void> => {
    setBusy(part.path);
    try {
      const chat = await api.newAssistantChat();
      await api.send(chat.id, mergeMessage(part));
      await api.chooseTemplateVersion(part.path, "mine");
      reloadSetup();
      window.location.hash = `#/chat/${encodeURIComponent(chat.id)}`;
    } catch (error) {
      notify(errorText(error));
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      item="template-alignment"
      title="Template alignment"
      description="Eva puts some files in your vault, such as her skills. After an update, she replaces each file that you did not change. If you changed a file, you choose."
    >
      {listed === null ? (
        <ProgressBar label="Eva compares the files…" />
      ) : (
        <>
          {!listed.canChoose && (
            <div className="field-hint">Only the hub computer changes these files. Open its page to choose.</div>
          )}
          <ul className="device-list template-parts" aria-label="Template parts">
            {listed.parts.map((part) => {
              const words = partStateWords(part.state);
              const updated = part.state === "current" ? updatedWords(part.updatedAt) : null;
              const canAct = listed.canChoose && busy === null;
              return (
                <li key={part.path}>
                  <span className="device-icon">
                    <Icon name="file" />
                  </span>
                  <span className="device-text">
                    <b>{part.name}</b>
                    <span className="device-detail mono">{part.path}</span>
                    {updated !== null && <span className="device-detail">{updated}</span>}
                  </span>
                  <span className={`pill ${words.tone}`}>{words.label}</span>
                  {part.state === "differs" && listed.canChoose && (
                    <div className="button-row">
                      <button className="primary" disabled={!canAct} onClick={() => void choose(part, "new")}>
                        Use the new one
                      </button>
                      <button disabled={!canAct} onClick={() => void choose(part, "mine")}>
                        Keep mine
                      </button>
                      <button className="ghost" disabled={!canAct} onClick={() => void merge(part)}>
                        Merge with Eva
                      </button>
                    </div>
                  )}
                  {part.state === "missing" && listed.canChoose && (
                    <div className="button-row">
                      <button className="ghost" disabled={!canAct} onClick={() => void choose(part, "new")}>
                        Add it again
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {busy !== null && <ProgressBar label="Eva updates the file…" />}
    </Card>
  );
}

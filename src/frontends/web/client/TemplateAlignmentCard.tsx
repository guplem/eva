/**
 * The Template alignment card: each part of Eva's template in the vault, such as a skill, and its
 * state. A part that the person changed, and that has a new version, offers three choices.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type TemplatePartView } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { mergeMessage, partStateWords } from "./template-words.ts";

export function TemplateAlignmentCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const [parts, setParts] = useState<readonly TemplatePartView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .templateParts()
      .then((answer) => {
        if (current) setParts(answer.parts);
      })
      .catch((error: unknown) => {
        if (current) context.notify(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [context]);

  const choose = async (part: TemplatePartView, choice: "new" | "mine"): Promise<void> => {
    setBusy(part.path);
    try {
      setParts((await api.chooseTemplateVersion(part.path, choice)).parts);
      // The choice can end the alert, and the notice at the top must follow.
      context.reloadSetup();
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  // Eva merges in a chat, so the person sees the result and can correct it. Keeping their version
  // first ends the question: the merged file is theirs.
  const merge = async (part: TemplatePartView): Promise<void> => {
    setBusy(part.path);
    try {
      const message = mergeMessage(part);
      await api.chooseTemplateVersion(part.path, "mine");
      const chat = await api.newAssistantChat("default");
      await api.send(chat.id, message);
      window.location.hash = `#/chat/${encodeURIComponent(chat.id)}`;
    } catch (error) {
      context.notify(errorText(error));
      setBusy(null);
    }
  };

  return (
    <Card
      item="template-alignment"
      title="Template alignment"
      description="Eva brings some files of your vault, such as her skills. After an update, she updates each file that you did not change. When you changed one, you choose."
    >
      {parts === null ? (
        <ProgressBar label="Eva compares the files…" />
      ) : (
        <ul className="device-list" aria-label="Template parts">
          {parts.map((part) => {
            const words = partStateWords(part.state);
            return (
              <li key={part.path}>
                <span className="device-icon">
                  <Icon name="file" />
                </span>
                <span className="device-text">
                  <b>{part.name}</b>
                  <span className="device-detail mono">{part.path}</span>
                </span>
                <span className={`pill ${words.tone}`}>{words.label}</span>
                {part.state === "differs" && (
                  <div className="button-row">
                    <button className="primary" disabled={busy !== null} onClick={() => void choose(part, "new")}>
                      Use the new one
                    </button>
                    <button disabled={busy !== null} onClick={() => void choose(part, "mine")}>
                      Keep mine
                    </button>
                    <button className="ghost" disabled={busy !== null} onClick={() => void merge(part)}>
                      Merge with Eva
                    </button>
                  </div>
                )}
                {part.state === "missing" && (
                  <button className="ghost" disabled={busy !== null} onClick={() => void choose(part, "new")}>
                    Add it again
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {busy !== null && <ProgressBar label="Eva updates the file…" />}
    </Card>
  );
}

/**
 * Asks before a retry of an Assistant answer that changed files: undo those changes, or keep
 * them (#525). Undo comes first, as the person who retries a bad answer usually wants it.
 */
import { useState, type ReactElement } from "react";
import type { UndoPreview } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

const ignore = (): void => undefined;

export function RetryUndoDialog({
  title,
  preview,
  onRetry,
  onClose,
}: {
  readonly title: string;
  readonly preview: UndoPreview;
  /** Runs the retry, with or without the undo. The dialog closes when it ends. */
  readonly onRetry: (undo: boolean) => Promise<void>;
  readonly onClose: () => void;
}): ReactElement {
  const [running, setRunning] = useState<"undo" | "keep" | null>(null);
  const retry = async (undo: boolean): Promise<void> => {
    setRunning(undo ? "undo" : "keep");
    try {
      await onRetry(undo);
    } finally {
      setRunning(null);
    }
  };
  const busy = running !== null;
  return (
    // While the retry runs, Escape and Cancel do nothing: the undo cannot stop halfway.
    <Dialog label="Undo the changes" onClose={busy ? ignore : onClose} closeLabel="Cancel">
      <h2>{title}</h2>
      <p>Only files in the vault go back. What the answer did outside the vault stays, such as a sent message.</p>
      <FileGroup title="These files go back" paths={preview.restore} />
      <FileGroup title="These files changed after the answer, so they stay" paths={preview.changed} />
      <FileGroup title="Eva keeps these files out of the sync, so they stay" paths={preview.notKept} />
      <div className="button-row">
        <button className="primary" disabled={busy} aria-busy={running === "undo"} onClick={() => void retry(true)}>
          {running === "undo" && <ButtonSpinner />}
          Undo and retry
        </button>
        <button className="ghost" disabled={busy} aria-busy={running === "keep"} onClick={() => void retry(false)}>
          {running === "keep" && <ButtonSpinner />}
          Keep and retry
        </button>
      </div>
      {running === "undo" && <ProgressBar label="Eva restores the files…" />}
      {running === "keep" && <ProgressBar label="Eva starts the retry…" />}
    </Dialog>
  );
}

function FileGroup({
  title,
  paths,
}: {
  readonly title: string;
  readonly paths: readonly string[];
}): ReactElement | null {
  if (paths.length === 0) return null;
  return (
    <section className="undo-files" aria-label={title}>
      <p className="field-hint">{title}:</p>
      {/* A long list scrolls, so a keyboard must reach it. */}
      <ul tabIndex={0}>
        {paths.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

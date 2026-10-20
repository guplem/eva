/**
 * The notes in a vault sync conflict, each as a card with both versions side by side and the
 * three picks. Settings and the conflict dialog show the same list.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, type ConflictChoice, type VaultConflict, type VaultSyncState } from "./api.ts";
import { compareVersions, type DiffRow } from "./line-diff.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { ProgressBar } from "./Loading.tsx";

const pickLabels: Readonly<Record<ConflictChoice, string>> = {
  mine: "Keep mine",
  theirs: "Keep theirs",
  both: "Keep both",
};

/**
 * The list loads again when the sync state changes, so a sync that brings a new conflict shows
 * it. The last pick pushes, and the new state goes up.
 */
export function NoteConflicts({
  state,
  onState,
}: {
  readonly state: VaultSyncState;
  readonly onState: (state: VaultSyncState) => void;
}): ReactElement {
  const [conflicts, setConflicts] = useState<readonly VaultConflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The disabled buttons show only after a render, so two quick taps could send two picks.
  const picking = useRef(false);

  const load = (): void => {
    api
      .vaultConflicts()
      .then((report) => {
        setConflicts(report.conflicts);
        // The conflict can end elsewhere: a sync on another path, or a fix by hand. The parent then shows the new state.
        if (report.state.status !== "conflict") onState(report.state);
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : String(error)));
  };
  useEffect(load, [state.lastError, state.lastCommitAt]);

  const pick = async (path: string, choice: ConflictChoice): Promise<void> => {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    setNote(null);
    try {
      const result = await api.resolveVaultConflict(path, choice);
      if (result.found) {
        // A pick answers with no texts, so the cards keep theirs until the list loads again.
        setConflicts((current) =>
          result.conflicts.map((summary) => {
            const shown = current?.find((conflict) => conflict.path === summary.path);
            return { ...summary, mine: shown?.mine ?? null, theirs: shown?.theirs ?? null };
          }),
        );
        onState(result.state);
        // A note can change on the remote between two picks: the person must see its new text.
        if (result.conflicts.length > 0) load();
      } else {
        // A refused pick (an Assistant turn runs) keeps the list, so the person can pick again.
        setNote(result.state.lastError ?? "That note has no conflict anymore.");
        load();
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      picking.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="note-conflicts">
      {conflicts === null && note === null && <ProgressBar label="Loading the conflicts…" />}
      {conflicts?.length === 0 && <div>No note conflicts now.</div>}
      {conflicts?.map((conflict) => (
        <NoteConflictCard
          key={conflict.path}
          conflict={conflict}
          busy={busy}
          onPick={(choice) => void pick(conflict.path, choice)}
        />
      ))}
      {note !== null && <div role="alert">{note}</div>}
    </div>
  );
}

function NoteConflictCard({
  conflict,
  busy,
  onPick,
}: {
  readonly conflict: VaultConflict;
  readonly busy: boolean;
  readonly onPick: (choice: ConflictChoice) => void;
}): ReactElement {
  // An older Eva sends no texts. The diff is slow on long notes, and the page renders often while a chat streams.
  const mine = conflict.mine ?? null;
  const theirs = conflict.theirs ?? null;
  const comparison = useMemo(() => compareVersions(mine, theirs), [mine, theirs]);
  const name = conflict.path.split("/").at(-1) ?? conflict.path;
  return (
    <section className="conflict-card" aria-label={`Conflict: ${conflict.path}`}>
      <div className="conflict-head">
        <Visor size={36} face={stateFaces.conflict} />
        <div>
          <strong>{name} changed here and on the remote</strong>
          <div className="field-hint">
            {conflict.path === name ? "" : `${conflict.path}. `}Eva kept both. Pick the one to keep.
          </div>
        </div>
      </div>
      <div className="conflict-versions">
        <Version title="This machine" text={mine} rows={comparison.mine} />
        <Version title="The remote" text={theirs} rows={comparison.theirs} />
      </div>
      {conflict.picked !== null && (
        <div className="field-hint">Picked: {pickLabels[conflict.picked].toLowerCase()}.</div>
      )}
      <div className="conflict-picks" role="group" aria-label={conflict.path}>
        {(["mine", "theirs", "both"] as const).map((choice) => (
          <button
            key={choice}
            className={choice === "mine" ? "primary" : ""}
            disabled={busy}
            aria-label={`${pickLabels[choice]}: ${conflict.path}`}
            onClick={() => onPick(choice)}
          >
            {pickLabels[choice]}
          </button>
        ))}
      </div>
      <div className="field-hint">
        {conflict.kind === "uncommitted"
          ? "Keep theirs leaves this machine's edit in git's stash. "
          : "Git keeps both versions either way. "}
        Keep both keeps mine and puts theirs in a copy beside the note. When one side deleted the note, Keep both keeps
        the other side and makes no copy.
      </div>
    </section>
  );
}

function Version({
  title,
  text,
  rows,
}: {
  readonly title: string;
  readonly text: string | null;
  readonly rows: readonly DiffRow[];
}): ReactElement {
  return (
    <div className="conflict-version">
      <div className="label">{title}</div>
      {text === null ? (
        <div className="field-hint">No text to show: this side deleted the note, or it is not a short text file.</div>
      ) : (
        <div className="diff">
          {rows.map((row, index) =>
            row.kind === "gap" ? (
              <div key={index} className="gap">
                {row.count} lines that did not change
              </div>
            ) : (
              <div key={index} className={row.kind === "changed" ? "a" : undefined}>
                {row.text === "" ? " " : row.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

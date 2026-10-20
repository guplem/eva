/**
 * The setup card of a new or changed schedule (lesson 66). Anyone who can push to the vault can
 * add a schedule (lesson 67), so the schedule runs only after the person confirms that they made it.
 * The card shows every field, so nothing that someone pushed stays hidden.
 */
import { useState, type ReactElement } from "react";
import type { ScheduleCard } from "./api.ts";
import { Icon } from "./icons.tsx";
import { dayNumbersOf, repeatWords, slotWords } from "./schedule-words.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

/** The name is in the heading, and "When" says the time and the days together. */
const labels: Record<string, string> = { text: "Text", file: "File", prompt: "Prompt", model: "Model", id: "Id" };
const inWhen = new Set(["name", "at", "days"]);

export function ScheduleCardDialog(props: {
  card: ScheduleCard;
  onConfirm: () => void;
  onRemove: () => void;
}): ReactElement {
  const { card } = props;
  // Keyed by the schedule, so the next card never opens on the question of the last one.
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const asking = askingFor === card.scheduleId;
  const setAsking = (value: boolean): void => setAskingFor(value ? card.scheduleId : null);
  const changed = new Set<string>(card.changed);
  const heading =
    card.changed.length === 0
      ? `New schedule: ${card.name}`
      : `Schedule changed (${card.changed.join(", ")}): ${card.name}`;
  const when = card.fields.at === undefined ? "" : repeatWords(card.fields.at, dayNumbersOf(card.fields.days ?? ""));
  const row = (name: string, label: string, value: string, isChanged: boolean): ReactElement => (
    <div key={name} style={{ display: "contents" }}>
      <dt className={isChanged ? "changed" : undefined}>{label}</dt>
      <dd className={isChanged ? "changed" : undefined}>{value}</dd>
    </div>
  );
  return (
    <div className="dialog-backdrop schedule-backdrop">
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label="Setup card">
        <Visor size={28} face={stateFaces.conflict} />
        <h2>{heading}</h2>
        <dl className="schedule-fields">
          {row("when", "When", when, changed.has("at") || changed.has("days"))}
          {Object.entries(card.fields)
            .filter(([name]) => !inWhen.has(name))
            .map(([name, value]) => row(name, labels[name] ?? name, value, changed.has(name)))}
          {row("next", "Next run", slotWords(card.nextRun), false)}
          {row("zone", "Time zone", card.timeZone, false)}
        </dl>
        {!asking && (
          <>
            <p className="schedule-small">It runs only after you confirm. Remove it if you did not make it.</p>
            <div className="schedule-sheet-actions">
              <button className="primary" onClick={props.onConfirm}>
                <Icon name="check" />
                Got it
              </button>
              <span className="spacer" />
              <button className="danger" onClick={() => setAsking(true)}>
                Remove schedule
              </button>
            </div>
          </>
        )}
        {asking && (
          <>
            <p>Remove {card.name}? It never runs, and it leaves the schedules file.</p>
            <div className="schedule-sheet-actions">
              <button className="danger" onClick={props.onRemove}>
                Remove
              </button>
              <span className="spacer" />
              <button onClick={() => setAsking(false)}>Keep</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The setup card of a new or changed schedule (lesson 66). Anyone who can push to the vault can
 * add a schedule (lesson 67), so the schedule runs only after the person confirms that they made it.
 */
import type { ReactElement } from "react";
import type { ScheduleCard } from "./api.ts";

export function ScheduleCardDialog(props: {
  card: ScheduleCard;
  onConfirm: () => void;
  onRemove: () => void;
}): ReactElement {
  const { card } = props;
  const heading =
    card.changed.length === 0
      ? `New schedule: ${card.name}`
      : `Schedule changed (${card.changed.join(", ")}): ${card.name}`;
  return (
    <div className="dialog-backdrop">
      <div className="dialog schedule-card" role="dialog" aria-modal="true" aria-label="Setup card">
        <strong>{heading}</strong>
        <dl className="card-fields">
          {Object.entries(card.fields).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          Next run: {card.nextRun?.replace("T", " ") ?? "never"} ({card.timeZone})
        </div>
        <div>It runs only after you confirm. Remove it if you did not make it.</div>
        <div className="message-actions">
          <button className="primary" onClick={props.onConfirm}>
            Got it
          </button>
          <button className="danger" onClick={props.onRemove}>
            Remove schedule
          </button>
        </div>
      </div>
    </div>
  );
}

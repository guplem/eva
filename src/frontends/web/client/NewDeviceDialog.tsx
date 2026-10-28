/**
 * The notice that a new device asks to log in. It shows the code in the same large type as the
 * login page, so the person compares the two screens. A phone shows it as a bottom sheet.
 */
import type { ReactElement } from "react";
import type { DeviceLoginRequest } from "./api.ts";
import { Icon } from "./icons.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { dialogBackdropClass } from "./Dialog.tsx";

export function NewDeviceDialog(props: {
  readonly request: DeviceLoginRequest;
  /** The person allowed it: EVE shows her delighted face for a moment, and the buttons go. */
  readonly allowed: boolean;
  /** An answer is on its way, so the buttons wait. */
  readonly busy: boolean;
  readonly onAnswer: (answer: "allow" | "deny") => void;
}): ReactElement {
  const { request, allowed } = props;
  return (
    <div className={dialogBackdropClass("device-backdrop")}>
      <div className="device-sheet" role="dialog" aria-modal="true" aria-label="New device">
        <Visor size={28} face={allowed ? stateFaces.thanked : stateFaces.searching} />
        <h2>{allowed ? "Allowed. The new device opens Eva now." : "A new device wants to get in. Allow it?"}</h2>
        <div className="device-code">{request.code}</div>
        <p className="device-hint">
          Allow it only if this is the code on the screen of your new device. Account: {request.account}.
        </p>
        {!allowed && (
          <div className="device-actions">
            <button className="primary" disabled={props.busy} onClick={() => props.onAnswer("allow")}>
              <Icon name="check" />
              Allow
            </button>
            <button className="danger" disabled={props.busy} onClick={() => props.onAnswer("deny")}>
              Deny
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

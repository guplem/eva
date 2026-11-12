/**
 * The devices page: the computers that run Eva with this vault, the hub first, the browsers that may
 * open Eva on this computer, and the notifications of this browser.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type ComputerSummary } from "./api.ts";
import { computerDetail } from "./device-words.ts";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { PushCard } from "./PushCard.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";

export function DevicesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <ComputersCard context={context} />
      <DevicesPanel onChanged={context.notify} onLoggedOut={context.onLoggedOut} />
      <PushCard context={context} />
    </>
  );
}

/** The card id stays "machine", so old links, the search and the "?" still reach it. */
function ComputersCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const [computers, setComputers] = useState<ComputerSummary[] | null>(null);
  const role = context.status?.role;
  const hub = context.status?.hub;

  // A new hub, from here or from another computer, changes the list.
  useEffect(() => {
    api.computers().then(setComputers, (error: unknown) => context.notify(errorText(error)));
  }, [role, hub]);

  const becomeHub = async (): Promise<void> => {
    try {
      context.setStatus(await api.becomeHub());
    } catch (error) {
      context.notify(errorText(error));
    }
  };

  return (
    <Card
      item="machine"
      title="Computers"
      description="Each computer that runs Eva with this vault. The hub is the one that runs Telegram and the schedules."
    >
      {computers === null ? (
        <ProgressBar label="Reading the computers…" />
      ) : (
        <ul className="device-list" aria-label="Computers">
          {computers.map((computer) => (
            <li key={computer.name}>
              <span className="device-icon">
                <Icon name={computer.role === "hub" ? "home" : "laptop"} />
              </span>
              <span className="device-text">
                <b>{computer.name}</b>
                <span className="device-detail">{computerDetail(computer)}</span>
              </span>
              {computer.role === "hub" && <span className="pill">Hub</span>}
              {computer.current && <span className="pill live">This one</span>}
            </li>
          ))}
        </ul>
      )}
      {role === "satellite" && (
        <div className="button-row">
          <button onClick={() => void becomeHub()}>Make this machine the hub</button>
        </div>
      )}
    </Card>
  );
}

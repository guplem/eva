/**
 * The devices that may open Eva with a device login. The person removes one, such as a lost phone,
 * and the others stay logged in.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type DeviceSummary } from "./api.ts";
import { allowedWords, describeDevice } from "./device-words.ts";
import { Icon } from "./icons.tsx";
import { Card } from "./SettingsParts.tsx";
import { ProgressBar } from "./Loading.tsx";

interface DevicesPanelProps {
  readonly onChanged: (note: string) => void;
  /** "Log out every device" ended this browser's login too. */
  readonly onLoggedOut: () => void;
}

export function DevicesPanel({ onChanged, onLoggedOut }: DevicesPanelProps): ReactElement {
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);

  const reload = async (): Promise<void> => {
    try {
      setDevices(await api.devices());
    } catch (error) {
      onChanged(errorText(error));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const remove = async (device: DeviceSummary, name: string): Promise<void> => {
    if (!window.confirm(`Remove ${name}? That device logs out.`)) return;
    try {
      await api.removeDevice(device.id);
    } catch (error) {
      onChanged(errorText(error));
      return;
    }
    onChanged("Removed. That device must ask again to open Eva.");
    await reload();
  };

  /** Ends every device login, this browser's included. The token still works. */
  const removeAll = async (): Promise<void> => {
    if (!window.confirm("Log out every device, this one included?")) return;
    try {
      await api.logOutEveryDevice();
      await api.logout();
      onLoggedOut();
    } catch (error) {
      onChanged(errorText(error));
    }
  };

  const now = new Date();
  return (
    <Card
      item="devices"
      title="Devices"
      description="These browsers may open Eva. When one is lost, remove it here."
      aside={
        <button className="danger device-log-out" onClick={() => void removeAll()}>
          Log out every device
        </button>
      }
    >
      {devices === null ? (
        <ProgressBar label="Reading the devices…" />
      ) : devices.length === 0 ? (
        <div className="field-hint">No device has logged in with a code yet.</div>
      ) : (
        <ul className="device-list" aria-label="Devices">
          {devices.map((device) => {
            const words = describeDevice(device.label);
            const detail = [words.browser, words.account, allowedWords(device.createdAt, now)]
              .filter((part) => part !== null)
              .join(" · ");
            return (
              <li key={device.id}>
                <span className="device-icon">
                  <Icon name={words.icon} />
                </span>
                <span className="device-text">
                  <b>{words.name}</b>
                  <span className="device-detail">{detail}</span>
                </span>
                {/* "This one" replaces Remove, so nobody logs out this browser by mistake. Log out does that. */}
                {device.current ? (
                  <span className="pill live">This one</span>
                ) : (
                  <button
                    className="ghost"
                    aria-label={`Remove ${words.name}, ${detail}`}
                    onClick={() => void remove(device, words.name)}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

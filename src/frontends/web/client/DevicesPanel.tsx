/**
 * The devices that may open Eva with a device login. The person removes one, such as a lost phone,
 * and the others stay logged in.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type DeviceSummary } from "./api.ts";
import { Card } from "./SettingsParts.tsx";

interface DevicesPanelProps {
  readonly onChanged: (note: string) => void;
  /** This browser removed its own device, so its login ended. */
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

  const remove = async (device: DeviceSummary): Promise<void> => {
    const question = device.current
      ? "Remove this device? This browser logs out."
      : `Remove ${device.label}? That device logs out.`;
    if (!window.confirm(question)) return;
    try {
      await api.removeDevice(device.id);
    } catch (error) {
      onChanged(errorText(error));
      return;
    }
    if (device.current) {
      onLoggedOut();
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

  return (
    <Card item="devices" title="Devices" description="These browsers may open Eva. When one is lost, remove it here.">
      {devices === null ? (
        <div className="field-hint">Loading…</div>
      ) : devices.length === 0 ? (
        <div className="field-hint">No device has logged in with a code yet.</div>
      ) : (
        <ul className="device-list" aria-label="Devices">
          {devices.map((device) => (
            <li key={device.id}>
              <span>
                {device.label}
                {device.current && <span className="pill done">This device</span>}
                <span className="field-hint">Allowed {new Date(device.createdAt).toLocaleString()}</span>
              </span>
              <button className="ghost danger" onClick={() => void remove(device)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button className="danger" onClick={() => void removeAll()}>
          Log out every device
        </button>
      </div>
    </Card>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The access page: phone access with Tailscale, the devices that may open Eva, and this machine's role. */
import type { ReactElement } from "react";
import { api } from "./api.ts";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { RemoteAccessPanel } from "./RemoteAccessPanel.tsx";
import { Card, errorText, Steps, type SettingsContext } from "./SettingsParts.tsx";

export function AccessSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <PhoneAccess context={context} />
      <DevicesPanel onChanged={context.notify} onLoggedOut={context.onLoggedOut} />
      <MachineCard context={context} />
      <AccountsCard context={context} />
    </>
  );
}

export function PhoneAccess({ context }: { readonly context: SettingsContext }): ReactElement {
  const remote = context.status?.remoteAccess ?? null;
  if (remote !== null) return <RemoteAccessPanel initial={remote} />;
  return (
    <Card item="remote-access" title="Use Eva from any device">
      <div className="field-hint">{context.status === null ? "Loading…" : "Phone access is off on this machine."}</div>
    </Card>
  );
}

/** How a new phone gets in: it shows a code, and an open Eva page, Telegram or the terminal allows it. */
export function DevicesGuide(): ReactElement {
  return (
    <Card title="Allow a new device" description="Each phone or computer asks once. You allow it from here.">
      <Steps>
        <li>Finish the phone access step first, so Eva has an address.</li>
        <li>On the phone, open Eva&apos;s address. The phone shows a short code.</li>
        <li>
          Keep this page open. It asks &quot;A new device wants to get in&quot;. Tap Allow when it shows the same code.
        </li>
        <li>
          You can also tap Allow in your Telegram chat, or run <code>eva devices allow</code> with the code on
          Eva&apos;s computer.
        </li>
      </Steps>
    </Card>
  );
}

function MachineCard({ context }: { readonly context: SettingsContext }): ReactElement | null {
  const status = context.status;
  if (status === null) return null;
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
      title="This machine"
      description="The hub is the one machine that runs Telegram and the schedules."
    >
      <div>
        {status.role === "hub"
          ? `This machine (${status.machine}) is the hub: it runs Telegram and the schedules.`
          : `This machine (${status.machine}) is a satellite. The hub is ${status.hub ?? "unknown"}.`}
      </div>
      {status.role === "satellite" && (
        <div className="button-row">
          <button onClick={() => void becomeHub()}>Make this machine the hub</button>
        </div>
      )}
    </Card>
  );
}

function AccountsCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const identities = context.settings.config.remoteAccess.allowedTailscaleIdentities;
  return (
    <Card
      item="accounts"
      title="Allowed Tailscale accounts"
      description="The accounts that may ask for a device login."
    >
      <div>
        {identities.length === 0 ? "Only the Tailscale account that owns this machine." : identities.join(", ")}
      </div>
      <div className="field-hint">
        This is a security setting, so it changes only on the machine. Run this there, with every account that may ask:
      </div>
      <code className="code-block">
        eva settings set remoteAccess.allowedTailscaleIdentities &apos;[&quot;you@example.com&quot;]&apos;
      </code>
    </Card>
  );
}

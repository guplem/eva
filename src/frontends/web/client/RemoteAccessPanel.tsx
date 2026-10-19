/**
 * Use Eva from any device, as two step rows. "On this machine" has the setup steps with a button
 * for each step Eva can do, then the address with Copy, Share and a QR code. "On each phone or
 * computer" has the steps for a new device. The page reads the status until the address works.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  actionLabel,
  deviceSteps,
  remoteAccessStep,
  setupSteps,
  type GuideStep,
} from "../../../core/remote-access/steps.ts";
import { api, type RemoteAccess } from "./api.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { qrCodeShape } from "./qr-code.ts";
import { Card, StatusIcon } from "./SettingsParts.tsx";

/** An action, such as an install, shows its progress soon after. */
const waitingPollMs = 3_000;
/** A ready address can still break, such as when Tailscale stops. Eva reads Tailscale every 30 seconds. */
const readyPollMs = 30_000;

export function RemoteAccessPanel({ initial }: { readonly initial: RemoteAccess }): ReactElement {
  const [access, setAccess] = useState<RemoteAccess>(initial);
  const [copied, setCopied] = useState(false);
  const showError = useShowError();
  const url = remoteAccessStep(access) === "ready" ? access.url : null;
  const ready = url !== null;

  useEffect(() => {
    // A failed read on a weak phone connection is quiet: the next read follows soon.
    const timer = setInterval(
      () => {
        api
          .status()
          .then((status) => {
            if (status.remoteAccess !== null) setAccess(status.remoteAccess);
          })
          .catch(() => undefined);
      },
      ready ? readyPollMs : waitingPollMs,
    );
    return () => {
      clearInterval(timer);
    };
  }, [ready]);

  const run = (action: NonNullable<GuideStep["action"]>): void => {
    const call = action === "install" ? api.installTailscale() : api.signInToTailscale();
    call.then(setAccess).catch(showError);
  };

  const copy = (text: string): void => {
    // The clipboard exists only on a secure page; a page through a plain http host name has none.
    if (typeof navigator.clipboard === "undefined") {
      showError(new Error("This browser cannot copy here. Copy the address by hand."));
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch(showError);
  };

  // `navigator.share` exists only where the system has a share sheet, such as on a phone.
  const canShare = typeof navigator.share === "function";

  const mark = ready ? "done" : remoteAccessStep(access) === "failed" ? "failed" : "missing";
  return (
    <Card
      item="remote-access"
      icon="globe"
      title="Use Eva from any device"
      description="Only through Tailscale, a free private network of your own devices. Strangers cannot reach Eva."
      aside={<span className={`pill ${mark}`}>{pillWords[mark]}</span>}
    >
      <div className="access-step">
        <StatusIcon state={mark} />
        <div className="access-step-text">
          <b>On this machine</b>
          {url !== null ? (
            <small>
              Tailscale is on. Address:{" "}
              <a className="access-address" href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </small>
          ) : (
            <small>Eva finds each change by herself within a minute.</small>
          )}
        </div>
        {url !== null && (
          <button onClick={() => copy(url)}>
            <Icon name="copy" />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {url !== null ? (
        <div className="access-share">
          <QrCode text={url} />
          {canShare && (
            <button
              onClick={() => {
                navigator.share({ title: "Eva", url }).catch(() => undefined);
              }}
            >
              Share
            </button>
          )}
        </div>
      ) : (
        <ol className="guide-steps">
          {setupSteps(access).map((step, index) => {
            const action = step.action;
            return (
              <li key={index}>
                <StepText step={step} />
                {action !== null && (
                  <>
                    {" "}
                    <button className="primary" onClick={() => run(action)}>
                      {actionLabel(action)}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="access-step">
        <span className="access-mark">
          <Icon name="phone" />
        </span>
        <div className="access-step-text">
          <b>On each phone or computer</b>
          <small>Install Tailscale and log in with the same account.</small>
        </div>
      </div>
      <ol className="guide-steps">
        {deviceSteps(access).map((step, index) => (
          <li key={index}>
            <StepText step={step} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

const pillWords: Readonly<Record<"done" | "missing" | "failed", string>> = {
  done: "Connected",
  missing: "Needs you",
  failed: "Failed",
};

function StepText({ step }: { readonly step: GuideStep }): ReactElement {
  return (
    <>
      {step.text}
      {step.link !== null && (
        <>
          {" "}
          <a href={step.link} target="_blank" rel="noreferrer">
            {step.link}
          </a>
        </>
      )}
    </>
  );
}

function QrCode({ text }: { readonly text: string }): ReactElement {
  const shape = qrCodeShape(text);
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label={`QR code of ${text}`}
      viewBox={`0 0 ${String(shape.size)} ${String(shape.size)}`}
      shapeRendering="crispEdges"
    >
      {/* A scanner needs dark modules on light, also in the dark theme. */}
      <rect width={shape.size} height={shape.size} fill="#ffffff" />
      <path d={shape.path} fill="#000000" />
    </svg>
  );
}

/**
 * Use Eva from any device: the setup steps with a button for each step Eva can do, then the
 * address with Copy, Share and a QR code. The page reads the status until the address works.
 */
import { useEffect, useState, type ReactElement } from "react";
import { deviceSteps, remoteAccessStep, setupSteps, type GuideStep } from "../../../core/remote-access/steps.ts";
import { api, type RemoteAccess } from "./api.ts";
import { useShowError } from "./error-toast.tsx";
import { qrCodeShape } from "./qr-code.ts";

/** A step that waits for the person ends soon after; Eva herself reads Tailscale every 30 seconds. */
const waitingPollMs = 3_000;

export function RemoteAccessPanel({ initial }: { readonly initial: RemoteAccess }): ReactElement {
  const [access, setAccess] = useState<RemoteAccess>(initial);
  const [copied, setCopied] = useState(false);
  const showError = useShowError();
  const url = remoteAccessStep(access) === "ready" ? access.url : null;
  const ready = url !== null;

  useEffect(() => {
    if (ready) return undefined;
    // A failed read on a weak phone connection is quiet: the next read follows soon.
    const timer = setInterval(() => {
      api
        .status()
        .then((status) => {
          if (status.remoteAccess !== null) setAccess(status.remoteAccess);
        })
        .catch(() => undefined);
    }, waitingPollMs);
    return () => {
      clearInterval(timer);
    };
  }, [ready]);

  const run = (action: GuideStep["action"]): void => {
    const call = action === "install" ? api.installTailscale() : api.signInToTailscale();
    call.then(setAccess).catch(showError);
  };

  const copy = (text: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch(showError);
  };

  // `navigator.share` exists only where the system has a share sheet, such as on a phone.
  const canShare = typeof navigator.share === "function";

  return (
    <fieldset className="remote-access">
      <legend>Use Eva from any device</legend>
      {url !== null ? (
        <>
          <div>
            Open Eva:{" "}
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          </div>
          <div className="check-row">
            <button onClick={() => copy(url)}>{copied ? "Copied" : "Copy"}</button>
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
          <QrCode text={url} />
        </>
      ) : (
        <>
          <div>Tailscale, a free private network of your own devices, opens Eva on your phone and other computers.</div>
          <h3>On this machine</h3>
          <ol>
            {setupSteps(access).map((step) => (
              <li key={step.text}>
                <StepText step={step} />
                {step.action !== null && (
                  <>
                    {" "}
                    <button onClick={() => run(step.action)}>
                      {step.action === "install" ? "Install Tailscale" : "Sign in to Tailscale"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          <div className="hint">Eva finds each change by herself. This page shows it within a few seconds.</div>
        </>
      )}
      <h3>On each phone or computer</h3>
      <ol>
        {deviceSteps(access).map((step) => (
          <li key={step.text}>
            <StepText step={step} />
          </li>
        ))}
      </ol>
    </fieldset>
  );
}

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

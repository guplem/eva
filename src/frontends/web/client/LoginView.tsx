import { useEffect, useState, type ReactElement, type SyntheticEvent } from "react";
import { api, ApiError, type DeviceLoginRequest } from "./api.ts";

/** The page asks again at this pace until the owner answers in Telegram, in the terminal or on another Eva page. */
const devicePollMs = 2_000;

type DeviceStep =
  | { readonly kind: "asking" }
  | { readonly kind: "waiting"; readonly request: DeviceLoginRequest }
  /** The token form, with the reason why the device login is not possible, or null. */
  | { readonly kind: "token"; readonly reason: string | null; readonly canAskAgain: boolean };

/**
 * A browser shows a short code, and the owner allows it in a terminal on Eva's computer or in
 * Telegram, so a phone needs no long token. The token stays as the last way in: in a form, never in a URL. The server answers
 * each login with a cookie.
 */
export function LoginView({ onLoggedIn }: { onLoggedIn: () => void }): ReactElement {
  const [step, setStep] = useState<DeviceStep>({ kind: "asking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    void api.requestDeviceLogin().then(
      (request) => {
        if (!isCancelled) setStep({ kind: "waiting", request });
      },
      (error: unknown) => {
        if (isCancelled) return;
        // A 403 means no Tailscale account names this browser: the token is the normal way in, with no reason to show.
        const isExpected = error instanceof ApiError && error.status === 403;
        setStep({
          kind: "token",
          reason: isExpected || !(error instanceof Error) ? null : error.message,
          canAskAgain: false,
        });
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (step.kind !== "waiting") return undefined;
    const timer = setInterval(() => {
      void api.deviceLoginState(step.request.id).then(
        (found) => {
          if (found.state === "allowed") onLoggedIn();
          else if (found.state === "denied")
            setStep({ kind: "token", reason: "The request was denied.", canAskAgain: true });
          else if (found.state === "expired")
            setStep({
              kind: "token",
              reason: "The request expired. Ask again, or log in with the token.",
              canAskAgain: true,
            });
        },
        () => undefined,
      );
    }, devicePollMs);
    return () => clearInterval(timer);
  }, [step, onLoggedIn]);

  if (step.kind === "asking") return <div className="empty">Loading…</div>;
  if (step.kind === "waiting") {
    const approvers = step.request.approvers;
    return (
      <div className="login" role="status">
        <h1>Eva</h1>
        <strong>Confirm this device</strong>
        <span>
          The code of this device is <code>{step.request.code}</code>.
        </span>
        {approvers.includes("terminal") && (
          <span>
            In a terminal on Eva's computer, run <code>eva devices allow {step.request.code}</code>. During{" "}
            <code>eva setup</code>, type the code where setup asks for it.
          </span>
        )}
        {approvers.includes("Telegram") && <span>Or tap Allow in your Telegram chat, if it shows the same code.</span>}
        {approvers.includes("Eva page") && (
          <span>Or tap Allow on an Eva page that is open and logged in on another device, if it shows the same code.</span>
        )}
        <span className="chip">This page opens by itself when you allow it.</span>
      </div>
    );
  }
  return (
    <TokenForm
      reason={step.reason}
      onLoggedIn={onLoggedIn}
      onAskAgain={
        !step.canAskAgain
          ? null
          : () => {
              setStep({ kind: "asking" });
              setAttempt((count) => count + 1);
            }
      }
    />
  );
}

function TokenForm({
  reason,
  onLoggedIn,
  onAskAgain,
}: {
  reason: string | null;
  onLoggedIn: () => void;
  onAskAgain: (() => void) | null;
}): ReactElement {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (token.trim() === "") {
      setError("Enter the token first.");
      return;
    }
    try {
      await api.login(token.trim());
      onLoggedIn();
    } catch {
      setError("This token is not valid.");
    }
  };

  return (
    <form className="login" onSubmit={(event) => void submit(event)}>
      <h1>Eva</h1>
      {reason !== null && <div role="status">{reason}</div>}
      {onAskAgain !== null && (
        <button type="button" onClick={onAskAgain}>
          Ask again
        </button>
      )}
      <label htmlFor="token">Token (from the localApiToken in your instance's secrets.json)</label>
      <input
        id="token"
        type="password"
        autoComplete="current-password"
        value={token}
        onChange={(event) => {
          setToken(event.target.value);
          setError(null);
        }}
      />
      {error !== null && (
        <span role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {error}
        </span>
      )}
      <button className="primary" type="submit">
        Log in
      </button>
    </form>
  );
}

import { useEffect, useState, type ReactElement, type ReactNode, type SyntheticEvent } from "react";
import { api, ApiError, type DeviceLoginRequest } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { loginFace } from "./login-faces.ts";
import { Visor } from "./Visor.tsx";

/** The page asks again at this pace until the owner answers in Telegram, in the terminal or on another Eva page. */
const devicePollMs = 2_000;

type DeviceStep =
  | { readonly kind: "asking" }
  | { readonly kind: "waiting"; readonly request: DeviceLoginRequest }
  | {
      readonly kind: "token";
      /** Why the device login is not possible, or null. */
      readonly reason: string | null;
      /** The request that ended, so the page can ask again. */
      readonly ended: "denied" | "expired" | null;
      /** The request that still waits, when the person chose the token by hand. */
      readonly waiting: DeviceLoginRequest | null;
    };

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
          ended: null,
          waiting: null,
        });
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [attempt]);

  // The token form keeps the request alive, so an Allow in Telegram still opens the page.
  const pending = step.kind === "waiting" ? step.request : step.kind === "token" ? step.waiting : null;
  useEffect(() => {
    if (pending === null) return undefined;
    const timer = setInterval(() => {
      void api.deviceLoginState(pending.id).then(
        (found) => {
          if (found.state === "allowed") onLoggedIn();
          else if (found.state === "denied")
            setStep({ kind: "token", reason: "The request was denied.", ended: "denied", waiting: null });
          else if (found.state === "expired")
            setStep({
              kind: "token",
              reason: "The request expired. Ask again, or log in with the token.",
              ended: "expired",
              waiting: null,
            });
        },
        () => undefined,
      );
    }, devicePollMs);
    return () => clearInterval(timer);
  }, [pending, onLoggedIn]);

  if (step.kind === "asking") {
    return (
      <LoginPage>
        <Visor size={128} face={loginFace("asking")} />
        <div className="login-working">Asking for a code…</div>
      </LoginPage>
    );
  }
  if (step.kind === "waiting") {
    return (
      <DeviceCode
        request={step.request}
        onUseToken={() => setStep({ kind: "token", reason: null, ended: null, waiting: step.request })}
      />
    );
  }
  const waiting = step.waiting;
  return (
    <TokenForm
      reason={step.reason}
      ended={step.ended}
      onLoggedIn={onLoggedIn}
      onAskAgain={
        step.ended === null
          ? null
          : () => {
              setStep({ kind: "asking" });
              setAttempt((count) => count + 1);
            }
      }
      onUseCode={waiting === null ? null : () => setStep({ kind: "waiting", request: waiting })}
    />
  );
}

function LoginPage({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <main className="login-page">
      <div className="login">{children}</div>
    </main>
  );
}

function DeviceCode({
  request,
  onUseToken,
}: {
  readonly request: DeviceLoginRequest;
  readonly onUseToken: () => void;
}): ReactElement {
  const { code, approvers } = request;
  return (
    <LoginPage>
      <Visor size={128} rotate />
      <div className="login-title">
        <h1>Confirm this device</h1>
        <p>Allow this code from a place you already trust.</p>
      </div>
      <div className="login-code-block">
        <div className="login-code">{code}</div>
        <CopyCodeButton code={code} />
      </div>
      <div className="login-ways">
        {approvers.includes("terminal") && (
          <Way icon="term">
            On Eva's computer, run
            <br />
            <code>eva devices allow {code}</code>
            <small>
              During <code>eva setup</code>, type the code where setup asks for it.
            </small>
          </Way>
        )}
        {approvers.includes("Telegram") && (
          <Way icon="chat">
            Or tap <b>Allow</b> in your Telegram chat, if it shows this code.
          </Way>
        )}
        {approvers.includes("Eva page") && (
          <Way icon="laptop">
            Or tap <b>Allow</b> on an Eva page open on another device, if it shows this code.
          </Way>
        )}
      </div>
      <div className="login-working">
        <span className="login-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span role="status">Waiting. This page opens by itself.</span>
      </div>
      <button type="button" className="login-quiet" onClick={onUseToken}>
        Log in with the token instead
      </button>
    </LoginPage>
  );
}

function Way({ icon, children }: { readonly icon: IconName; readonly children: ReactNode }): ReactElement {
  return (
    <div className="login-way">
      <span className="login-way-icon">
        <Icon name={icon} />
      </span>
      <div>{children}</div>
    </div>
  );
}

/** The clipboard exists only on a secure page. Elsewhere the button hides, and the person reads the large code. */
function CopyCodeButton({ code }: { readonly code: string }): ReactElement | null {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (typeof navigator.clipboard === "undefined") return null;
  return (
    <button
      type="button"
      className="login-copy"
      onClick={() => {
        navigator.clipboard.writeText(code).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}

function TokenForm({
  reason,
  ended,
  onLoggedIn,
  onAskAgain,
  onUseCode,
}: {
  readonly reason: string | null;
  readonly ended: "denied" | "expired" | null;
  readonly onLoggedIn: () => void;
  readonly onAskAgain: (() => void) | null;
  readonly onUseCode: (() => void) | null;
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
    <LoginPage>
      <Visor size={128} face={loginFace(ended ?? "token")} />
      <div className="login-title">
        <h1>Log in to Eva</h1>
        {reason !== null ? <p role="status">{reason}</p> : <p>Use the token of this instance.</p>}
      </div>
      {onAskAgain !== null && (
        <button type="button" className="login-ask-again" onClick={onAskAgain}>
          Ask again
        </button>
      )}
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="token">Token</label>
        <input
          id="token"
          type="password"
          autoComplete="current-password"
          aria-describedby="token-hint"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setError(null);
          }}
        />
        <small id="token-hint">
          It is the <code>localApiToken</code> in the <code>secrets.json</code> file of your instance.
        </small>
        {error !== null && (
          <span role="alert" className="login-error">
            {error}
          </span>
        )}
        <button className="primary" type="submit">
          Log in
        </button>
      </form>
      {onUseCode !== null && (
        <button type="button" className="login-quiet" onClick={onUseCode}>
          Use the code instead
        </button>
      )}
    </LoginPage>
  );
}

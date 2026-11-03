/**
 * pi's login with no terminal (#811): Eva runs pi's own login on her computer, and this panel
 * plays the person's part. It shows the provider's page or device code, and asks each question
 * of pi's login, such as an API key. The answer goes to pi, which saves the login in its folder.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PiLoginMethod, PiLoginState, PiProvider } from "../../../shared/pi-login.ts";
import { api } from "./api.ts";
import { LoggedIn } from "./LoggedIn.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { CommandLine, errorText, SelectField, Steps, type SettingsContext } from "./SettingsParts.tsx";

const methodNames: Readonly<Record<PiLoginMethod, string>> = {
  oauth: "Log in with my account",
  api_key: "Paste an API key",
};

/**
 * How often the page reads the state of a login that runs: a device login, or an OAuth login
 * that pi's own callback ends on Eva's computer, ends with no answer from the page.
 */
const pollMs = 2_000;

export function PiLoginPanel({ context }: { readonly context: SettingsContext }): ReactElement {
  const [providers, setProviders] = useState<readonly PiProvider[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Null: the login steps show only when no provider has a login, or when the person asks.
  const [chosen, setChosen] = useState<string | null>(null);
  // A login that already runs on Eva's computer, as after a phone reloads the page on the way back.
  const [running, setRunning] = useState<PiLoginState | null>(null);
  const [terminalSteps, setTerminalSteps] = useState(false);

  const load = async (): Promise<void> => {
    setLoadError(null);
    try {
      setProviders(await api.piProviders());
    } catch (error) {
      setLoadError(errorText(error));
    }
  };
  useEffect(() => {
    void load();
    api.piLoginState().then(
      (state) => {
        if (state.status !== "waiting") return;
        setRunning(state);
        setChosen(state.provider);
      },
      () => undefined,
    );
  }, []);

  const loggedIn = (providers ?? []).filter((provider) => provider.loggedIn);
  const showSteps = loggedIn.length === 0 || chosen !== null;
  // "": no provider is left without a login, so the steps start at the first one.
  const another = (providers ?? []).find((provider) => !provider.loggedIn)?.id ?? "";

  return (
    <>
      {providers === null && loadError === null && <ProgressBar label="Eva asks pi for its providers…" />}
      {loadError !== null && (
        <div className="callout warning">
          {loadError}{" "}
          <button className="link-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {chosen === null &&
        loggedIn.map((provider) => (
          <LoggedIn
            key={provider.id}
            service={provider.name}
            text={`pi is logged in to ${provider.name}.`}
            warning={`Eva asks pi to remove its ${provider.name} login from this machine. Chats with pi that use ${provider.name} stop until you log in again.`}
            logOut={async () => {
              await api.logOutOfPi(provider.id);
              await load();
              return { restartNeeded: false };
            }}
            context={context}
            onLogInAgain={() => setChosen(provider.id)}
          />
        ))}
      {chosen === null && loggedIn.length > 0 && (
        <button className="link-button" onClick={() => setChosen(another)}>
          Log in to another provider
        </button>
      )}
      {showSteps && providers !== null && (
        <PiLoginSteps
          // A login that runs gives the steps their first state, so a remount takes it.
          key={running === null ? "new" : "running"}
          providers={providers}
          first={chosen}
          running={running}
          context={context}
          onDone={() => {
            setChosen(null);
            setRunning(null);
            void load();
          }}
          onCancel={loggedIn.length > 0 ? () => setChosen(null) : null}
        />
      )}
      {!terminalSteps ? (
        <button className="link-button" onClick={() => setTerminalSteps(true)}>
          Use a terminal instead
        </button>
      ) : (
        <Steps>
          <li>
            On Eva&apos;s computer, open a terminal and run:
            <CommandLine command="pi" />
          </li>
          <li>
            In pi, type <code>/login</code> and follow its steps. Never choose Anthropic: a Claude login in pi costs
            extra money.
          </li>
          <li>Come back here and press Test.</li>
        </Steps>
      )}
    </>
  );
}

function PiLoginSteps({
  providers,
  first,
  running,
  context,
  onDone,
  onCancel,
}: {
  readonly providers: readonly PiProvider[];
  readonly first: string | null;
  readonly running: PiLoginState | null;
  readonly context: SettingsContext;
  readonly onDone: () => void;
  readonly onCancel: (() => void) | null;
}): ReactElement {
  const initial = providers.find((provider) => provider.id === first) ?? providers[0];
  const [providerId, setProviderId] = useState(initial?.id ?? "");
  const provider = providers.find((candidate) => candidate.id === providerId);
  const [method, setMethod] = useState<PiLoginMethod>(initial?.methods[0] ?? "oauth");
  const [state, setState] = useState<PiLoginState | null>(running);
  const [answer, setAnswer] = useState("");
  // One request at a time: a double tap would start a second login and end the first one.
  const [busy, setBusy] = useState(false);
  // Each action counts up, so a slow read from before it cannot bring back an older state.
  const action = useRef(0);
  // The login ends once on the page, even when two reads both bring its end.
  const ended = useRef(false);

  const waiting = state?.status === "waiting";
  useEffect(() => {
    if (!waiting || busy) return;
    const counted = action.current;
    const timer = setInterval(() => {
      api.piLoginState().then(
        (next) => {
          if (action.current === counted) show(next);
        },
        () => undefined,
      );
    }, pollMs);
    return () => {
      clearInterval(timer);
    };
  });

  const show = (next: PiLoginState): void => {
    if (next.status === "done") {
      if (ended.current) return;
      ended.current = true;
      setAnswer("");
      context.notify(`pi is logged in to ${provider?.name ?? next.provider ?? "the provider"}.`);
      context.reloadSettings();
      onDone();
      return;
    }
    setState(next);
  };

  const act = async (call: () => Promise<PiLoginState>): Promise<void> => {
    action.current += 1;
    const counted = action.current;
    setBusy(true);
    try {
      const next = await call();
      if (action.current === counted) show(next);
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    action.current += 1;
    setState(null);
    try {
      await api.stopPiLogin();
    } catch (error) {
      context.notify(errorText(error));
    }
  };

  const pick = (id: string): void => {
    setProviderId(id);
    const methods = providers.find((candidate) => candidate.id === id)?.methods ?? [];
    if (!methods.includes(method)) setMethod(methods[0] ?? "oauth");
  };

  const question = waiting ? state.question : null;
  const sendAnswer = (text: string): void => {
    setAnswer("");
    void act(() => api.answerPiLogin(text));
  };
  const starting = busy && !waiting;
  const sending = busy && question !== null;

  return (
    <>
      <Steps>
        <li>
          Choose the provider of your AI subscription or key. Claude is not here: log in to it on the Claude Code card.
          <SelectField
            label="Provider"
            value={providerId}
            choices={providers.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={pick}
          />
          {provider !== undefined && provider.methods.length > 1 && (
            <SelectField
              label="How to log in"
              value={method}
              choices={provider.methods.map((candidate) => ({ value: candidate, label: methodNames[candidate] }))}
              onChange={setMethod}
            />
          )}
          <div className="button-row">
            <button
              className={waiting ? "ghost" : "primary"}
              disabled={busy || provider === undefined}
              aria-busy={starting}
              onClick={() => void act(() => api.startPiLogin(providerId, method))}
            >
              {starting && <ButtonSpinner />}
              {starting ? "Starting the login…" : waiting ? "Start again" : "Log in"}
            </button>
            {waiting && (
              <button className="ghost" disabled={busy} onClick={() => void stop()}>
                Stop
              </button>
            )}
            {!waiting && onCancel !== null && (
              <button className="link-button" onClick={onCancel}>
                Keep the current login
              </button>
            )}
          </div>
          {starting && <ProgressBar label="Eva starts pi's login, which takes a few seconds…" />}
        </li>
        {waiting && state.link !== null && (
          <li>
            {state.link.code === null
              ? "Open the provider's page, and log in there with your own account."
              : "Open the provider's page, and type this code there:"}
            {state.link.code !== null && <CommandLine command={state.link.code} />}
            {state.link.instructions !== null && <p className="field-hint">{state.link.instructions}</p>}
            <div className="button-row">
              <a className="button-link" href={state.link.url} target="_blank" rel="noreferrer">
                Open the provider&apos;s page
              </a>
            </div>
          </li>
        )}
        {question !== null && (
          <li>
            {question.message}
            {question.kind === "code" && (
              <p className="field-hint">
                After the login, your browser may show an error page. Copy the whole address of that page, and paste it
                here.
              </p>
            )}
            {question.kind === "choice" ? (
              <div className="button-row">
                {question.choices.map((choice) => (
                  <button key={choice} disabled={busy} onClick={() => sendAnswer(choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-form">
                <input
                  aria-label={question.message}
                  type={question.kind === "secret" ? "password" : "text"}
                  placeholder={question.placeholder}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                />
                <button className="primary" disabled={busy} aria-busy={sending} onClick={() => sendAnswer(answer)}>
                  {sending && <ButtonSpinner />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            )}
            {sending && <ProgressBar label="pi checks the answer…" />}
            {question.kind === "secret" && (
              <p className="field-hint">The key goes to pi on this machine, never to your vault.</p>
            )}
          </li>
        )}
      </Steps>
      {waiting && question === null && !busy && (
        <ProgressBar label={state.progress ?? "pi waits for the provider. This page updates by itself."} />
      )}
      {state?.status === "failed" && <div className="callout warning">{state.error}</div>}
    </>
  );
}

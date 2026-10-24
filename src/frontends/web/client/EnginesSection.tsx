/** The AI engines page: the engine for new chats, then Claude Code and pi, each with numbered login steps. */
import { useState, type ReactElement, type ReactNode } from "react";
import { api, type PublicSettings } from "./api.ts";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { LoggedIn, reloadAfterSave } from "./LoggedIn.tsx";
import { ProgressBar } from "./Loading.tsx";
import { PermissionsCard } from "./PermissionsCard.tsx";
import { restartNote } from "./notes.ts";
import { SaveButton } from "./SaveButton.tsx";
import { stepMark } from "./setup-summary.ts";
import { ToolInstallButton } from "./ToolInstallButton.tsx";
import {
  Card,
  CheckRow,
  CommandLine,
  errorText,
  SecretField,
  SelectField,
  Steps,
  StatusPill,
  type SettingsContext,
} from "./SettingsParts.tsx";

type EngineName = PublicSettings["config"]["engines"]["default"];
type ModelAlias = PublicSettings["config"]["engines"]["claudeCode"]["defaultModel"];
type PermissionMode = PublicSettings["config"]["engines"]["claudeCode"]["permissionMode"];

const engineChoices: readonly { value: EngineName; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "pi", label: "pi" },
];

const modelChoices: readonly { value: ModelAlias; label: string }[] = [
  { value: "default", label: "Claude Code's default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const permissionModeChoices: readonly { value: PermissionMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "bypassPermissions", label: "Bypass permissions" },
];

export function EnginesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <DefaultEngineCard context={context} />
      <PermissionsCard chosenClaudeMode={chosenMode(context)} />
      <ClaudeCodeCard context={context} />
      <PiCard context={context} />
    </>
  );
}

function chosenMode(context: SettingsContext): { value: string; words: string } {
  const mode = context.settings.config.engines.claudeCode.permissionMode;
  return { value: mode, words: permissionModeChoices.find((choice) => choice.value === mode)?.label ?? mode };
}

function found(context: SettingsContext, engine: EngineName): boolean {
  return context.setup === null || context.setup.engines.some((name) => name === engine);
}

function DefaultEngineCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  return (
    <Card
      item="default-engine"
      title="Engine for new chats"
      description="The engine is the AI program that answers you. One with a login is enough."
    >
      <SelectField
        label="Engine for new chats"
        value={config.engines.default}
        choices={engineChoices}
        onChange={(value) => void context.saveNow({ engines: { default: value } })}
      />
      <SelectField
        label="Claude Code model"
        value={config.engines.claudeCode.defaultModel}
        choices={modelChoices}
        onChange={(value) => void context.saveNow({ engines: { claudeCode: { defaultModel: value } } })}
      />
      <SelectField
        label="Claude Code permission mode"
        value={config.engines.claudeCode.permissionMode}
        choices={permissionModeChoices}
        hint="Auto: Claude Code asks you only about risky actions. Bypass permissions: every action runs with no question, also one that reaches other people. A clone that Eva does not trust always uses Auto. The next card lists what each kind of chat may do."
        onChange={(value) => void context.saveNow({ engines: { claudeCode: { permissionMode: value } } })}
      />
    </Card>
  );
}

/** A Claude subscription logs in with a token from `claude setup-token`, which Eva can run for the page. */
export function ClaudeCodeCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const saved = context.settings.secretsSet.claudeOauthToken;
  const installed = found(context, "claude-code");
  const [terminalSteps, setTerminalSteps] = useState(false);
  const [loggingInAgain, setLoggingInAgain] = useState(false);
  const engineStep = context.setup?.progress.find((step) => step.key === "engine");
  // Without a token, Claude Code is the way to finish a missing engine step, so it needs the person too.
  const engineMissing = engineStep?.state === "missing";
  const card = (children: ReactNode): ReactElement => (
    <Card
      item="claude-code"
      title="Claude Code"
      description="Use your Claude subscription. Eva never uses an API key."
      aside={<StatusPill state={!installed || (!saved && engineMissing) ? "missing" : saved ? "done" : "optional"} />}
    >
      {children}
    </Card>
  );
  // A failed last test, as of an expired token, keeps the steps. The engine step may test pi instead.
  const failed = engineStep?.check === "claude-code" && stepMark(engineStep) === "failed";
  const loginWorks = installed && saved && !failed;
  if (loginWorks && !loggingInAgain)
    return card(
      <>
        <LoggedIn
          service="Claude Code"
          logOut={() => api.removeSecret("claudeOauthToken")}
          warning="Eva removes the Claude Code token from this machine. Chats with Claude Code stop until you log in again."
          context={context}
          onLogInAgain={() => setLoggingInAgain(true)}
        />
        <CheckRow name="claude-code" label="Test the Claude Code token" />
      </>,
    );
  return card(
    <>
      {!installed && (
        <>
          <div className="callout warning">
            Eva did not find the claude program on this machine. Press Install Claude Code, and Eva installs it. Then
            log in here.
          </div>
          <ToolInstallButton program="claude" name="Claude Code" context={context} />
        </>
      )}
      {installed && failed && (
        <div className="callout warning">The last test of the Claude Code token failed. Log in again.</div>
      )}
      {loginWorks && (
        <button className="link-button" onClick={() => setLoggingInAgain(false)}>
          Keep the current login
        </button>
      )}
      {installed && <ClaudeLoginSteps context={context} onLoggedIn={() => setLoggingInAgain(false)} />}
      {installed && !terminalSteps ? (
        <button className="link-button" onClick={() => setTerminalSteps(true)}>
          Get a token in a terminal instead
        </button>
      ) : (
        <Steps>
          <li>
            On any computer with a browser, open a terminal. Copy this command, paste it there and press Enter:
            <CommandLine command="claude setup-token" />
          </li>
          <li>A browser page opens. Log in with your Claude account, and allow the access.</li>
          <li>The terminal shows a long token. Copy it, and paste it here:</li>
        </Steps>
      )}
      <SecretField
        name="claudeOauthToken"
        label="Claude Code token"
        saved={saved}
        help={`${installed ? "The login above saves it here. You can also paste a token. " : ""}It starts with sk-ant-oat. It stays on this machine, never in your vault.`}
        check="claude-code"
        onChanged={(note) => reloadAfterSave(context, note)}
        onSaved={() => setLoggingInAgain(false)}
      />
    </>,
  );
}

/**
 * The login with no terminal: Eva runs `claude setup-token` on her computer, and the person logs
 * in on Claude's page from any device. The token never reaches the page.
 */
function ClaudeLoginSteps({
  context,
  onLoggedIn,
}: {
  readonly context: SettingsContext;
  readonly onLoggedIn: () => void;
}): ReactElement {
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // One request at a time: a double tap would start a second login and end the first one.
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Finish ends a login, so the question offers no save. While it runs, the guard waits.
  useLeaveGuard(code.trim() !== "" && !busy, null);

  const start = async (): Promise<void> => {
    setBusy(true);
    setStarting(true);
    // A new start ends the old login on Eva's computer, even when the new one fails.
    setLoginUrl(null);
    try {
      // A phone blocks a window that opens after a wait, so the page shows a link instead.
      setLoginUrl((await api.startClaudeLogin()).url);
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setBusy(false);
      setStarting(false);
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setFinishing(true);
    try {
      await api.finishClaudeLogin(code);
      setCode("");
      setLoginUrl(null);
      context.noteAndReload(restartNote("Logged in to Claude. Press Restart Eva so that chats use the new login."));
      // The setup steps reload above; the settings hold the "Saved" state of the token field.
      context.reloadSettings();
      onLoggedIn();
    } catch (error) {
      // Each failed Finish ends the login on Eva's computer, so the old link leads nowhere.
      setLoginUrl(null);
      context.notify(errorText(error));
    } finally {
      setBusy(false);
      setFinishing(false);
    }
  };
  // The server checks this too; here a bad paste keeps the link, as it never reaches claude.
  const codeReady = code.trim() !== "" && !/\s/.test(code.trim());

  return (
    <Steps>
      <li>
        Press Start the login. Eva makes a login link for you, which takes a few seconds.
        <div className="button-row">
          {/* After the link comes, the main action moves to step 2, so this button steps back. */}
          <button className={loginUrl === null ? "primary" : "ghost"} disabled={busy} onClick={() => void start()}>
            {starting ? "Making the link…" : loginUrl === null ? "Start the login" : "Start again"}
          </button>
          {loginUrl !== null && <span className="field-hint">The link is ready. Go to step 2.</span>}
        </div>
        {starting && <ProgressBar label="Eva makes the login link…" />}
      </li>
      <li>
        Open Claude&apos;s page. Log in with your own Claude account, and allow the access.
        <div className="button-row">
          {loginUrl === null ? (
            // A disabled button keeps the place of the link, so the person sees what comes.
            <button disabled>Open Claude&apos;s page</button>
          ) : (
            <a className="button-link" href={loginUrl} target="_blank" rel="noreferrer">
              Open Claude&apos;s page
            </a>
          )}
        </div>
      </li>
      <li>
        Claude&apos;s page shows a code. Copy it, paste it here, and press Finish:
        <div className="inline-form">
          {/* Always here: a phone may reload the page while the person is on Claude's page. */}
          <input
            aria-label="The code from Claude's page"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={finishing}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button className="primary" disabled={busy || !codeReady} onClick={() => void finish()}>
            {finishing ? "Checking the code…" : "Finish"}
          </button>
        </div>
        {finishing && (
          <ProgressBar label="Eva gives the code to Claude and waits for the token. This takes a few seconds." />
        )}
      </li>
    </Steps>
  );
}

function PiCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const initial = context.settings.config.engines.pi.models.default ?? "";
  const [model, setModel] = useState(initial);
  const installed = found(context, "pi");
  const save = (): Promise<boolean> => {
    const trimmed = model.trim();
    return context.saveNow({ engines: { pi: { models: { default: trimmed === "" ? null : trimmed } } } });
  };
  // The save trims, so a space at the end is no change.
  useLeaveGuard(model.trim() !== initial, save);
  return (
    <Card item="pi" title="pi" description="pi runs models of other providers, such as OpenAI. It is optional.">
      <div className="callout">
        The pi login needs a terminal on Eva&apos;s computer: pi asks its questions only there. To log in from this page
        alone, use Claude Code above.
      </div>
      {installed ? (
        <Steps>
          <li>
            On Eva&apos;s computer, open a terminal and run:
            <CommandLine command="pi" />
          </li>
          <li>
            In pi, type <code>/login</code> and follow its steps.
          </li>
          <li>Come back here and press Test.</li>
        </Steps>
      ) : (
        <>
          <div className="callout">
            Eva did not find the pi program on this machine. Press Install pi, and Eva installs it.
          </div>
          <ToolInstallButton program="pi" name="pi" context={context} />
        </>
      )}
      <div className="inline-form">
        <label className="field grow">
          <span className="field-label">pi model, such as openai/gpt-5 (empty: pi&apos;s own default)</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <SaveButton className="primary" disabled={model === initial} onSave={save}>
          Save the model
        </SaveButton>
      </div>
      <CheckRow name="pi" label="Test pi" />
    </Card>
  );
}

/** The connections page: GitHub, Telegram and Google. Each one is optional, and each card says why it helps. */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { GitHubLogin } from "./GitHubLogin.tsx";
import { GooglePanel } from "./GooglePanel.tsx";
import { LoggedIn, reloadAfterSave } from "./LoggedIn.tsx";
import { Card, CheckRow, StatusPill, Steps, SecretField, type SettingsContext } from "./SettingsParts.tsx";

export function ConnectionsSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <GitHubCard context={context} />
      <CommitIdentityCard context={context} />
      <TelegramCard context={context} />
      <GooglePanel context={context} />
    </>
  );
}

export function GitHubCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const saved = context.settings.secretsSet.githubToken;
  const [tokenSteps, setTokenSteps] = useState(false);
  // The step knows whether the agents' gh has the login too (#244); before the setup loads, the token decides.
  const step = context.setup?.progress.find((each) => each.key === "github");
  const [loggingInAgain, setLoggingInAgain] = useState(false);
  const card = (children: ReactNode): ReactElement => (
    <Card
      item="github"
      title="GitHub"
      description="Eva uses your GitHub login for your private vault and projects."
      aside={<StatusPill state={step?.state ?? (saved ? "done" : "optional")} />}
    >
      {children}
    </Card>
  );
  // A token that the agents' gh lacks (#244) still needs the login, so the card keeps its steps.
  if (saved && step?.state !== "missing" && !loggingInAgain)
    return card(
      <>
        <LoggedIn
          service="GitHub"
          secret="githubToken"
          warning="Eva removes the GitHub token from this machine. The vault sync and your agents cannot reach GitHub until you log in again."
          context={context}
          onLogInAgain={() => setLoggingInAgain(true)}
        />
        <CheckRow name="github" label="Test the GitHub token" />
      </>,
    );
  return card(
    <>
      {/* "missing" means a saved token that the agents' gh lacks (#244): the step page hides that detail. */}
      {step?.state === "missing" && (
        <div className="callout warning">Your agents cannot push their work yet. Press Log in with GitHub.</div>
      )}
      {saved && step?.state !== "missing" && (
        <button className="link-button" onClick={() => setLoggingInAgain(false)}>
          Keep the current login
        </button>
      )}
      <GitHubLogin context={context} onLoggedIn={() => setLoggingInAgain(false)} />
      {!tokenSteps ? (
        <button className="link-button" onClick={() => setTokenSteps(true)}>
          Paste a token instead
        </button>
      ) : (
        <Steps>
          <li>
            Open{" "}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
              GitHub&apos;s new token page
            </a>
            . Log in if GitHub asks.
          </li>
          <li>
            Give the token a name, such as Eva. Pick the repositories of your vault and projects: the token reaches only
            those.
          </li>
          <li>
            Under the permissions, allow Contents and Pull requests: read and write. Then create the token and copy it.
          </li>
          <li>Paste the token here, and press Save.</li>
        </Steps>
      )}
      <SecretField
        name="githubToken"
        label="GitHub token"
        saved={saved}
        help="The login above saves the token here. You can also paste a token."
        check="github"
        onChanged={(note) => reloadAfterSave(context, note)}
      />
    </>,
  );
}

/** Empty fields keep the GitHub account's name and email, so most people never fill them. */
function CommitIdentityCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const git = context.settings.config.git;
  const [name, setName] = useState(git.name ?? "");
  const [email, setEmail] = useState(git.email ?? "");
  // A save here, in another tab or with `eva settings` reloads the settings; the fields follow them.
  useEffect(() => {
    setName(git.name ?? "");
    setEmail(git.email ?? "");
  }, [git.name, git.email]);
  const save = (): void => {
    const change = {
      git: { name: name.trim() === "" ? null : name.trim(), email: email.trim() === "" ? null : email.trim() },
    };
    void context.saveNow(change);
  };
  return (
    <Card
      item="commit-identity"
      title="Commit name and email"
      description="Eva and her agents sign each commit with them. Empty: your GitHub account's name and its private GitHub email."
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} placeholder="Your GitHub name" onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Email</span>
        <input
          type="email"
          autoCapitalize="none"
          autoComplete="off"
          value={email}
          placeholder="Your private GitHub email"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </Card>
  );
}

export function TelegramCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const saved = context.settings.secretsSet.telegramBotToken;
  const telegram = context.setup?.telegram ?? null;
  const pairing =
    telegram === null
      ? ""
      : telegram.paired
        ? "Telegram is paired with your chat."
        : telegram.pairingCode !== null
          ? `Telegram is not paired yet. Send ${telegram.pairingCode} to your bot.`
          : "Telegram is not set up: save a bot token, then restart Eva.";
  return (
    <Card
      item="telegram"
      title="Telegram"
      description="A Telegram bot of your own lets you talk to Eva from the Telegram app."
      aside={<StatusPill state={telegram?.paired === true ? "done" : "optional"} />}
    >
      <Steps>
        <li>
          In Telegram, open{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            @BotFather
          </a>{" "}
          and send <code>/newbot</code>.
        </li>
        <li>Pick a name for your bot. BotFather answers with a token. Copy it.</li>
        <li>Paste the token here, press Save, then press Restart Eva.</li>
        <li>Send the pairing code below to your bot, so that it talks only to you.</li>
        <li>
          Optional: give your bot Eva's face. Save{" "}
          <a href="/icon-512.png" download="eva.png">
            this picture
          </a>
          , send <code>/setuserpic</code> to BotFather, pick your bot and send the picture.
        </li>
      </Steps>
      <SecretField
        name="telegramBotToken"
        label="Telegram bot token"
        saved={saved}
        help="Make a bot with @BotFather in Telegram, then paste its token."
        check="telegram"
        onChanged={context.noteAndReload}
      />
      {pairing !== "" && <div className={telegram?.paired === true ? "callout success" : "callout"}>{pairing}</div>}
    </Card>
  );
}

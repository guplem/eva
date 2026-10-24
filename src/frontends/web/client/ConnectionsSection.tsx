/** The connections page: GitHub, Telegram and Google. Each one is optional, and each card says why it helps. */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { api } from "./api.ts";
import { GitHubLogin } from "./GitHubLogin.tsx";
import { GooglePanel } from "./GooglePanel.tsx";
import { useLeaveGuard } from "./leave-guard.ts";
import { LoggedIn, reloadAfterSave, type LoginWords } from "./LoggedIn.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { cardId, parseSettingsHash } from "./settings-routes.ts";
import { stepMark } from "./setup-summary.ts";
import { Card, CheckRow, StatusPill, Steps, SecretField, type SettingsContext } from "./SettingsParts.tsx";

export function ConnectionsSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <GitHubCard context={context} extra={<CommitIdentity context={context} />} />
      <TelegramCard context={context} />
      <GooglePanel context={context} />
    </>
  );
}

/** `extra` adds parts that only the Connections page shows, not the setup step. */
export function GitHubCard({
  context,
  extra,
}: {
  readonly context: SettingsContext;
  readonly extra?: ReactNode;
}): ReactElement {
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
      {extra}
    </Card>
  );
  // The card keeps its steps for a token that the agents' gh lacks (#244), and for a failed last test,
  // as of a revoked token: both fixes name Log in with GitHub.
  const loginWorks = saved && (step === undefined || stepMark(step) === "done");
  if (loginWorks && !loggingInAgain)
    return card(
      <>
        <LoggedIn
          service="GitHub"
          logOut={() => api.removeSecret("githubToken")}
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
      {step?.state === "done" && stepMark(step) === "failed" && (
        <div className="callout warning">The last test of the GitHub token failed. Press Log in with GitHub.</div>
      )}
      {loginWorks && (
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
        onSaved={() => setLoggingInAgain(false)}
      />
    </>,
  );
}

const commitIdentityItem = "commit-identity";

/**
 * Empty fields keep the GitHub account's name and email, so most people never fill them.
 * It sits in the GitHub card, because that login gives the default, and it hides behind a link until needed.
 */
function CommitIdentity({ context }: { readonly context: SettingsContext }): ReactElement {
  const git = context.settings.config.git;
  const [name, setName] = useState(git.name ?? "");
  const [email, setEmail] = useState(git.email ?? "");
  // A saved name or email, or a search result that names this part, opens the fields.
  const [open, setOpen] = useState(
    Boolean(git.name) || Boolean(git.email) || parseSettingsHash(window.location.hash).item === commitIdentityItem,
  );
  // A save here, in another tab or with `eva settings` reloads the settings; the fields follow them.
  useEffect(() => {
    setName(git.name ?? "");
    setEmail(git.email ?? "");
  }, [git.name, git.email]);
  const save = (): Promise<boolean> =>
    context.saveNow({
      git: { name: name.trim() === "" ? null : name.trim(), email: email.trim() === "" ? null : email.trim() },
    });
  useLeaveGuard(name !== (git.name ?? "") || email !== (git.email ?? ""), save);
  if (!open)
    return (
      <div id={cardId(commitIdentityItem)}>
        <button className="link-button" onClick={() => setOpen(true)}>
          Change the commit name and email
        </button>
      </div>
    );
  return (
    <div id={cardId(commitIdentityItem)} role="group" aria-label="Commit name and email">
      <p className="field-hint">
        Eva and her agents sign each commit with this name and email. Empty: your GitHub account&apos;s name and its
        private GitHub email.
      </p>
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
        <SaveButton className="primary" onSave={save}>
          Save
        </SaveButton>
      </div>
    </div>
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
  const step = context.setup?.progress.find((each) => each.key === "telegram");
  const [settingUpAgain, setSettingUpAgain] = useState(false);
  const card = (children: ReactNode): ReactElement => (
    <Card
      item="telegram"
      title="Telegram"
      description="A Telegram bot of your own lets you talk to Eva from the Telegram app."
      aside={<StatusPill state={telegram?.paired === true ? "done" : "optional"} />}
    >
      {children}
    </Card>
  );
  // A failed last test, as of a token that BotFather revoked, keeps the steps.
  const botWorks = saved && telegram?.paired === true && (step === undefined || stepMark(step) === "done");
  if (botWorks && !settingUpAgain)
    return card(
      <>
        <LoggedIn
          service="Telegram"
          text="Your Telegram bot is paired with your chat."
          words={telegramWords}
          warning="Eva removes the bot token from this machine. Your bot stops answering until you set it up again."
          logOut={() => api.removeSecret("telegramBotToken")}
          context={context}
          onLogInAgain={() => setSettingUpAgain(true)}
        />
        <CheckRow name="telegram" label="Test the Telegram bot token" />
      </>,
    );
  return card(
    <>
      {botWorks && (
        <button className="link-button" onClick={() => setSettingUpAgain(false)}>
          Keep the current bot
        </button>
      )}
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
        onChanged={(note) => reloadAfterSave(context, note)}
        onSaved={() => setSettingUpAgain(false)}
      />
      {pairing !== "" && <div className={telegram?.paired === true ? "callout success" : "callout"}>{pairing}</div>}
    </>,
  );
}

/** A bot connects rather than logs in. */
const telegramWords: LoginWords = {
  end: "Disconnect",
  endTitle: "Disconnect Telegram",
  ended: "Disconnected Telegram.",
  again: "Set up again",
};

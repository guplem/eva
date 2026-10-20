/** The connections page: GitHub, Telegram and Google. Each one is optional, and each card says why it helps. */
import { useEffect, useState, type ReactElement } from "react";
import { GooglePanel } from "./GooglePanel.tsx";
import { Card, StatusPill, Steps, SecretField, type SettingsContext } from "./SettingsParts.tsx";

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
  return (
    <Card
      item="github"
      title="GitHub"
      description="A GitHub token lets Eva reach a private vault and your private projects."
      aside={<StatusPill state={saved ? "done" : "optional"} />}
    >
      <Steps>
        <li>
          Open{" "}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
            GitHub&apos;s new token page
          </a>
          . Log in if GitHub asks.
        </li>
        <li>Give the token a name, such as Eva. Pick the repositories of your vault and projects.</li>
        <li>Under the permissions, allow at least Contents: read and write. Then create the token and copy it.</li>
        <li>Paste the token here, and press Save.</li>
      </Steps>
      <SecretField
        name="githubToken"
        label="GitHub token"
        saved={saved}
        help="Eva's git commands use it for a private vault over HTTPS."
        check="github"
        onChanged={context.noteAndReload}
      />
    </Card>
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

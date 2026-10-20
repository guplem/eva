/**
 * The vault step on the page, as in `eva setup`: pick the vault from the GitHub repositories, type
 * its address, or start a new vault in a new private repository. Eva clones it into her home folder.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type GitHubRepository, type VaultSetupResult } from "./api.ts";
import { GitHubLogin } from "./GitHubLogin.tsx";
import { errorText, SecretField, type SettingsContext } from "./SettingsParts.tsx";

type Listing =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "ready"; readonly repositories: readonly GitHubRepository[] };

export function VaultChooser({ context }: { readonly context: SettingsContext }): ReactElement {
  const hasToken = context.settings.secretsSet.githubToken;
  /** Which action runs now, so a second click never starts a second clone. */
  const [busy, setBusy] = useState<"clone" | "create" | null>(null);
  const [pasteToken, setPasteToken] = useState(false);

  const run = async (kind: "clone" | "create", work: () => Promise<VaultSetupResult>): Promise<void> => {
    setBusy(kind);
    try {
      const result = await work();
      const where =
        kind === "clone" ? `Cloned the vault into ${result.folder}.` : `Created a vault in ${result.folder}.`;
      context.noteAndReload(
        result.problem === null
          ? `${where} Press Restart now so that Eva uses it.`
          : `${where} It is only on this computer: ${result.problem}`,
      );
      // The buttons stay off after a success: the card shows the vault once the setup loads again.
    } catch (error) {
      context.notify(errorText(error));
      setBusy(null);
    }
  };

  return (
    <>
      {hasToken ? (
        <PickRepository
          context={context}
          busy={busy}
          onClone={(repository) => void run("clone", () => api.cloneVault(repository))}
        />
      ) : (
        <div className="vault-choice">
          <h3>Use your vault from GitHub</h3>
          <p className="field-hint">Log in to GitHub first, so that Eva can list your repositories.</p>
          <GitHubLogin context={context} />
          {!pasteToken ? (
            <button className="link-button" onClick={() => setPasteToken(true)}>
              Paste a token instead
            </button>
          ) : (
            <>
              <GitHubStepLink context={context} />
              <SecretField
                name="githubToken"
                label="GitHub token"
                saved={false}
                help="Eva uses it to list, clone and create your vault's repository. The GitHub step shows how to make one."
                onChanged={(note) => {
                  // The card reads whether a token is saved from the settings, so they load again too.
                  context.reloadSettings();
                  context.noteAndReload(note);
                }}
              />
            </>
          )}
        </div>
      )}
      <NewVault
        busy={busy}
        hasToken={hasToken}
        onCreate={(answers) => void run("create", () => api.createVault(answers))}
      />
    </>
  );
}

function PickRepository({
  context,
  busy,
  onClone,
}: {
  readonly context: SettingsContext;
  readonly busy: "clone" | "create" | null;
  readonly onClone: (repository: string) => void;
}): ReactElement {
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [picked, setPicked] = useState("");
  const [typed, setTyped] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setListing({ state: "loading" });
    try {
      setListing({ state: "ready", repositories: await api.vaultRepositories() });
    } catch (error) {
      setListing({ state: "failed", reason: errorText(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A typed address wins: the person typed it after the pick.
  const repository = typed.trim() !== "" ? typed.trim() : picked;
  return (
    <div className="vault-choice">
      <h3>Use your vault from GitHub</h3>
      {listing.state === "loading" && (
        <p className="field-hint" role="status">
          Reading your GitHub repositories…
        </p>
      )}
      {listing.state === "failed" && (
        <div className="callout danger callout-action">
          <span>Eva could not list your repositories. {listing.reason}</span>
          <button onClick={() => void load()}>Try again</button>
          {/* A wrong or old token is the usual cause, and the GitHub step replaces it. */}
          <GitHubStepLink context={context} />
        </div>
      )}
      {listing.state === "ready" && (
        <label className="field">
          <span className="field-label">Your vault&apos;s repository</span>
          <select value={picked} onChange={(event) => setPicked(event.target.value)}>
            <option value="">Pick a repository</option>
            {listing.repositories.map((each) => (
              <option key={each.cloneUrl} value={each.cloneUrl}>
                {each.fullName}
                {each.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Or type its name or address</span>
        <input
          autoComplete="off"
          placeholder="you/vault"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button className="primary" disabled={repository === "" || busy !== null} onClick={() => onClone(repository)}>
          {busy === "clone" ? "Cloning…" : "Clone this vault"}
        </button>
      </div>
    </div>
  );
}

function NewVault({
  busy,
  hasToken,
  onCreate,
}: {
  readonly busy: "clone" | "create" | null;
  readonly hasToken: boolean;
  readonly onCreate: (answers: { name: string; language: string; topics: string[]; repository: string }) => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [topics, setTopics] = useState("");
  const [repository, setRepository] = useState("vault");
  const create = (): void => {
    onCreate({
      name,
      language,
      topics: topics
        .split(",")
        .map((topic) => topic.trim())
        .filter((topic) => topic !== ""),
      // With no token, the vault stays on this computer, and the page offers the push later.
      repository: hasToken ? repository : "",
    });
  };
  return (
    <div className="vault-choice">
      <h3>Or create a new vault</h3>
      <p className="field-hint">
        Eva starts a vault from her template.
        {hasToken
          ? " She keeps it in a new private repository on your GitHub account."
          : " With a GitHub token, she also keeps it in a new private repository."}
      </p>
      <label className="field">
        <span className="field-label">What should Eva call you?</span>
        <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">The language of Eva&apos;s answers</span>
        <input value={language} onChange={(event) => setLanguage(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Your main topics</span>
        <input placeholder="work, family, music" value={topics} onChange={(event) => setTopics(event.target.value)} />
        <span className="field-hint">Separate them with commas. You can leave this empty.</span>
      </label>
      {hasToken && (
        <label className="field">
          <span className="field-label">Name of the new private repository</span>
          <input autoComplete="off" value={repository} onChange={(event) => setRepository(event.target.value)} />
        </label>
      )}
      <div className="button-row">
        <button className="primary" disabled={busy !== null || (hasToken && repository.trim() === "")} onClick={create}>
          {busy === "create" ? "Creating…" : "Create a new vault"}
        </button>
      </div>
    </div>
  );
}

/** A new vault with no repository yet, such as after a failed push: Eva puts it on GitHub. */
export function VaultPush({ context }: { readonly context: SettingsContext }): ReactElement {
  const [repository, setRepository] = useState("vault");
  const [pushing, setPushing] = useState(false);
  const push = async (): Promise<void> => {
    setPushing(true);
    try {
      const result = await api.pushVault(repository.trim());
      context.noteAndReload(`Pushed the vault to ${result.repository ?? repository}.`);
    } catch (error) {
      context.notify(errorText(error));
    } finally {
      setPushing(false);
    }
  };
  if (!context.settings.secretsSet.githubToken)
    return (
      <div className="callout warning">
        <p>
          Your vault is only on this computer. Log in to GitHub in the GitHub step, and Eva keeps it in a private
          repository.
        </p>
        <GitHubStepLink context={context} />
      </div>
    );
  return (
    <div className="vault-choice">
      <h3>Keep the vault on GitHub</h3>
      <p className="field-hint">
        Your vault is only on this computer. Eva makes a new private repository and pushes the vault to it. If GitHub
        made the repository already, type its address instead.
      </p>
      <div className="inline-form">
        <label className="field grow">
          <span className="field-label">Name of the new private repository</span>
          <input autoComplete="off" value={repository} onChange={(event) => setRepository(event.target.value)} />
        </label>
        <button className="primary" disabled={pushing || repository.trim() === ""} onClick={() => void push()}>
          {pushing ? "Pushing…" : "Push the vault"}
        </button>
      </div>
    </div>
  );
}

function GitHubStepLink({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <button className="link-button" onClick={() => context.navigate({ section: "setup", item: "github" })}>
      Open the GitHub step
    </button>
  );
}

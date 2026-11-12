/**
 * The vault step on the page, as in `eva setup`: search the GitHub repositories and pick the vault,
 * type its address, or start a new vault in a new private repository. Eva clones it into her home folder.
 */
import { regionalLocale } from "../../../shared/time-format.ts";
import { Fragment, useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type GitHubRepository, type VaultSetupResult } from "./api.ts";
import type { NewVaultAnswers } from "../../../core/vault/vault-setup.ts";
import { vaultFolders, vaultFoldersHint } from "../../../core/vault/vault-folders.ts";
import { newPasswordProblem } from "../../../shared/vault-unlock.ts";
import { GitHubLogin } from "./GitHubLogin.tsx";
import { ChoiceChips, errorText, SecretField, type SettingsContext } from "./SettingsParts.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { NewPasswordFields } from "./VaultPasswordForms.tsx";
import { Icon } from "./icons.tsx";
import {
  chosenRepository,
  defaultVaultRepository,
  firstVaultMatch,
  matchingRepositories,
  vaultFirst,
} from "./vault-repositories.ts";

type Path = "existing" | "new";

const pathChoices: readonly { value: Path; label: string; icon: "download" | "plus" }[] = [
  { value: "existing", label: "I have a vault on GitHub", icon: "download" },
  { value: "new", label: "Start a new vault", icon: "plus" },
];

type Listing =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "ready"; readonly repositories: readonly GitHubRepository[] };

export function VaultChooser({ context }: { readonly context: SettingsContext }): ReactElement {
  const hasToken = context.settings.secretsSet.githubToken;
  /** Which action runs now, so a second click never starts a second clone. */
  const [busy, setBusy] = useState<"clone" | "create" | null>(null);
  const [pasteToken, setPasteToken] = useState(false);
  // The two paths ask for different things, so the page shows only the chosen one. The other one
  // is hidden, not closed, so a tap on the other chip keeps its typed answers.
  const [path, setPath] = useState<Path>("existing");

  const run = async (kind: "clone" | "create", work: () => Promise<VaultSetupResult>): Promise<void> => {
    setBusy(kind);
    try {
      const result = await work();
      const where =
        kind === "clone" ? `Cloned the vault into ${result.folder}.` : `Created a vault in ${result.folder}.`;
      context.noteAndReload(
        result.problem === null
          ? `${where} Press Restart now so that Eva uses it.`
          : result.repository === null
            ? `${where} It is only on this computer: ${result.problem}`
            : // A pushed vault can still have a problem, such as settings that Eva could not save (#770).
              `${where} ${result.problem} Press Restart now so that Eva uses it.`,
      );
      // The buttons stay off after a success: the card shows the vault once the setup loads again.
    } catch (error) {
      context.notify(errorText(error));
      setBusy(null);
    }
  };

  return (
    <>
      <ChoiceChips label="Do you already have a vault?" value={path} choices={pathChoices} onChange={setPath} />
      <div className="kept-open" hidden={path !== "new"}>
        <NewVault
          busy={busy}
          hasToken={hasToken}
          onCreate={(answers) => void run("create", () => api.createVault(answers))}
        />
      </div>
      <div className="kept-open" hidden={path === "new"}>
        {hasToken ? (
          <PickRepository
            context={context}
            busy={busy}
            onClone={(repository) => void run("clone", () => api.cloneVault(repository))}
          />
        ) : (
          <div className="vault-choice">
            <p className="field-hint">
              Eva copies a vault that you made before, for example on another computer. Log in to GitHub first, so that
              Eva can list your repositories.
            </p>
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
      </div>
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
  // The clone address of the picked repository, or null before a pick.
  const [picked, setPicked] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // A save would clone, so the question offers no save. While the clone runs, the guard waits.
  useLeaveGuard(search.trim() !== "" && busy === null, null);

  const load = useCallback(async (): Promise<void> => {
    setListing({ state: "loading" });
    try {
      const repositories = vaultFirst(await api.vaultRepositories());
      setListing({ state: "ready", repositories });
      // The likely vault is picked already, unless the person picked another one before.
      setPicked((current) => current ?? firstVaultMatch(repositories)?.cloneUrl ?? null);
    } catch (error) {
      setListing({ state: "failed", reason: errorText(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = listing.state === "ready" ? matchingRepositories(listing.repositories, search) : [];
  const repository = chosenRepository(shown, picked, search);
  return (
    <div className="vault-choice">
      <p className="field-hint">
        Eva copies a vault that you made before, for example on another computer. Search for its repository, and pick
        it.
      </p>
      <label className="field">
        <span className="field-label">Your vault&apos;s repository</span>
        <span className="search-field">
          <Icon name="search" />
          <input
            type="search"
            autoComplete="off"
            placeholder="Search, or type an address"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </span>
      </label>
      {listing.state === "loading" && <ProgressBar label="Reading your GitHub repositories…" />}
      {listing.state === "failed" && (
        <div className="callout danger callout-action">
          <span>Eva could not list your repositories. {listing.reason}</span>
          <button onClick={() => void load()}>Try again</button>
          {/* A wrong or old token is the usual cause, and the GitHub step replaces it. */}
          <GitHubStepLink context={context} />
        </div>
      )}
      {shown.length > 0 && (
        // The rows of the update dialog: a hidden radio covers each row, for a tap on a phone.
        <div className="version-list repository-list">
          <div className="version-choices" role="radiogroup" aria-label="Your repositories">
            {shown.map((each) => (
              <label key={each.cloneUrl} className="version-row">
                <input
                  type="radio"
                  name="vault-repository"
                  value={each.cloneUrl}
                  checked={each.cloneUrl === repository}
                  onChange={() => setPicked(each.cloneUrl)}
                />
                <span className="repository-name">{each.fullName}</span>
                {each.private && <span className="status-pill idle">Private</span>}
              </label>
            ))}
          </div>
        </div>
      )}
      {listing.state === "ready" && shown.length === 0 && search.trim() !== "" && (
        <p className="field-hint">No repository in your list has this name. Eva uses what you typed as its address.</p>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={repository === "" || busy !== null}
          aria-busy={busy === "clone"}
          onClick={() => onClone(repository)}
        >
          {busy === "clone" && <ButtonSpinner />}
          {busy === "clone" ? "Cloning…" : "Use this vault"}
        </button>
      </div>
      {busy === "clone" && <ProgressBar label="Eva clones your vault…" />}
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
  readonly onCreate: (answers: NewVaultAnswers) => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [notesLanguage, setNotesLanguage] = useState("English");
  const [topics, setTopics] = useState("");
  const [repository, setRepository] = useState(defaultVaultRepository);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // A save would create the vault and its repository, so the question offers no save.
  const changed =
    name !== "" ||
    language !== "English" ||
    notesLanguage !== "English" ||
    topics !== "" ||
    repository !== defaultVaultRepository ||
    password !== "";
  useLeaveGuard(changed && busy === null, null);
  const create = (): void => {
    const found = newPasswordProblem(password, again);
    setProblem(found);
    if (found !== null) return;
    onCreate({
      password,
      name,
      language,
      notesLanguage,
      topics: topics
        .split(",")
        .map((topic) => topic.trim())
        .filter((topic) => topic !== ""),
      // With no token, the vault stays on this computer, and the page offers the push later.
      repository: hasToken ? repository : "",
      // The person's own forms, since the hub is often a server with none (#770).
      locale: regionalLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language]),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };
  return (
    <div className="vault-choice">
      <p className="field-hint">
        Eva starts an empty vault from her template, with a few answers about you.
        {hasToken
          ? " She keeps it in a new private repository on your GitHub account."
          : " With a GitHub login, she also keeps it in a new private repository."}
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
        <span className="field-label">The language of the notes in your vault</span>
        <input value={notesLanguage} onChange={(event) => setNotesLanguage(event.target.value)} />
        <span className="field-hint">
          Eva writes every note in this language, so one search finds everything. English is recommended.
        </span>
      </label>
      <label className="field">
        <span className="field-label">Your main topics</span>
        <input placeholder="work, family, music" value={topics} onChange={(event) => setTopics(event.target.value)} />
        <span className="field-hint">Separate them with commas. You can leave this empty.</span>
      </label>
      <p className="field-hint">The new vault gets these folders:</p>
      <dl className="facts" aria-label="The folders of the new vault">
        {vaultFolders.map(({ path, purpose }) => (
          <Fragment key={path}>
            <dt>{path}/</dt>
            <dd>{purpose}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="field-hint">{vaultFoldersHint}</p>
      <NewPasswordFields
        label="A vault password"
        password={password}
        again={again}
        onPassword={(value) => {
          setPassword(value);
          setProblem(null);
        }}
        onAgain={(value) => {
          setAgain(value);
          setProblem(null);
        }}
      />
      {problem !== null && (
        <div role="alert" className="callout danger">
          {problem}
        </div>
      )}
      {hasToken && (
        <label className="field">
          <span className="field-label">Name of the new private repository</span>
          <input autoComplete="off" value={repository} onChange={(event) => setRepository(event.target.value)} />
        </label>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy !== null || (hasToken && repository.trim() === "")}
          aria-busy={busy === "create"}
          onClick={create}
        >
          {busy === "create" && <ButtonSpinner />}
          {busy === "create" ? "Creating…" : "Create a new vault"}
        </button>
      </div>
      {busy === "create" && <ProgressBar label="Eva creates your vault…" />}
    </div>
  );
}

/** A new vault with no repository yet, such as after a failed push: Eva puts it on GitHub. */
export function VaultPush({ context }: { readonly context: SettingsContext }): ReactElement {
  const [repository, setRepository] = useState(defaultVaultRepository);
  const [pushing, setPushing] = useState(false);
  // A save would push, so the question offers no save.
  useLeaveGuard(repository !== defaultVaultRepository && !pushing, null);
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
        <button
          className="primary"
          disabled={pushing || repository.trim() === ""}
          aria-busy={pushing}
          onClick={() => void push()}
        >
          {pushing && <ButtonSpinner />}
          {pushing ? "Pushing…" : "Push the vault"}
        </button>
      </div>
      {pushing && <ProgressBar label="Eva pushes your vault to GitHub…" />}
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

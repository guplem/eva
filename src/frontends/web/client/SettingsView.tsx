/**
 * Settings, in sections like a browser's settings: a home page with a card per section, a side
 * list on a wide screen, a search, and a page per section and per setup step. The address names
 * the page (`#/settings/<section>/<item>`), so Back works and a reload stays on the page.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AccessSection } from "./AccessSection.tsx";
import { api, type EvaSetupState, type EvaStatus, type ProgressStep, type PublicSettings } from "./api.ts";
import { ConnectionsSection } from "./ConnectionsSection.tsx";
import { EnginesSection } from "./EnginesSection.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { PersonalizeSection } from "./PersonalizeSection.tsx";
import {
  cardId,
  parentRoute,
  parseSettingsHash,
  searchSettings,
  settingsHash,
  settingsHome,
  settingsSections,
  type SectionId,
  type SettingsRoute,
  type SettingsSection,
} from "./settings-routes.ts";
import { errorText, type SettingsContext } from "./SettingsParts.tsx";
import { nextMissing, SetupOverview, SetupStepPage, SetupRing } from "./SetupPages.tsx";
import { restartQuestion, setupSummary } from "./setup-summary.ts";
import { UpdatesSection } from "./UpdatesSection.tsx";
import { VaultSection } from "./VaultSection.tsx";

const statusPollMs = 3_000;
const restartPollLimit = 60;

/** `onSetupChanged` lets the page around it count the setup steps again, as for the badge on Settings. */
export function SettingsView({
  onLoggedOut,
  onSetupChanged,
}: {
  onLoggedOut: () => void;
  onSetupChanged?: () => void;
}): ReactElement {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [setup, setSetup] = useState<EvaSetupState | null>(null);
  const [status, setStatus] = useState<EvaStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<SettingsRoute>(() => parseSettingsHash(window.location.hash));
  const [query, setQuery] = useState("");
  /** The restart question while it waits for an answer, or null. */
  const [restartAsk, setRestartAsk] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseSettingsHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // A card that a search result or a link names scrolls into view, and shows for a moment.
  useEffect(() => {
    if (route.item === null || route.section === "setup") {
      document.querySelector(".settings-content")?.scrollTo({ top: 0 });
      return;
    }
    const card = document.getElementById(cardId(route.item));
    if (card === null) return;
    card.scrollIntoView({ block: "start" });
    card.classList.add("flash");
    const timer = setTimeout(() => card.classList.remove("flash"), 1_600);
    return () => clearTimeout(timer);
  }, [route, settings]);

  const notify = useCallback((note: string): void => setNotice(note), []);

  // A failed load must reach the person, because every problem must reach the phone.
  const loadSettings = useCallback((): void => {
    setLoadError(null);
    api
      .settings()
      .then(setSettings)
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, []);

  /** A save can finish a setup step, so the list and the badge read the state again. */
  const reloadSetup = useCallback((): void => {
    api
      .setupState()
      .then(setSetup)
      .catch(() => undefined);
    onSetupChanged?.();
  }, [onSetupChanged]);

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((error: unknown) => notify(errorText(error)));
    api
      .setupState()
      .then(setSetup)
      .catch((error: unknown) => notify(errorText(error)));
    loadSettings();
  }, [loadSettings, notify]);

  if (settings === null)
    return loadError === null ? (
      <div className="empty">Loading the settings…</div>
    ) : (
      <div className="empty" role="status">
        The settings did not load: {loadError} <button onClick={loadSettings}>Try again</button>
      </div>
    );

  const saveNow = async (change: Record<string, unknown>): Promise<boolean> => {
    let result: { restartNeeded: boolean };
    try {
      result = await api.saveSettings(change);
    } catch (error) {
      setNotice(errorText(error));
      return false;
    }
    setNotice(result.restartNeeded ? "Saved. Press Restart Eva to use the new setting." : "Saved.");
    reloadSetup();
    try {
      setSettings(await api.settings());
    } catch (error) {
      setNotice(`Saved, but the page did not reload the settings: ${errorText(error)}`);
    }
    return true;
  };

  /** The question names the running chats, because a restart stops them. */
  const askRestart = (): void => {
    Promise.all([api.status(), api.sessions()])
      .then(([current, sessions]) => {
        const busy = new Set(current.busySessionIds);
        const names = sessions.filter((session) => busy.has(session.id)).map((session) => session.title);
        setRestartAsk(restartQuestion(names));
      })
      .catch((error: unknown) => setNotice(errorText(error)));
  };

  /** Eva stops for a moment at a restart; the page asks again until she answers. */
  const restartNow = async (): Promise<void> => {
    setRestartAsk(null);
    try {
      await api.restart();
      setNotice("Eva restarts…");
      for (let attempt = 0; attempt < restartPollLimit; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, statusPollMs));
        try {
          await api.updateStatus();
          setNotice("Eva restarted.");
          reloadSetup();
          return;
        } catch {
          // Eva is still down; ask again.
        }
      }
      setNotice("Eva did not answer after the restart. Check her log.");
    } catch (error) {
      setNotice(errorText(error));
    }
  };

  const navigate = (next: SettingsRoute): void => {
    setQuery("");
    window.location.hash = settingsHash(next);
  };

  const context: SettingsContext = {
    settings,
    setup,
    status,
    saveNow,
    notify,
    noteAndReload: (note) => {
      setNotice(note);
      reloadSetup();
    },
    reloadSettings: () => {
      api
        .settings()
        .then(setSettings)
        .catch((error: unknown) => setNotice(errorText(error)));
    },
    setStatus,
    askRestart,
    navigate,
    onLoggedOut,
  };

  const steps = setup?.progress ?? [];
  const section = settingsSections.find((each) => each.id === route.section) ?? null;
  const atHome = section === null;

  return (
    <div className="main settings-main">
      <div className="settings-shell" data-at-home={atHome}>
        <nav className="settings-nav" aria-label="Settings sections">
          <button
            className="nav-item"
            aria-current={atHome ? "page" : undefined}
            onClick={() => navigate(settingsHome)}
          >
            <Icon name="gear" />
            Overview
          </button>
          {settingsSections.map((each) => (
            <button
              key={each.id}
              className="nav-item"
              aria-current={each.id === route.section ? "page" : undefined}
              onClick={() => navigate({ section: each.id, item: null })}
            >
              <Icon name={sectionIcons[each.id]} />
              <span className="settings-nav-label">{each.title}</span>
              <SectionMark section={each} steps={steps} />
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <header className="settings-header">
            {!atHome && (
              <button className="ghost back-button" aria-label="Back" onClick={() => navigate(parentRoute(route))}>
                <Icon name="back" />
              </button>
            )}
            <h1>{section === null ? "Settings" : section.title}</h1>
            <label className="search-field">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search settings"
                placeholder="Search settings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="restart-button" onClick={askRestart}>
              <Icon name="restart" />
              Restart Eva
            </button>
          </header>
          <div className="settings-page">
            {query.trim() !== "" ? (
              <SearchResults query={query} navigate={navigate} />
            ) : section === null ? (
              <SettingsHome context={context} />
            ) : (
              <SectionPage id={section.id} item={route.item} context={context} />
            )}
          </div>
          {restartAsk !== null && (
            <div className="settings-notice restart-question" role="alertdialog" aria-label="Restart Eva">
              <span>{restartAsk}</span>
              <div className="button-row">
                <button className="ghost" onClick={() => setRestartAsk(null)}>
                  Cancel
                </button>
                <button className="primary" onClick={() => void restartNow()}>
                  Yes, restart
                </button>
              </div>
            </div>
          )}
          {notice !== null && (
            // Sticky, so a phone shows the result of a control near the bottom of the screen.
            <div className="settings-notice" role="status">
              <span>{notice}</span>
              <button className="ghost" aria-label="Close the notice" onClick={() => setNotice(null)}>
                <Icon name="x" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const sectionIcons: Readonly<Record<SectionId, IconName>> = {
  setup: "check",
  engines: "term",
  vault: "folder",
  connections: "globe",
  access: "phone",
  personalize: "sun",
  updates: "download",
};

/** The state of a section's setup steps: a red count when a step needs the person, a green check when all are done. */
function sectionState(section: SettingsSection, steps: readonly ProgressStep[]): "missing" | "done" | null {
  const own = section.id === "setup" ? steps : steps.filter((step) => section.steps.some((key) => key === step.key));
  if (own.length === 0) return null;
  if (own.some((step) => step.state === "missing")) return "missing";
  return own.every((step) => step.state === "done") ? "done" : null;
}

function SectionMark({
  section,
  steps,
}: {
  readonly section: SettingsSection;
  readonly steps: readonly ProgressStep[];
}): ReactElement | null {
  const state = sectionState(section, steps);
  if (state === null) return null;
  if (state === "done")
    return (
      <span className="nav-mark done" role="img" aria-label="Done">
        <Icon name="check" />
      </span>
    );
  const missing = steps.filter(
    (step) => step.state === "missing" && (section.id === "setup" || section.steps.includes(step.key)),
  ).length;
  return (
    <span className="nav-mark missing" aria-label={`${String(missing)} to set up`}>
      {missing}
    </span>
  );
}

function SettingsHome({ context }: { readonly context: SettingsContext }): ReactElement {
  const steps = context.setup?.progress ?? [];
  const missing = setupSummary(steps).left;
  const next = nextMissing(steps);
  return (
    <>
      {context.setup !== null && (
        <section className={`card hero ${missing === 0 ? "done" : "missing"}`} aria-label="Setup">
          <div className="hero-text">
            <h2>{missing === 0 ? "Eva is set up" : "Finish setting up Eva"}</h2>
            <SetupRing steps={steps}>
              <span className="field-hint">
                {missing === 0
                  ? "Every needed step is done. Optional steps can add Telegram, GitHub and Google."
                  : "Each step that is left has a page that shows what to do."}
              </span>
            </SetupRing>
          </div>
          <div className="button-row">
            {next !== undefined ? (
              <button className="primary large" onClick={() => context.navigate({ section: "setup", item: next.key })}>
                Continue: {next.title}
                <Icon name="back" className="flip" />
              </button>
            ) : null}
            <button onClick={() => context.navigate({ section: "setup", item: null })}>See every step</button>
          </div>
        </section>
      )}
      <div className="section-grid">
        {settingsSections
          .filter((each) => each.id !== "setup")
          .map((each) => (
            <button
              key={each.id}
              className="section-card"
              onClick={() => context.navigate({ section: each.id, item: null })}
            >
              <span className="section-icon">
                <Icon name={sectionIcons[each.id]} />
              </span>
              <span className="section-card-text">
                <span className="section-card-title">
                  {each.title}
                  <SectionMark section={each} steps={steps} />
                </span>
                <span className="field-hint">{each.summary}</span>
              </span>
              <Icon name="back" className="chevron flip" />
            </button>
          ))}
      </div>
      <section className="card" aria-label="About these settings">
        <p className="card-description">
          These settings live in your vault, so every machine uses them: the time zone, updates, vault fetch, engines,
          Google account and voice language. These stay on each machine: the tokens, the allowed Tailscale accounts, the
          trusted repository owners and Google access.
        </p>
        <div className="button-row">
          <button onClick={() => void api.logout().then(context.onLoggedOut)}>
            <Icon name="key" />
            Log out
          </button>
        </div>
      </section>
    </>
  );
}

function SectionPage({
  id,
  item,
  context,
}: {
  readonly id: SectionId;
  readonly item: string | null;
  readonly context: SettingsContext;
}): ReactElement {
  switch (id) {
    case "setup":
      return item === null ? <SetupOverview context={context} /> : <SetupStepPage context={context} stepKey={item} />;
    case "engines":
      return <EnginesSection context={context} />;
    case "vault":
      return <VaultSection context={context} />;
    case "connections":
      return <ConnectionsSection context={context} />;
    case "access":
      return <AccessSection context={context} />;
    case "personalize":
      return <PersonalizeSection context={context} />;
    case "updates":
      return <UpdatesSection context={context} />;
  }
}

function SearchResults({
  query,
  navigate,
}: {
  readonly query: string;
  readonly navigate: (route: SettingsRoute) => void;
}): ReactElement {
  const results = searchSettings(query);
  if (results.length === 0) return <div className="empty">No setting matches “{query.trim()}”.</div>;
  return (
    <ul className="search-results" aria-label="Search results">
      {results.map((result) => {
        const section = settingsSections.find((each) => each.id === result.section);
        return (
          <li key={`${result.section}/${result.item}`}>
            <button className="section-card" onClick={() => navigate({ section: result.section, item: result.item })}>
              <span className="section-icon">
                <Icon name={sectionIcons[result.section]} />
              </span>
              <span className="section-card-text">
                <span className="section-card-title">{result.title}</span>
                <span className="field-hint">{section?.title}</span>
              </span>
              <Icon name="back" className="chevron flip" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

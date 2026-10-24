/**
 * Settings, in sections like a browser's settings: a home page with a card per section, a side
 * list on a wide screen, a search, and a page per section and per setup step. The address names
 * the page (`#/settings/<section>/<item>`), so Back works and a reload stays on the page.
 */
import { Fragment, useCallback, useEffect, useState, type ReactElement } from "react";
import { AccessSection } from "./AccessSection.tsx";
import { api, type EvaSetupState, type EvaStatus, type ProgressStep, type PublicSettings } from "./api.ts";
import { Dialog } from "./ChatPanel.tsx";
import { ConnectionsSection } from "./ConnectionsSection.tsx";
import { DesignReference } from "./DesignReference.tsx";
import { DeveloperSection } from "./DeveloperSection.tsx";
import { EnginesSection } from "./EnginesSection.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { PersonalizeSection } from "./PersonalizeSection.tsx";
import {
  cardId,
  designReferenceItem,
  parentRoute,
  parseSettingsHash,
  searchSettings,
  settingsHash,
  settingsHome,
  settingPlaces,
  settingsSections,
  type SettingHome,
  type SectionId,
  type SettingsRoute,
  type SettingsSection,
} from "./settings-routes.ts";
import { errorText, type SettingsContext } from "./SettingsParts.tsx";
import { needsYou, nextToDo, restartQuestion, setupSummary, stepMark } from "./setup-summary.ts";
import { SetupOverview, SetupRing, SetupStepPage } from "./SetupPages.tsx";
import { statusFacts } from "./status-overview.ts";
import { Toast } from "./Toast.tsx";
import { TrustSection } from "./TrustSection.tsx";
import { UpdatesSection } from "./UpdatesSection.tsx";
import { VaultSection } from "./VaultSection.tsx";
import { CardsSkeleton, ProgressBar } from "./Loading.tsx";
import { noteActionLabels, noteParts, restartNote, type Note } from "./notes.ts";

const statusPollMs = 3_000;
const restartPollLimit = 60;

/** `onSetupChanged` lets the page around it read the setup steps and the problems again, as for the badge on Settings. */
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
  const [notice, setNotice] = useState<Note | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<SettingsRoute>(() => parseSettingsHash(window.location.hash));
  const [query, setQuery] = useState("");
  /** The restart question while it waits for an answer, or null. */
  const [restartAsk, setRestartAsk] = useState<string | null>(null);
  /** True while a restart runs, so a second one does not stop the new Eva. */
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(parseSettingsHash(window.location.hash));
      setQuery("");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // A card that a search result or a link names scrolls into view, and shows for a moment.
  useEffect(() => {
    // A setup step and the design reference are pages of their own, not cards to scroll to.
    if (
      route.item === null ||
      route.section === "setup" ||
      (route.section === "developer" && route.item === designReferenceItem)
    ) {
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

  const notify = useCallback((note: Note): void => setNotice(note), []);

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
    // A card reads the open problems, such as an expired login that a restart clears.
    api
      .status()
      .then(setStatus)
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
      <div className="main settings-main">
        <div className="page-skeleton">
          <CardsSkeleton label="Loading the settings…" />
        </div>
      </div>
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
    setNotice(result.restartNeeded ? restartNote("Saved. Press Restart Eva to use the new setting.") : "Saved.");
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
    if (restarting) return;
    Promise.all([api.status(), api.sessions()])
      .then(([current, sessions]) => {
        const busy = new Set(current.busySessionIds);
        const names = sessions.filter((session) => busy.has(session.id)).map((session) => session.title);
        setRestartAsk(restartQuestion(names));
      })
      // A list that does not load must not block the restart, which may be the fix.
      .catch(() => setRestartAsk("The page could not read which chats run. A restart stops them. Restart Eva now?"));
  };

  /** Eva stops for a moment at a restart; the page asks again until she answers. */
  const restartNow = async (): Promise<void> => {
    setRestartAsk(null);
    setRestarting(true);
    try {
      setNotice(null);
      await api.restart();
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
    } finally {
      setRestarting(false);
    }
  };

  // The search clears when the page moves, not before: an unsaved change can keep the page.
  const navigate = (next: SettingsRoute): void => {
    const hash = settingsHash(next);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
      return;
    }
    // The same address fires no hashchange. A new route object still scrolls to the card again.
    setQuery("");
    setRoute(parseSettingsHash(hash));
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
    reloadSetup,
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
            <h1>{pageTitle(section, route.item)}</h1>
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
            <button className="restart-button" disabled={restarting} onClick={askRestart}>
              <Icon name="restart" />
              Restart Eva
            </button>
          </header>
          <div className="settings-page">
            {query.trim() !== "" && <SearchResults query={query} navigate={navigate} />}
            {/* Hidden, not closed, during a search: a form keeps its typed values. */}
            <div className="kept-open" hidden={query.trim() !== ""}>
              {section === null ? (
                <SettingsHome context={context} />
              ) : (
                <SectionPage id={section.id} item={route.item} context={context} />
              )}
            </div>
          </div>
          {restartAsk !== null && (
            <Toast
              message={restartAsk}
              role="alertdialog"
              label="Restart Eva"
              closeLabel="Close the question"
              onClose={() => setRestartAsk(null)}
              actions={
                <>
                  <button onClick={() => setRestartAsk(null)}>Cancel</button>
                  <button className="primary" onClick={() => void restartNow()}>
                    Yes, restart
                  </button>
                </>
              }
            />
          )}
          {restarting && notice === null && restartAsk === null && (
            <Toast message="Eva restarts…" role={null}>
              <ProgressBar label="Eva restarts…" />
            </Toast>
          )}
          {notice !== null && restartAsk === null && (
            // The toast shows the result of a control near the bottom of a phone screen.
            // The restart question takes its place, so the note never covers its buttons.
            <Toast
              message={noteParts(notice).text}
              closeLabel="Close the notice"
              onClose={() => setNotice(null)}
              actions={
                noteParts(notice).action === "restart" ? (
                  <button className="primary" disabled={restarting} onClick={askRestart}>
                    {noteActionLabels.restart}
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function pageTitle(section: SettingsSection | null, item: string | null): string {
  if (section === null) return "Settings";
  return section.id === "developer" && item === designReferenceItem ? "Design reference" : section.title;
}

const sectionIcons: Readonly<Record<SectionId, IconName>> = {
  setup: "check",
  engines: "term",
  vault: "folder",
  connections: "globe",
  trust: "shield",
  access: "phone",
  personalize: "palette",
  updates: "download",
  developer: "bolt",
};

/** The state of a section's setup steps: a count when a step needs the person, a green check when all are done. */
function sectionState(section: SettingsSection, steps: readonly ProgressStep[]): "missing" | "done" | null {
  const own = section.id === "setup" ? steps : steps.filter((step) => section.steps.some((key) => key === step.key));
  if (own.length === 0) return null;
  if (own.some(needsYou)) return "missing";
  return own.every((step) => stepMark(step) === "done") ? "done" : null;
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
  const own = steps.filter((step) => needsYou(step) && (section.id === "setup" || section.steps.includes(step.key)));
  const failed = own.filter((step) => stepMark(step) === "failed").length;
  // A failed step is red on its own page, so its section's count is red too.
  return (
    <span
      className={`nav-mark ${failed > 0 ? "failed" : "missing"}`}
      aria-label={`${String(own.length)} to set up${failed > 0 ? `, ${String(failed)} failed` : ""}`}
    >
      {own.length}
    </span>
  );
}

function SettingsHome({ context }: { readonly context: SettingsContext }): ReactElement {
  const steps = context.setup?.progress ?? [];
  const missing = setupSummary(steps).left;
  const next = nextToDo(steps);
  const [showingHomes, setShowingHomes] = useState(false);
  // A new function at each render would make the dialog move the focus back to its Close button.
  const closeHomes = useCallback((): void => setShowingHomes(false), []);
  return (
    <>
      {context.setup !== null && (
        <section className="card hero" aria-label="Setup">
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
      {context.status !== null && (
        <section className="card" aria-label="Status">
          <h2>Status</h2>
          <dl className="facts">
            {statusFacts(context.status).map((fact) => (
              <Fragment key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </Fragment>
            ))}
          </dl>
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
      <section className="card" aria-label="Where settings live">
        <p className="card-description">
          Some settings live in your vault, so every machine uses them. The others stay on this machine or in this
          browser.
        </p>
        <div className="button-row">
          <button onClick={() => setShowingHomes(true)}>See where each setting lives</button>
        </div>
      </section>
      {showingHomes && <SettingHomesDialog navigate={context.navigate} onClose={closeHomes} />}
    </>
  );
}

const homeHeadings: Readonly<Record<SettingHome, string>> = {
  vault: "In your vault: every machine uses these",
  machine: "On this machine only",
  browser: "In this browser only",
};

function SettingHomesDialog({
  navigate,
  onClose,
}: {
  readonly navigate: (route: SettingsRoute) => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <Dialog label="Where each setting lives" onClose={onClose}>
      <h2>Where each setting lives</h2>
      <div className="setting-homes">
        {(Object.keys(homeHeadings) as SettingHome[]).map((home) => (
          <Fragment key={home}>
            <h3>{homeHeadings[home]}</h3>
            <ul className="search-results">
              {settingPlaces
                .filter((place) => place.home === home)
                .map(({ title, keys, link }) => (
                  <li key={title}>
                    {link === null ? (
                      <SettingLink
                        section={null}
                        title={title}
                        hint={`No page yet. In a terminal: eva settings set ${keys.join(", ")}`}
                      />
                    ) : (
                      <SettingLink section={link.section} title={title} onOpen={() => navigate(link)} />
                    )}
                  </li>
                ))}
            </ul>
          </Fragment>
        ))}
      </div>
    </Dialog>
  );
}

/** One row that opens a setting's card: a search result, or a row of the setting homes. Without `onOpen`, the row only names it. */
function SettingLink({
  section,
  title,
  hint,
  onOpen,
}: {
  readonly section: SectionId | null;
  readonly title: string;
  /** Absent: the section's title. */
  readonly hint?: string;
  readonly onOpen?: () => void;
}): ReactElement {
  const known = settingsSections.find((each) => each.id === section);
  const parts = (
    <>
      <span className="section-icon">
        <Icon name={section === null ? "info" : sectionIcons[section]} />
      </span>
      <span className="section-card-text">
        <span className="section-card-title">{title}</span>
        <span className="field-hint">{hint ?? known?.title}</span>
      </span>
    </>
  );
  // A row that opens nothing is text, not a disabled button, so a keyboard user still reads it.
  if (onOpen === undefined) return <div className="section-card">{parts}</div>;
  return (
    <button className="section-card" onClick={onOpen}>
      {parts}
      <Icon name="back" className="chevron flip" />
    </button>
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
    case "trust":
      return <TrustSection context={context} />;
    case "access":
      return <AccessSection context={context} />;
    case "personalize":
      return <PersonalizeSection context={context} />;
    case "updates":
      return <UpdatesSection context={context} />;
    case "developer":
      return item === designReferenceItem ? <DesignReference /> : <DeveloperSection context={context} />;
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
      {results.map((result) => (
        <li key={`${result.section}/${result.item}`}>
          <SettingLink
            section={result.section}
            title={result.title}
            onOpen={() => navigate({ section: result.section, item: result.item })}
          />
        </li>
      ))}
    </ul>
  );
}

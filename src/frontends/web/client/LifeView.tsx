/**
 * The Life pages (#911): one page for each kind of entity in the vault's `Life/` folder. The list
 * shows a card for each entity, with a body fitted to its kind. An entity opens its own page with
 * its facts, its text and the files beside it. `life-pages.ts` holds every rule. This file only draws.
 */
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { api, ApiError, type LifeEntity, type LifeEntityDetail } from "./api.ts";
import { goTo, goUp } from "./back-layers.ts";
import { lifeAddressOf } from "./life-routes.ts";
import { displayFormat } from "./display-format.ts";
import { useShowError } from "./error-toast.tsx";
import { FactList } from "./FactList.tsx";
import { fileAddressOf } from "./file-paths.ts";
import { Icon, type IconName } from "./icons.tsx";
import {
  bodyWithoutTitle,
  caseSteps,
  lifeCardOf,
  lifeCardPill,
  lifeCounts,
  lifeFacts,
  lifeGroups,
  lifeHeader,
  lifeHiddenMatches,
  lifePages,
  matchesLifeSearch,
  type CaseStep,
  type DayState,
  type LifeCard,
  type LifeCardBody,
  type LifePill,
} from "./life-pages.ts";
import { FactsSkeleton, LifeListSkeleton } from "./Loading.tsx";
import { BackButton } from "./MainNav.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { countOf } from "./project-format.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { toWebHtml } from "./web-format.ts";
import { isLifeKind, type LifeKind } from "../../../shared/life-kinds.ts";
import { lifeKindsNamed, type KnownLifeIds } from "./vault-text-links.ts";

/** The search filters as the person types, after a short pause, so a long list does not stutter. */
const searchPauseMs = 150;

export function LifeView({
  kind,
  entityId,
}: {
  readonly kind: LifeKind;
  readonly entityId: string | null;
}): ReactElement {
  // The list state stays while an entity is open, so Back returns to the same search and filter.
  const [list, setList] = useState<readonly LifeEntity[] | "failed" | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(lifePages[kind].defaultFilter);
  const showError = useShowError();

  useEffect(() => {
    // An answer for an older kind must not fill the list of a newer one.
    let isCurrent = true;
    setList(null);
    api.lifeEntities(kind).then(
      (found) => {
        if (isCurrent) setList(found);
      },
      (caught: unknown) => {
        if (!isCurrent) return;
        setList("failed");
        showError(caught);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [kind, listVersion, showError]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), searchPauseMs);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="main life-view">
      {entityId === null ? (
        <LifeList
          kind={kind}
          list={list}
          search={search}
          query={query}
          filter={filter}
          onSearch={setSearch}
          onFilter={setFilter}
          onRetry={() => {
            // The wait shows at once, as on the first load.
            setList(null);
            setListVersion((version) => version + 1);
          }}
        />
      ) : (
        <LifeEntityPage key={entityId} kind={kind} entityId={entityId} />
      )}
    </div>
  );
}

// The list

interface LifeListProps {
  readonly kind: LifeKind;
  readonly list: readonly LifeEntity[] | "failed" | null;
  readonly search: string;
  readonly query: string;
  readonly filter: string;
  readonly onSearch: (text: string) => void;
  readonly onFilter: (filter: string) => void;
  readonly onRetry: () => void;
}

function LifeList({ kind, list, search, query, filter, onSearch, onFilter, onRetry }: LifeListProps): ReactElement {
  const page = lifePages[kind];
  const now = new Date();
  const entities: readonly LifeEntity[] = list === null || list === "failed" ? [] : list;
  const found = entities.filter((entity) => matchesLifeSearch(entity, query));
  const groups = lifeGroups(kind, found, filter, now);
  const hidden = lifeHiddenMatches(entities, query, filter);
  const hasEntities = entities.length > 0;
  return (
    <>
      <div className="main-header">
        <div className="header-text">
          <h1>{page.title}</h1>
          {/* One line while the list loads: the description can wrap on a phone, and the cards would then jump. */}
          <div className="sub">
            {hasEntities ? lifeCounts(kind, entities, now) : list === null ? "\u00a0" : page.description}
          </div>
        </div>
      </div>
      <div className="life-page">
        {hasEntities && (
          <div className="life-tools">
            <input
              className="project-search life-search"
              type="search"
              aria-label={page.searchLabel}
              placeholder={page.searchLabel}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            {page.filters.length > 0 && (
              <div className="filter-chips" role="group" aria-label="Show">
                {page.filters.map((choice) => (
                  <button
                    key={choice.id}
                    className="filter-chip"
                    aria-pressed={filter === choice.id}
                    onClick={() => onFilter(choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {list === null && <LifeListSkeleton kind={kind} label={`Loading the ${page.title.toLowerCase()}…`} />}
        {list === "failed" && (
          <div className="callout danger life-failed" role="alert">
            Eva could not read the {page.title.toLowerCase()}. <button onClick={onRetry}>Try again</button>
          </div>
        )}
        {Array.isArray(list) && !hasEntities && (
          <div className="center-empty life-empty">
            <Visor size={76} face={stateFaces.resting} />
            <strong>No {page.title.toLowerCase()} yet.</strong>
            <p>{page.empty}</p>
          </div>
        )}
        {hasEntities && groups.length === 0 && (
          <div className="empty life-none" role="status">
            <span>
              {query.trim() === ""
                ? "Nothing to show with this filter."
                : hidden === 0
                  ? `Nothing matches “${query.trim()}”.`
                  : `Nothing here matches “${query.trim()}”, but the filter hides ${hidden === 1 ? "1 match" : `${String(hidden)} matches`}.`}
            </span>
            {(query.trim() === "" || hidden > 0) && (
              <button className="ghost" onClick={() => onFilter("all")}>
                Show all
              </button>
            )}
          </div>
        )}
        {groups.map((group) => (
          <section key={group.label ?? "all"} className="life-group" aria-label={group.label ?? page.title}>
            {group.label !== null && (
              <h2 className="life-group-title">
                {group.label} <span className="life-group-count">{group.entities.length}</span>
              </h2>
            )}
            <ul className={kind === "periods" ? "life-grid rows" : "life-grid"}>
              {group.entities.map((entity) => (
                <li key={entity.id}>
                  <LifeCardButton
                    kind={kind}
                    card={lifeCardOf(entity, now)}
                    entityId={entity.id}
                    grouped={group.label !== null}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function StatePill({
  pill,
  tooltip,
  icon,
}: {
  readonly pill: LifePill;
  readonly tooltip?: string;
  readonly icon?: IconName;
}): ReactElement {
  return (
    <span className={`pill ${icon === undefined ? "dot " : ""}${pill.tone} life-pill`} data-tooltip={tooltip}>
      {icon !== undefined && <Icon name={icon} />}
      {pill.text}
    </span>
  );
}

/** A day with its state in words. A missed day also gets the alert icon, so the state has a shape. */
function DayPill({ day }: { readonly day: DayState }): ReactElement {
  return (
    <StatePill
      pill={{ text: day.words, tone: day.tone }}
      tooltip={day.text}
      {...(day.overdue ? { icon: "alert" as const } : {})}
    />
  );
}

function markStyle(color: string): CSSProperties {
  return { "--project-color": color } as CSSProperties;
}

function LifeCardButton({
  kind,
  card,
  entityId,
  grouped,
}: {
  readonly kind: LifeKind;
  readonly card: LifeCard;
  readonly entityId: string;
  /** The card sits under a heading of its type. */
  readonly grouped: boolean;
}): ReactElement {
  const { body } = card;
  const pill = lifeCardPill(body);
  const mark = body.kind === "people" || body.kind === "pets" ? body : null;
  // A period names its span above the title. An object names its type, unless its group heading does.
  const eyebrow = body.kind === "periods" ? body.span : body.kind === "objects" && !grouped ? body.type : null;
  const title = body.kind === "objects" ? (body.model ?? card.title) : card.title;
  return (
    <button className={`card life-card ${kind}`} onClick={() => goTo(lifeAddressOf(kind, entityId))}>
      <span className="life-card-head">
        {mark !== null && (
          <span className="project-mark life-mark" style={markStyle(mark.color)} aria-hidden="true">
            {mark.initials}
          </span>
        )}
        <span className="life-card-name">
          {eyebrow !== null && <span className="life-eyebrow">{eyebrow}</span>}
          <b className="life-card-title">{title}</b>
        </span>
        {pill !== null && <StatePill pill={pill} />}
      </span>
      <CardBody body={body} />
      {card.summary !== null && <span className="life-summary">{card.summary}</span>}
      {card.warnings > 0 && (
        <span className="pill warn life-pill">
          <Icon name="alert" /> {countOf(card.warnings, "warning")}
        </span>
      )}
    </button>
  );
}

function Line({ icon, children }: { readonly icon: IconName; readonly children: ReactNode }): ReactElement {
  return (
    <span className="life-line">
      <Icon name={icon} />
      <span>{children}</span>
    </span>
  );
}

/** What a card shows for its kind. The entity page shows it too, above the facts. */
function CardBody({ body }: { readonly body: LifeCardBody }): ReactElement | null {
  switch (body.kind) {
    case "cases": {
      const due = body.current?.due ?? null;
      const deadline = body.deadline?.due ?? null;
      const cost = body.deadline?.cost ?? null;
      return (
        <>
          {body.progress !== null && <StepsProgress progress={body.progress} />}
          {body.current !== null && (
            <span className="life-current">
              <Line icon="forward">{body.current.text}</Line>
              {body.current.waitingFor !== null && <Line icon="user">Waits for {body.current.waitingFor}</Line>}
            </span>
          )}
          {due !== null && (
            <span className="life-pills">
              <DayPill day={due} />
            </span>
          )}
          <DeadlineLine deadline={deadline} cost={cost} />
          {body.closed !== null && <Line icon="check">Closed on {body.closed}</Line>}
        </>
      );
    }
    case "people":
      return body.relation === null ? null : <span className="life-relation">{body.relation}</span>;
    case "objects":
      return body.ids.length === 0 && body.owner === null ? null : (
        <>
          {body.ids.length > 0 && (
            <span className="tags">
              {body.ids.map((id) => (
                <span key={id} className="tag mono">
                  {id}
                </span>
              ))}
            </span>
          )}
          {body.owner !== null && <Line icon="user">Owner: {body.owner}</Line>}
        </>
      );
    case "pets": {
      const kindWords = [body.species, body.breed].filter((part) => part !== null).join(" · ");
      return kindWords === "" && body.life === null ? null : (
        <span className="life-facts-line">
          {kindWords !== "" && <span>{kindWords}</span>}
          {body.life !== null && <span className="life-small">{body.life}</span>}
        </span>
      );
    }
    case "periods": {
      // The work gets a line of its own: a dot at the start of a wrapped line would read as noise.
      return (
        <>
          {body.work !== null && <span>{body.work}</span>}
          {(body.type !== null || body.length !== null) && (
            <span className="life-facts-line">
              {body.type !== null && <span className="tag">{body.type}</span>}
              {body.length !== null && <span className="life-small">{body.length}</span>}
            </span>
          )}
        </>
      );
    }
  }
}

function StepsProgress({
  progress,
}: {
  readonly progress: { done: number; total: number; words: string };
}): ReactElement {
  const share = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
  return (
    <span className="life-progress">
      <span className="life-progress-track" role="img" aria-label={progress.words}>
        <span className="life-progress-fill" style={{ width: `${String(share)}%` }} />
      </span>
      <span className="life-small">{progress.words}</span>
    </span>
  );
}

// The entity page

type EntityState = LifeEntityDetail | "missing" | "failed" | null;

function LifeEntityPage({ kind, entityId }: { readonly kind: LifeKind; readonly entityId: string }): ReactElement {
  const page = lifePages[kind];
  const [entity, setEntity] = useState<EntityState>(null);
  const [version, setVersion] = useState(0);
  const showError = useShowError();
  useEffect(() => {
    let isCurrent = true;
    api.lifeEntity(kind, entityId).then(
      (found) => {
        if (isCurrent) setEntity(found);
      },
      (caught: unknown) => {
        if (!isCurrent) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setEntity("missing");
          return;
        }
        setEntity("failed");
        showError(caught);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [kind, entityId, version, showError]);

  const back = (): void => goUp(lifeAddressOf(kind));
  const now = new Date();
  const shown = entity !== null && typeof entity === "object" ? entity : null;
  const card = shown === null ? null : lifeCardOf(shown, now);
  const header = shown === null ? null : lifeHeader(shown, now);
  const pill = card === null ? null : lifeCardPill(card.body);
  const mark = card?.body.kind === "people" || card?.body.kind === "pets" ? card.body : null;
  return (
    <>
      <div className="main-header life-entity-header">
        <BackButton label={`Back to ${page.title.toLowerCase()}`} text={page.title} onClick={back} />
        {mark !== null && (
          <span className="project-mark life-mark" style={markStyle(mark.color)} aria-hidden="true">
            {mark.initials}
          </span>
        )}
        <div className="header-text">
          <div className="header-title">
            <h1 data-tooltip={header?.title}>{header?.title ?? (entity === "missing" ? "Not found" : entityId)}</h1>
            {pill !== null && <StatePill pill={pill} />}
          </div>
          {(header?.sub ?? null) !== null && <div className="sub">{header?.sub}</div>}
        </div>
      </div>
      <div className="life-page life-entity">
        {entity === null && (
          <section className="card project-facts life-facts">
            <FactsSkeleton label={`Loading ${entityId}…`} rows={4} />
          </section>
        )}
        {entity === "failed" && (
          <div className="callout danger life-failed" role="alert">
            Eva could not read this page.{" "}
            <button
              onClick={() => {
                setEntity(null);
                setVersion((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {entity === "missing" && (
          <div className="center-empty life-empty life-missing" role="status">
            <Visor size={76} face={stateFaces.resting} />
            <strong>Eva cannot find “{entityId}”.</strong>
            <p>Its folder may have a new name, or it is gone.</p>
            <button onClick={back}>Back to {page.title}</button>
          </div>
        )}
        {card !== null && typeof entity === "object" && entity !== null && (
          <EntityDetails entity={entity} card={card} />
        )}
      </div>
    </>
  );
}

/**
 * The ids of each kind that the text or the facts of the entity name. A name holds spaces, so only
 * the real names tell where a path ends. A kind that fails to load links nothing.
 */
function useKnownIds(entity: LifeEntityDetail): KnownLifeIds {
  const [known, setKnown] = useState<KnownLifeIds>({});
  // A string, so the effect runs again only when the named kinds change.
  const named = lifeKindsNamed(`${entity.body}\n${JSON.stringify(entity.fields)}`).join(" ");
  useEffect(() => {
    let isCurrent = true;
    const kinds = named.split(" ").filter(isLifeKind);
    void Promise.all(
      kinds.map((kind) =>
        api.lifeEntities(kind).then(
          (list) => [kind, list.map((each) => each.id)] as const,
          () => [kind, []] as const,
        ),
      ),
    ).then((pairs) => {
      if (isCurrent) setKnown(Object.fromEntries(pairs) as KnownLifeIds);
    });
    return () => {
      isCurrent = false;
    };
  }, [named]);
  return known;
}

function EntityDetails({ entity, card }: { readonly entity: LifeEntityDetail; readonly card: LifeCard }): ReactElement {
  // The day order of the cards and the steps, such as "15 May 2026", so one page never shows two forms.
  const known = useKnownIds(entity);
  const facts = lifeFacts(entity, { locale: "en-GB", clock: displayFormat().clock }, known);
  const body = bodyWithoutTitle(entity.body, entity.title).trim();
  const steps = entity.kind === "cases" ? caseSteps(entity.fields, new Date()) : [];
  return (
    <>
      {entity.warnings.length > 0 && (
        <div className="warning-banner" role="note">
          <Icon name="alert" />
          <ul>
            {entity.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <section className={`card project-facts life-facts ${entity.kind}`} aria-label="Facts">
        {card.summary !== null && <p className="life-lead">{card.summary}</p>}
        <EntityHighlight body={card.body} />
        {facts.length > 0 && <FactList facts={facts} />}
        <div className="tags">
          <a className="mode-chip link-chip" href={fileAddressOf(entity.folder)}>
            <Icon name="folder" /> Open in Files
          </a>
        </div>
      </section>
      {card.body.kind === "cases" && (steps.length > 0 || card.body.current !== null) && (
        <section className="card life-steps" aria-label="Steps">
          <div className="life-section-head">
            <h2>Steps</h2>
            {card.body.progress !== null && <StepsProgress progress={card.body.progress} />}
          </div>
          {steps.length > 0 ? (
            <ol className="life-step-list">
              {steps.map((step, index) => (
                <StepRow key={index} step={step} />
              ))}
            </ol>
          ) : (
            <CardBody body={card.body} />
          )}
        </section>
      )}
      {body !== "" && (
        <section className="card life-text" aria-label="Notes">
          <h2>Notes</h2>
          <MarkdownBody
            html={toWebHtml(body, { vaultLinks: true, pathLinks: known })}
            className="answer-body life-markdown"
          />
        </section>
      )}
      {entity.files.length > 0 && (
        <section className="card life-files" aria-label="Files">
          <h2>Files</h2>
          <ul className="life-file-list">
            {entity.files.map((file) => (
              <li key={file.path}>
                <a className="life-file" href={fileAddressOf(file.path)}>
                  <Icon name={file.kind === "folder" ? "folder" : "file"} />
                  <span>{file.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const stepStateWords: Readonly<Record<CaseStep["state"], string>> = {
  done: "Done",
  current: "Now",
  todo: "To do",
};

/** A step with a mark of its state: a check when done, a filled dot now, an empty ring to do. */
function StepRow({ step }: { readonly step: CaseStep }): ReactElement {
  return (
    <li className={`life-step ${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
      <span className="life-step-mark" aria-hidden="true">
        {step.state === "done" && <Icon name="check" />}
      </span>
      <span className="life-step-text">
        <span className="visually-hidden">{stepStateWords[step.state]}: </span>
        <span>{step.text}</span>
        <span className="life-step-meta">
          {step.doneOn !== null && <span className="life-small">Done on {step.doneOn}</span>}
          {step.waitingFor !== null && <Line icon="user">Waits for {step.waitingFor}</Line>}
          {step.due !== null && step.state !== "done" && <DayPill day={step.due} />}
        </span>
      </span>
    </li>
  );
}

/** What the facts do not say: the deadline of a case, the age of a pet, or the span and length of a period. */
function EntityHighlight({ body }: { readonly body: LifeCardBody }): ReactElement | null {
  if (body.kind === "cases")
    return <DeadlineLine deadline={body.deadline?.due ?? null} cost={body.deadline?.cost ?? null} />;
  const words = body.kind === "pets" ? [body.life] : body.kind === "periods" ? [body.span, body.length] : [];
  const shown = words.filter((word) => word !== null);
  if (shown.length === 0) return null;
  return (
    <span className="life-facts-line life-highlight">
      {shown.map((word) => (
        <span key={word}>{word}</span>
      ))}
    </span>
  );
}

/** The deadline of a case, with what is lost beside it, so the cost reads as part of the deadline. */
function DeadlineLine({
  deadline,
  cost,
}: {
  readonly deadline: DayState | null;
  readonly cost: string | null;
}): ReactElement | null {
  if (deadline === null && cost === null) return null;
  return (
    <span className="life-deadline">
      {deadline !== null && <DayPill day={deadline} />}
      {cost !== null && <span className="life-small">{deadline === null ? `Deadline: ${cost}` : cost}</span>}
    </span>
  );
}

/**
 * The Guide section of Settings: the docs for people, with a page for each doc. Each link is an
 * address, so Back returns, and a link to a heading opens the doc at that heading.
 */
import type { MouseEvent, ReactElement } from "react";
import { githubFileUrl, guideItem, guidePages, renderedGuide, type GuideSource } from "./guide.ts";
import { Icon } from "./icons.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { Card } from "./SettingsParts.tsx";
import { isSettingsHash, parseSettingsHash, settingsHash, type SettingsRoute } from "./settings-routes.ts";

function addressOf(page: GuideSource, slug: string | null): string {
  return settingsHash({ section: "guide", item: guideItem(page.id, slug) });
}

/**
 * A tap on a Settings link goes through `navigate`, so a second tap on the same link still
 * scrolls to its heading: the same address fires no `hashchange`.
 */
function followSettingsLink(event: MouseEvent, navigate: (route: SettingsRoute) => void): void {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  const address = link?.getAttribute("href") ?? "";
  if (!isSettingsHash(address) || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(parseSettingsHash(address));
}

/** The guide's home page: each doc with the headings of its parts. */
export function GuideHome({ navigate }: { readonly navigate: (route: SettingsRoute) => void }): ReactElement {
  return (
    <div className="guide-page" onClick={(event) => followSettingsLink(event, navigate)}>
      {guidePages.map((page) => (
        <Card key={page.id} icon="book" title={page.title} description={page.summary}>
          <ol className="guide-contents link-list" aria-label={`Parts of ${page.title}`}>
            {renderedGuide(page)
              .sections.filter((section) => section.level === 2)
              .map((section) => (
                <li key={section.slug}>
                  <a href={addressOf(page, section.slug)}>{section.title}</a>
                </li>
              ))}
          </ol>
          <div className="button-row">
            <a className="button-link" href={addressOf(page, null)}>
              Read the page
              <Icon name="back" className="flip" />
            </a>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** One doc: the list of its parts, the doc, and the way to the other docs. */
export function GuideDocument({
  page,
  navigate,
}: {
  readonly page: GuideSource;
  readonly navigate: (route: SettingsRoute) => void;
}): ReactElement {
  const { html, sections } = renderedGuide(page);
  const index = guidePages.indexOf(page);
  const previous = guidePages[index - 1];
  const next = guidePages[index + 1];
  const parts = sections.filter((section) => section.slug !== null);
  return (
    <div className="guide-page" onClick={(event) => followSettingsLink(event, navigate)}>
      {parts.length > 0 && (
        // A new doc starts with the list closed again: on a phone, a long open list pushes the doc down.
        <nav key={page.id} className="card guide-toc" aria-label="Parts of this page">
          <details>
            <summary>On this page</summary>
            <ol className="link-list">
              {parts.map((section) => (
                <li key={section.slug} className={section.level === 3 ? "guide-toc-deep" : undefined}>
                  <a href={addressOf(page, section.slug)}>{section.title}</a>
                </li>
              ))}
            </ol>
          </details>
        </nav>
      )}
      <MarkdownBody html={html} className="card answer-body guide-body" />
      <div className="button-row guide-footer">
        {previous !== undefined && (
          <a className="button-link plain" href={addressOf(previous, null)}>
            <Icon name="back" />
            {previous.title}
          </a>
        )}
        {next !== undefined && (
          <a className="button-link plain" href={addressOf(next, null)}>
            {next.title}
            <Icon name="back" className="flip" />
          </a>
        )}
        <a className="button-link plain" href={githubFileUrl(page.path)} target="_blank" rel="noreferrer">
          <Icon name="external" />
          See it on GitHub
        </a>
      </div>
    </div>
  );
}

/**
 * The Guide section of Settings: the docs for people, with a page for each doc. Each link is an
 * address, so Back returns, and a link to a heading opens the doc at that heading.
 */
import type { ReactElement } from "react";
import { githubFileUrl, guideItem, guidePages, renderedGuide, type GuidePageId, type GuideSection } from "./guide.ts";
import { Icon } from "./icons.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { Card } from "./SettingsParts.tsx";
import { settingsHash } from "./settings-routes.ts";

function addressOf(page: GuidePageId, slug: string | null): string {
  return settingsHash({ section: "guide", item: guideItem(page, slug) });
}

/** The guide's home page: each doc with the headings of its parts. */
export function GuideHome(): ReactElement {
  return (
    <>
      {guidePages.map((page) => (
        <Card key={page.id} icon="book" title={page.title} description={page.summary}>
          <ol className="guide-contents" aria-label={`Parts of ${page.title}`}>
            {renderedGuide(page.id)
              .sections.filter((section) => section.level === 2)
              .map((section) => (
                <li key={section.slug}>
                  <a href={addressOf(page.id, section.slug)}>{section.title}</a>
                </li>
              ))}
          </ol>
          <div className="button-row">
            <a className="button-link" href={addressOf(page.id, null)}>
              Read the page
              <Icon name="back" className="flip" />
            </a>
          </div>
        </Card>
      ))}
    </>
  );
}

/** One doc: the list of its parts, the doc, and the way to the other docs. */
export function GuideDocument({ page }: { readonly page: GuidePageId }): ReactElement {
  const { html, sections } = renderedGuide(page);
  const index = guidePages.findIndex((each) => each.id === page);
  const previous = guidePages[index - 1];
  const next = guidePages[index + 1];
  const path = guidePages[index]?.path ?? "";
  const parts = sections.filter((section): section is GuideSection & { slug: string } => section.slug !== null);
  return (
    <>
      {parts.length > 0 && (
        <nav className="card guide-toc" aria-label="On this page">
          {/* Closed at first: on a phone, a long list would push the doc down. */}
          <details>
            <summary>On this page</summary>
            <ol>
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
          <a className="button-link plain" href={addressOf(previous.id, null)}>
            <Icon name="back" />
            {previous.title}
          </a>
        )}
        {next !== undefined && (
          <a className="button-link plain" href={addressOf(next.id, null)}>
            {next.title}
            <Icon name="back" className="flip" />
          </a>
        )}
        <a className="button-link plain guide-source" href={githubFileUrl(path)} target="_blank" rel="noreferrer">
          <Icon name="external" />
          See it on GitHub
        </a>
      </div>
    </>
  );
}

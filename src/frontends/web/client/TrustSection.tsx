/**
 * The trusted repositories page. A trusted clone runs its own hooks, settings and MCP servers in
 * project chats. Eva trusts her own GitHub account, the owners on the list, and the repositories
 * that the person allowed. A change applies to the next project chat.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type TrustOverview } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { withOwner, withoutOwner } from "./trusted-owners.ts";

export function TrustSection({ context }: { readonly context: SettingsContext }): ReactElement {
  const [trust, setTrust] = useState<TrustOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** One change at a time, so an older reply never overwrites a newer list. */
  const [busy, setBusy] = useState<Change | null>(null);
  const { notify } = context;

  const load = useCallback(() => {
    setLoadError(null);
    api
      .trust()
      .then(setTrust)
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, []);

  useEffect(load, [load]);

  const run = async (where: Change, change: () => Promise<TrustOverview | null>): Promise<boolean> => {
    setBusy(where);
    try {
      const changed = await change();
      if (changed !== null) setTrust(changed);
      return changed !== null;
    } catch (error) {
      notify(errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (trust === null) {
    return (
      <Card title="Trusted repositories">
        {loadError === null ? (
          <ProgressBar label="Reading the trusted repositories…" />
        ) : (
          <div className="callout" role="status">
            The trusted repositories did not load: {loadError} <button onClick={load}>Try again</button>
          </div>
        )}
      </Card>
    );
  }
  const parts = { trust, context, busy, run };
  return (
    <>
      <OwnAccountCard {...parts} />
      <OwnersCard {...parts} />
      <AnswersCard {...parts} />
    </>
  );
}

type Change = "owners" | "answers";

interface TrustCardProps {
  readonly trust: TrustOverview;
  readonly context: SettingsContext;
  /** The card whose change runs. Every card waits for it. */
  readonly busy: Change | null;
  /** Runs a change. The change gives the new overview, or null when it did not save. */
  readonly run: (where: Change, change: () => Promise<TrustOverview | null>) => Promise<boolean>;
}

function OwnAccountCard({ trust, context }: TrustCardProps): ReactElement {
  return (
    <Card
      item="own-account"
      title="Your GitHub account"
      description="Eva trusts the repositories of the account that she logs in to GitHub with."
    >
      {trust.githubAccount === null ? (
        <>
          <div className="field-hint">
            {trust.githubLoggedIn
              ? "Eva has a GitHub login, but she has not read its account yet. Press Test on the GitHub login card."
              : "Eva is not logged in to GitHub. She asks about each repository."}
          </div>
          <div className="button-row">
            <button onClick={() => context.navigate({ section: "connections", item: "github" })}>
              {trust.githubLoggedIn ? "Open the GitHub login" : "Log in to GitHub"}
            </button>
          </div>
        </>
      ) : (
        <ul className="device-list" aria-label="Your GitHub account">
          <li>
            <span className="device-icon">
              <Icon name="user" />
            </span>
            <span className="device-text">
              <b>{trust.githubAccount}</b>
              <span className="device-detail">A login to another account changes it.</span>
            </span>
            <span className="pill ok">Trusted by its login</span>
          </li>
        </ul>
      )}
    </Card>
  );
}

function OwnersCard({ trust, context, busy, run }: TrustCardProps): ReactElement {
  const [typed, setTyped] = useState("");

  // The page shows the list that it saved: a reload that fails must not hide a save that worked.
  const save = (owners: readonly string[]): Promise<boolean> =>
    run("owners", async () =>
      (await context.saveNow({ trust: { trustedRepositoryOwners: owners } })) ? { ...trust, owners } : null,
    );

  const add = async (): Promise<void> => {
    const result = withOwner(trust.owners, typed);
    if ("problem" in result) {
      context.notify(result.problem);
      return;
    }
    if (await save(result.owners)) setTyped("");
  };

  const remove = async (owner: string): Promise<void> => {
    if (!window.confirm(`Stop trusting the repositories of ${owner}? Eva then asks about each one.`)) return;
    await save(withoutOwner(trust.owners, owner));
  };

  return (
    <Card
      item="trusted-owners"
      title="Trusted repository owners"
      description="Eva trusts every repository of these GitHub accounts and organizations, with no question."
    >
      {trust.owners.length === 0 ? (
        <div className="field-hint">No owner yet.</div>
      ) : (
        <ul className="device-list" aria-label="Trusted repository owners">
          {trust.owners.map((owner) => (
            <li key={owner}>
              <span className="device-icon">
                <Icon name="user" />
              </span>
              <span className="device-text">
                <b>{owner}</b>
              </span>
              <button
                className="ghost"
                disabled={busy !== null}
                aria-label={`Remove ${owner}`}
                onClick={() => void remove(owner)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inline-form">
        <input
          aria-label="A GitHub account or organization"
          placeholder="example-org"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && busy === null) void add();
          }}
        />
        <button className="primary" disabled={busy !== null || typed.trim() === ""} onClick={() => void add()}>
          <Icon name="plus" />
          Add
        </button>
      </div>
      {busy === "owners" && <ProgressBar label="Saving…" />}
    </Card>
  );
}

function AnswersCard({ trust, context, busy, run }: TrustCardProps): ReactElement {
  const remove = async (url: string): Promise<void> => {
    if (!window.confirm(`Remove the answer for ${url}? Eva asks again in the next project chat.`)) return;
    if (await run("answers", () => api.forgetTrustAnswer(url))) {
      context.notify("Removed. Eva asks again in the next project chat.");
    }
  };

  return (
    <Card
      item="trust-answers"
      title="Saved trust answers"
      description="Your answers to “Trust this repository”. Remove one, and Eva asks again."
    >
      {trust.answers.length === 0 ? (
        <div className="field-hint">No saved answer yet.</div>
      ) : (
        <ul className="device-list trust-answers" aria-label="Saved trust answers">
          {trust.answers.map((answer) => (
            <li key={answer.url}>
              <span className="device-icon">
                <Icon name={answer.decision === "trusted" ? "check" : "x"} />
              </span>
              <span className="device-text">
                <b className="mono">{answer.url}</b>
                <span className="device-detail">{answer.decision === "trusted" ? "Trusted" : "Not trusted"}</span>
              </span>
              <button
                className="ghost"
                disabled={busy !== null}
                aria-label={`Remove the answer for ${answer.url}`}
                onClick={() => void remove(answer.url)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy === "answers" && <ProgressBar label="Removing…" />}
    </Card>
  );
}

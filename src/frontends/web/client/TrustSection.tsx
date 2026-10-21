/**
 * The trusted repositories page. A trusted clone runs its own hooks, settings and MCP servers in
 * project chats. Eva trusts her own GitHub account, the owners on the list, and the repositories
 * that the person allowed. A change applies to the next project chat.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type TrustOverview } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";
import { withOwner, withoutOwner } from "./trusted-owners.ts";

export function TrustSection({ context }: { readonly context: SettingsContext }): ReactElement {
  const [trust, setTrust] = useState<TrustOverview | null>(null);
  const { notify } = context;

  useEffect(() => {
    api
      .trust()
      .then(setTrust)
      .catch((error: unknown) => notify(errorText(error)));
  }, [notify]);

  return (
    <>
      <OwnAccountCard trust={trust} context={context} />
      <OwnersCard trust={trust} context={context} onChanged={setTrust} />
      <AnswersCard trust={trust} context={context} onChanged={setTrust} />
    </>
  );
}

interface TrustCardProps {
  readonly trust: TrustOverview | null;
  readonly context: SettingsContext;
}

function OwnAccountCard({ trust, context }: TrustCardProps): ReactElement {
  return (
    <Card
      item="own-account"
      title="Your GitHub account"
      description="Eva trusts the repositories of the account that she logs in to GitHub with."
    >
      {trust === null ? (
        <ProgressBar label="Reading the trusted accounts…" />
      ) : trust.githubAccount === null ? (
        <>
          <div className="field-hint">Eva is not logged in to GitHub. She asks about each repository.</div>
          <div className="button-row">
            <button onClick={() => context.navigate({ section: "connections", item: "github" })}>
              Log in to GitHub
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

function OwnersCard({
  trust,
  context,
  onChanged,
}: TrustCardProps & { readonly onChanged: (trust: TrustOverview) => void }): ReactElement {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  /** `saveNow` shows the note. A change applies to the next project chat, so it needs no restart. */
  const save = async (owners: readonly string[]): Promise<boolean> => {
    setBusy(true);
    try {
      if (!(await context.saveNow({ trust: { trustedRepositoryOwners: owners } }))) return false;
      onChanged(await api.trust());
      return true;
    } catch (error) {
      context.notify(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    if (trust === null) return;
    const result = withOwner(trust.owners, typed);
    if ("problem" in result) {
      context.notify(result.problem);
      return;
    }
    if (await save(result.owners)) setTyped("");
  };

  const remove = async (owner: string): Promise<void> => {
    if (trust === null) return;
    if (!window.confirm(`Stop trusting the repositories of ${owner}? Eva then asks about each one.`)) return;
    await save(withoutOwner(trust.owners, owner));
  };

  return (
    <Card
      item="trusted-owners"
      title="Trusted repository owners"
      description="Eva trusts every repository of these GitHub accounts and organizations, with no question."
    >
      {trust === null ? (
        <ProgressBar label="Reading the trusted owners…" />
      ) : (
        <>
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
                    disabled={busy}
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
                if (event.key === "Enter") void add();
              }}
            />
            <button className="primary" disabled={busy || typed.trim() === ""} onClick={() => void add()}>
              <Icon name="plus" />
              Add
            </button>
          </div>
          {busy && <ProgressBar label="Saving…" />}
        </>
      )}
    </Card>
  );
}

function AnswersCard({
  trust,
  context,
  onChanged,
}: TrustCardProps & { readonly onChanged: (trust: TrustOverview) => void }): ReactElement {
  const remove = async (url: string): Promise<void> => {
    if (!window.confirm(`Remove the answer for ${url}? Eva asks again in the next project chat.`)) return;
    try {
      onChanged(await api.forgetTrustAnswer(url));
      context.notify("Removed. Eva asks again in the next project chat.");
    } catch (error) {
      context.notify(errorText(error));
    }
  };

  return (
    <Card
      item="trust-answers"
      title="Saved trust answers"
      description="Your answers to “Trust this repository”. Remove one, and Eva asks again."
    >
      {trust === null ? (
        <ProgressBar label="Reading the saved answers…" />
      ) : trust.answers.length === 0 ? (
        <div className="field-hint">No saved answer yet.</div>
      ) : (
        <ul className="device-list" aria-label="Saved trust answers">
          {trust.answers.map((answer) => (
            <li key={answer.url}>
              <span className="device-icon">
                <Icon name={answer.decision === "trusted" ? "check" : "x"} />
              </span>
              <span className="device-text">
                <b className="mono">{answer.url}</b>
              </span>
              <span className={answer.decision === "trusted" ? "pill ok" : "pill idle"}>
                {answer.decision === "trusted" ? "Trusted" : "Not trusted"}
              </span>
              <button
                className="ghost"
                aria-label={`Remove the answer for ${answer.url}`}
                onClick={() => void remove(answer.url)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

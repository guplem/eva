/**
 * What Eva may do: for each engine and each kind of chat, what runs with no question, what Eva
 * asks first and what never runs. The person's own rules show apart. The engines write the words,
 * next to the code that enforces them. The card only reads.
 */
import { useCallback, useEffect, useId, useState, type ReactElement } from "react";
import { api, type PermissionsOverview } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import {
  chatTitles,
  modeWaitsForRestart,
  personRulesHint,
  rulesPlaceWords,
  rulesStateWords,
} from "./permission-words.ts";
import { Card, errorText } from "./SettingsParts.tsx";
import type { ChatPermissions, PersonPermissionRules } from "../../../shared/permissions.ts";

type EngineEntry = PermissionsOverview[number];

const engineTitles: Readonly<Record<EngineEntry["engine"], string>> = { "claude-code": "Claude Code", pi: "pi" };

/** `chosenClaudeMode` is the saved setting and its words, which can differ from the running mode until a restart. */
export function PermissionsCard({
  chosenClaudeMode,
}: {
  readonly chosenClaudeMode: { readonly value: string; readonly words: string };
}): ReactElement {
  const [overview, setOverview] = useState<PermissionsOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .permissions()
      .then(setOverview)
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, []);

  useEffect(load, [load]);

  return (
    <Card
      item="permissions"
      icon="shield"
      title="What Eva may do"
      description="For each engine: what runs with no question, what Eva asks you first, and what never runs. Your own rules show apart."
    >
      {overview === null ? (
        loadError === null ? (
          <ProgressBar label="Reading the permissions…" />
        ) : (
          <div className="callout" role="status">
            The permissions did not load: {loadError} <button onClick={load}>Try again</button>
          </div>
        )
      ) : (
        <>
          {overview.map((entry) => (
            <EnginePermissionsBox key={entry.engine} entry={entry} chosenClaudeMode={chosenClaudeMode} />
          ))}
          <p className="field-hint">
            Eva&apos;s small AI calls, such as a chat name, get no tools, so they can do nothing.
          </p>
        </>
      )}
    </Card>
  );
}

function EnginePermissionsBox({
  entry,
  chosenClaudeMode,
}: {
  readonly entry: EngineEntry;
  readonly chosenClaudeMode: { readonly value: string; readonly words: string };
}): ReactElement {
  const title = engineTitles[entry.engine];
  return (
    <details className="rules-box built-in permissions-box">
      <summary className="field-label">{entry.mode === null ? title : `${title}, ${entry.mode.words} mode`}</summary>
      {entry.engine === "claude-code" && modeWaitsForRestart(entry.mode, chosenClaudeMode.value) && (
        <div className="callout">
          You chose {chosenClaudeMode.words}. Eva uses it after a restart. Until then, these lists show{" "}
          {entry.mode?.words}.
        </div>
      )}
      {entry.chats.map((chat) => (
        <ChatPermissionsView key={chat.chat} chat={chat} />
      ))}
      <h3>Your own rules</h3>
      {entry.personRules === null ? (
        <p className="field-hint">{title} has no permission rules of its own. Only the lists above apply.</p>
      ) : (
        <>
          <p className="field-hint">{personRulesHint}</p>
          {entry.personRules.map((rules) => (
            <PersonRulesView key={rules.place} rules={rules} />
          ))}
        </>
      )}
    </details>
  );
}

function ChatPermissionsView({ chat }: { readonly chat: ChatPermissions }): ReactElement {
  const headingId = useId();
  return (
    <section className="permission-chat" aria-labelledby={headingId}>
      <h3 id={headingId}>{chatTitles[chat.chat]}</h3>
      {chat.note !== null && <p className="field-hint">{chat.note}</p>}
      <PermissionList icon="check" title="Runs with no question" items={chat.runs} />
      <PermissionList icon="alert" title="Asks you first" items={chat.asks} />
      <PermissionList icon="lock" title="Never runs" items={chat.blocks} />
    </section>
  );
}

function PersonRulesView({ rules }: { readonly rules: PersonPermissionRules }): ReactElement {
  const state = rulesStateWords(rules);
  return (
    <section className="permission-chat">
      <p className="field-label">{rulesPlaceWords(rules.place)}</p>
      <code className="permission-file">{rules.file}</code>
      {state === null ? (
        <>
          <PermissionList icon="check" title="Allow" items={rules.allow} code />
          <PermissionList icon="alert" title="Ask" items={rules.ask} code />
          <PermissionList icon="lock" title="Deny" items={rules.deny} code />
        </>
      ) : (
        <p className="field-hint">{state}</p>
      )}
    </section>
  );
}

/** One group, such as "Asks you first". An empty group says so, so the person never guesses. */
function PermissionList({
  icon,
  title,
  items,
  code = false,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly items: readonly string[];
  /** The person's rules are Claude Code's own syntax, so they show as code. */
  readonly code?: boolean;
}): ReactElement {
  return (
    <div className="permission-group">
      <p className="permission-group-title">
        <Icon name={icon} />
        {title}
      </p>
      {items.length === 0 ? (
        <p className="field-hint">Nothing.</p>
      ) : (
        <ul>
          {/* A person's file can list one rule twice. */}
          {items.map((item, index) => (
            <li key={`${String(index)}-${item}`}>{code ? <code>{item}</code> : item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

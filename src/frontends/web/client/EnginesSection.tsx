/** The AI engines page: the engine for new chats, then Claude Code and pi, each with numbered login steps. */
import { useState, type ReactElement } from "react";
import type { PublicSettings } from "./api.ts";
import {
  Card,
  CheckRow,
  CommandLine,
  SecretField,
  SelectField,
  Steps,
  StatusPill,
  type SettingsContext,
} from "./SettingsParts.tsx";

type EngineName = PublicSettings["config"]["engines"]["default"];
type ModelAlias = PublicSettings["config"]["engines"]["claudeCode"]["defaultModel"];

const engineChoices: readonly { value: EngineName; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "pi", label: "pi" },
];

const modelChoices: readonly { value: ModelAlias; label: string }[] = [
  { value: "default", label: "Claude Code's default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

export function EnginesSection({ context }: { readonly context: SettingsContext }): ReactElement {
  return (
    <>
      <DefaultEngineCard context={context} />
      <ClaudeCodeCard context={context} />
      <PiCard context={context} />
    </>
  );
}

function found(context: SettingsContext, engine: EngineName): boolean {
  return context.setup === null || context.setup.engines.some((name) => name === engine);
}

function DefaultEngineCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const config = context.settings.config;
  return (
    <Card
      item="default-engine"
      title="Engine for new chats"
      description="The engine is the AI program that answers you. One with a login is enough."
    >
      <SelectField
        label="Engine for new chats"
        value={config.engines.default}
        choices={engineChoices}
        onChange={(value) => void context.saveNow({ engines: { default: value } })}
      />
      <SelectField
        label="Claude Code model"
        value={config.engines.claudeCode.defaultModel}
        choices={modelChoices}
        onChange={(value) => void context.saveNow({ engines: { claudeCode: { defaultModel: value } } })}
      />
    </Card>
  );
}

/** A Claude subscription logs in with a token from `claude setup-token`, which needs a browser. */
export function ClaudeCodeCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const saved = context.settings.secretsSet.claudeOauthToken;
  const installed = found(context, "claude-code");
  // Without a token, Claude Code is the way to finish a missing engine step, so it needs the person too.
  const engineMissing =
    context.setup?.progress.some((step) => step.key === "engine" && step.state === "missing") ?? false;
  return (
    <Card
      item="claude-code"
      title="Claude Code"
      description="Use your Claude subscription. Eva never uses an API key."
      aside={<StatusPill state={!installed || (!saved && engineMissing) ? "missing" : saved ? "done" : "optional"} />}
    >
      {!installed && (
        <div className="callout danger">
          Eva did not find the claude program on this machine. Run <code>eva setup</code> on Eva&apos;s computer to
          install it.
        </div>
      )}
      <Steps>
        <li>
          On any computer with a browser, open a terminal. Copy this command, paste it there and press Enter:
          <CommandLine command="claude setup-token" />
        </li>
        <li>A browser page opens. Log in with your Claude account, and allow the access.</li>
        <li>The terminal shows a long token. Copy it, and paste it here:</li>
      </Steps>
      <SecretField
        name="claudeOauthToken"
        label="Claude Code token"
        saved={saved}
        help="It starts with sk-ant-oat. It stays on this machine, never in your vault."
        check="claude-code"
        onChanged={context.noteAndReload}
      />
    </Card>
  );
}

function PiCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const initial = context.settings.config.engines.pi.models.default ?? "";
  const [model, setModel] = useState(initial);
  const installed = found(context, "pi");
  const save = async (): Promise<void> => {
    const trimmed = model.trim();
    await context.saveNow({ engines: { pi: { models: { default: trimmed === "" ? null : trimmed } } } });
  };
  return (
    <Card item="pi" title="pi" description="pi runs models of other providers, such as OpenAI. It is optional.">
      {installed ? (
        <Steps>
          <li>
            On Eva&apos;s computer, open a terminal and run:
            <CommandLine command="pi" />
          </li>
          <li>
            In pi, type <code>/login</code> and follow its steps.
          </li>
          <li>Come back here and press Test.</li>
        </Steps>
      ) : (
        <div className="callout">Eva did not find the pi program on this machine.</div>
      )}
      <div className="inline-form">
        <label className="field grow">
          <span className="field-label">pi model, such as openai/gpt-5 (empty: pi&apos;s own default)</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <button className="primary" disabled={model === initial} onClick={() => void save()}>
          Save the model
        </button>
      </div>
      <CheckRow name="pi" label="Test pi" />
    </Card>
  );
}

/**
 * The design reference: every colour token, each shared component with its class names, and a
 * map of Eva's layers. It draws the real parts with the real stylesheet, so it shows what the page
 * shows. The Appearance card on top changes the seed and the theme, and every sample follows.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  architectureLayers,
  colourGroups,
  componentSamples,
  iconUses,
  messageFlow,
  visorSizes,
  type ComponentId,
} from "./design-reference.ts";
import { Icon, iconNames } from "./icons.tsx";
import { FactsSkeleton, ListSkeleton, ProgressBar } from "./Loading.tsx";
import { AppearanceCard } from "./PersonalizeSection.tsx";
import { Card, ChoiceChips, CommandLine, StatusIcon, StatusPill, Steps } from "./SettingsParts.tsx";
import { Toast } from "./Toast.tsx";
import { faces } from "./visor-faces.ts";
import { Visor } from "./Visor.tsx";

export function DesignReference(): ReactElement {
  return (
    <>
      <AppearanceCard />
      <Card
        title="Colours"
        description="Every colour is a token in styles.css. Write var(--token) in a rule, never a raw colour."
      >
        {colourGroups.map((group) => (
          <section key={group.title} className="design-group" aria-label={group.title}>
            <h3>{group.title}</h3>
            <ul className="design-swatches">
              {group.tokens.map((token) => (
                <li key={token.name} className="design-swatch">
                  <span className="design-swatch-colour" style={{ background: `var(${token.name})` }} />
                  <span className="design-swatch-text">
                    <code>{token.name}</code>
                    <span className="field-hint">{token.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>
      <Card title="Components" description="The shared parts of the page. Use one of these before you add a new class.">
        {componentSamples.map((sample) => (
          <section key={sample.id} className="design-sample" aria-label={sample.title}>
            <div className="design-sample-head">
              <h3>{sample.title}</h3>
              <span className="field-hint">{sample.use}</span>
              <span className="design-names">
                {sample.part !== undefined && <code>&lt;{sample.part}&gt;</code>}
                {sample.classes.map((name) => (
                  <code key={name}>.{name}</code>
                ))}
              </span>
            </div>
            <div className="design-sample-body">
              <Sample id={sample.id} />
            </div>
          </section>
        ))}
      </Card>
      <Card title="Architecture" description="Each layer imports only the layers below it. bun run arch checks this.">
        <ol className="design-layers" aria-label="Layers">
          {architectureLayers.map((layer) => (
            <li key={layer.path}>
              <span className="design-layer-title">
                <b>{layer.title}</b>
                <code>{layer.path}</code>
              </span>
              <span className="field-hint">{layer.role}</span>
            </li>
          ))}
        </ol>
        <h3>The path of a message</h3>
        <ol className="design-flow" aria-label="The path of a message">
          {messageFlow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>
    </>
  );
}

const noop = (): void => undefined;

function Sample({ id }: { readonly id: ComponentId }): ReactElement {
  switch (id) {
    case "buttons":
      return (
        <div className="button-row">
          <button className="primary">Primary</button>
          <button>Default</button>
          <button className="soft">Soft</button>
          <button className="outline">Outline</button>
          <button className="ghost">Ghost</button>
          <button className="danger">Danger</button>
          <button className="primary large">Large</button>
          <button className="small">Small</button>
          <button disabled>Disabled</button>
        </div>
      );
    case "card":
      return (
        <Card icon="folder" title="A card title" description="A line that says what the card is for.">
          <span>The body of the card.</span>
        </Card>
      );
    case "pills":
      return (
        <div className="button-row">
          <StatusPill state="done" />
          <StatusPill state="missing" />
          <StatusPill state="optional" />
          <span className="pill dot ok">Online</span>
          <span className="pill dot warn">Waiting</span>
          <span className="pill dot failed">Stopped</span>
          <span className="pill dot idle">Idle</span>
        </div>
      );
    case "status-icons":
      return (
        <div className="button-row">
          <StatusIcon state="done" />
          <StatusIcon state="missing" />
          <StatusIcon state="failed" />
          <StatusIcon state="optional" />
          <StatusIcon state="done" size="large" />
        </div>
      );
    case "callouts":
      return (
        <div className="design-stack">
          <div className="callout">A plain note.</div>
          <div className="callout success">It worked.</div>
          <div className="callout warning">Take care with this.</div>
          <div className="callout danger">You must act.</div>
        </div>
      );
    case "fields":
      return (
        <div className="design-stack">
          <label className="field">
            <span className="field-label">A label</span>
            <input placeholder="A placeholder" />
            <span className="field-hint">A hint under the field.</span>
          </label>
          <div className="inline-form">
            <input aria-label="An inline field" placeholder="An inline field" />
            <button className="primary">Save</button>
          </div>
        </div>
      );
    case "choice-chips":
      return (
        <ChoiceChips
          label="A choice"
          value="one"
          choices={[
            { value: "one", label: "One", icon: "sun" },
            { value: "two", label: "Two", icon: "moon" },
            { value: "three", label: "Three" },
          ]}
          onChange={noop}
        />
      );
    case "mode-chips":
      return (
        <div className="button-row">
          <span className="mode-chip">
            <Icon name="term" />
            Project
          </span>
          <span className="mode-chip soft">
            <Icon name="chat" />
            Assistant
          </span>
        </div>
      );
    case "command-line":
      return <CommandLine command="bun run check" />;
    case "guide-steps":
      return (
        <Steps>
          <li>Open the app.</li>
          <li>Press the button.</li>
          <li>Copy the code.</li>
        </Steps>
      );
    case "progress":
      return (
        <div className="design-stack">
          <ProgressBar label="Installing 1.4.0…" share={0.42} />
          <ProgressBar label="Looking for a new version…" />
        </div>
      );
    case "tooltip":
      return (
        <div className="button-row">
          <button className="icon-button" aria-label="More actions" data-tooltip="More actions">
            <Icon name="more" />
          </button>
          <span data-tooltip="A hint can also sit on plain text.">Rest the pointer here</span>
        </div>
      );
    case "toasts":
      return <ToastSamples />;
    case "skeletons":
      return (
        <div className="design-stack">
          <FactsSkeleton label="A sample of a facts list" rows={3} />
          <ListSkeleton label="A sample of a list" rows={2} />
        </div>
      );
    case "section-card":
      return (
        <button className="section-card">
          <span className="section-icon">
            <Icon name="gear" />
          </span>
          <span className="section-card-text">
            <span className="section-card-title">A page</span>
            <span className="field-hint">One line about the page.</span>
          </span>
          <Icon name="back" className="chevron flip" />
        </button>
      );
    case "visor":
      return (
        <div className="design-stack">
          <ul className="design-visor-sizes">
            {visorSizes.map((entry) => (
              <li key={entry.size}>
                <Visor size={entry.size} />
                <code>
                  {entry.size} px{entry.shell ? ", shell" : ""}
                </code>
                <span className="field-hint">{entry.use}</span>
              </li>
            ))}
          </ul>
          <ul className="design-icons">
            {faces.map((face) => (
              <li key={face}>
                <Visor size={36} face={face} />
                <code>{face}</code>
              </li>
            ))}
          </ul>
        </div>
      );
    case "icons":
      return (
        <ul className="design-icons">
          {iconNames.map((name) => (
            <li key={name}>
              <Icon name={name} />
              <code>{name}</code>
              <span className="field-hint">{iconUses[name]}</span>
            </li>
          ))}
        </ul>
      );
  }
}

type ToastSampleId = "note" | "long" | "error" | "question" | "wait";

const toastSampleLabels: Readonly<Record<ToastSampleId, string>> = {
  note: "A note",
  long: "A long note",
  error: "An error with a fix",
  question: "A question",
  wait: "A wait",
};

/** The real toasts, shown one at a time, so a person tests them on a phone too. */
function ToastSamples(): ReactElement {
  const [shown, setShown] = useState<ToastSampleId | null>(null);
  // Each press restarts the ring, also for the toast that shows now.
  const [presses, setPresses] = useState(0);
  const close = (): void => setShown(null);
  useEffect(() => {
    if (shown !== "wait") return undefined;
    // A wait has no close button: its owner removes it when the work ends.
    const timer = setTimeout(close, 4_000);
    return () => clearTimeout(timer);
  }, [shown, presses]);
  return (
    <div className="button-row">
      {(Object.keys(toastSampleLabels) as ToastSampleId[]).map((id) => (
        <button
          key={id}
          onClick={() => {
            setShown(id);
            setPresses((count) => count + 1);
          }}
        >
          {toastSampleLabels[id]}
        </button>
      ))}
      {shown === "note" && <Toast key={presses} message="Saved." onClose={close} />}
      {shown === "long" && (
        <Toast
          key={presses}
          message="Saved. Eva uses the new engine for the chats that start from now on. The chats that run keep their engine."
          onClose={close}
        />
      )}
      {shown === "error" && (
        <Toast
          key={presses}
          message="The GitHub login expired. Log in again to push your changes."
          role="alert"
          onClose={close}
          actions={
            <button className="primary" onClick={close}>
              Open Settings
            </button>
          }
        />
      )}
      {shown === "question" && (
        <Toast
          key={presses}
          message='"Plan the trip" is running. A restart stops it. Restart Eva now?'
          role="alertdialog"
          label="Restart Eva"
          closeLabel="Close the question"
          onClose={close}
          actions={
            <>
              <button onClick={close}>Cancel</button>
              <button className="primary" onClick={close}>
                Yes, restart
              </button>
            </>
          }
        />
      )}
      {shown === "wait" && (
        <Toast key={presses} message="Eva restarts…" role={null}>
          <ProgressBar label="Eva restarts…" />
        </Toast>
      )}
    </div>
  );
}

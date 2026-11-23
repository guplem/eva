/**
 * The home page that Eva's face opens (#761): the greeting, the widgets, and a message box that starts a new chat.
 * It is a page of its own, apart from the New chat page of Chats (#1037).
 */
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { ChatBlocker, SessionRecord } from "./api.ts";
import { Icon } from "./icons.tsx";
import { MenuButton } from "./Menu.tsx";
import { menuDestinations, navChoice, onNavChoiceChange } from "./nav-choice.ts";
import type { Destination } from "./navigation.ts";
import { NewChatDraft } from "./NewChatDraft.tsx";
import { useWidgetFrames } from "./WidgetGrid.tsx";

interface HomePageProps {
  readonly blocker: ChatBlocker | null;
  readonly voiceNotes: boolean;
  readonly isPhone: boolean;
  /** The bell and, on a phone, the gear. */
  readonly buttons: ReactNode;
  readonly onOpen: (destination: Destination) => void;
  /** Opens the chat that the first message made. */
  readonly onStarted: (chat: SessionRecord) => Promise<void>;
}

export function HomePage({ blocker, voiceNotes, isPhone, buttons, onOpen, onStarted }: HomePageProps): ReactElement {
  // The setup step and the greeting both show the widgets, so the page asks for them once.
  const widgets = useWidgetFrames();
  return (
    <main className="main">
      <NewChatDraft
        page={{
          kind: "home",
          widgets,
          // A computer's rail shows every page by default, so only a phone needs the menu (#1037).
          menu: isPhone ? <PagesMenu onOpen={onOpen} /> : null,
          buttons,
        }}
        blocker={blocker}
        voiceNotes={voiceNotes}
        onStarted={onStarted}
      />
    </main>
  );
}

/** The ☰ menu of a phone's home page: every page, also the pages that the tab bar hides, such as Schedules. */
function PagesMenu({ onOpen }: { readonly onOpen: (destination: Destination) => void }): ReactElement {
  const choice = useSyncExternalStore(onNavChoiceChange, navChoice);
  const items = menuDestinations(choice).map((destination) => ({
    label: destination.label,
    icon: destination.icon,
    onChoose: () => onOpen(destination.id),
  }));
  return (
    <MenuButton items={items} label="Pages" className="icon-button pages-menu-button" name="All pages" fromStart>
      <Icon name="menu" />
    </MenuButton>
  );
}

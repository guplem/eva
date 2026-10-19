# Plan: the app shell (issue #167)

Replace the top bar and the Mode switch with the EVE app shell. A computer gets a nav rail. A phone gets a bottom tab bar.

## Motivation

The top bar mixes two modes, a menu and Settings. Schedules hides behind an icon in the chat list. The back button does nothing, and a reload always opens Assistant mode. The EVE design (`docs/design/eve/README.md`, section Layout) gives four equal destinations: Chats, Projects, Schedules and Settings. Each one gets an address, so the back button and a reload work. This shell comes before the page issues (#169 to #178), which fill the columns.

## What changes

- `client/navigation.ts` (new): the destinations, and the conversion between a destination and its address. Unit tested.
- `client/App.tsx`: the screen follows the address. One `nav` element with the four destinations, the visor and the online dot. Badges for approvals and for setup.
- `client/AssistantView.tsx` and `client/ProjectView.tsx`: the menu button moves into the main header, because a phone has no top bar now. The Schedules entry leaves the chat list.
- `styles.css`: the rail, the tab bar, the 300 px list column, the main gradient. The top bar and Mode switch styles go.
- `test/e2e/web-ui.spec.ts`: the new names.

## Gaps and decisions

1. **One nav element or two.** Decision: one `nav` named "Main", styled as a rail on a computer and as a tab bar on a phone. Only one copy is in the accessibility tree, so each name is unique for the tests. Each destination stays a `button`, as the old Settings button was, so the tests keep `getByRole("button", { name: "Settings" })`. The selected one has `aria-current="page"`. The rail hides the text label but keeps it for screen readers and as a tooltip.
2. **The addresses.** Decision: `#/chats`, `#/projects`, `#/schedules` and `#/settings`. Any address that starts with `#/settings/` opens Settings too, so the section addresses of PR #166 fit. An empty or unknown address opens Chats. `#/chat/<id>` stays. Once the linked chat opens, the address becomes the address of its destination (`#/chats` or `#/projects`), with `replaceState`, so the back button skips the used link.
3. **A click on a destination.** Decision: it sets `location.hash`. This adds a history entry, so the back button goes to the previous destination. A click on the current destination adds no entry.
4. **The phone header.** The design has "back or menu, title and subtitle, more". Decision: the menu button ("Show the list") moves into the main header of Chats and Projects, before the title. The empty states get a small header with the menu button and the destination name, so the list is always in reach. The existing Chat info button is the "more" action. A back button is for sub-pages, which do not exist yet: the page issues add them (#172, #174).
5. **The list on a phone.** The issue says "no drawer for the main navigation". Decision: the four destinations are in the tab bar. The chat list and the project list stay in their drawer, behind the menu button, as in the reference chat capture. #169 and #174 redesign the lists.
6. **Schedules in the chat list.** Decision: remove the "Schedules" heading, its clock button and its hint chip. The rail and the tab bar open Schedules now. The clock icon on a scheduled chat stays.
7. **Badges.** Decision: the Chats badge counts every waiting approval, of any chat, as the approval dialog shows them all. The Settings badge shows the number of setup steps left. Its text reads "N to set up" for a screen reader, so the old test text still matches. Both use `--warn`.
8. **The online dot.** "The hub answers" means that the page has its live connection to Eva. Decision: a green dot when the socket is open, a `--warn` dot when it is not. Its label says "Eva is online" or "Eva does not answer". The phone has no dot: the "Reconnecting…" banner says the same.
9. **The visor.** Decision: the rail shows the visor at the top, with the idle face when online and the offline face when not, as the top bar did. The tab bar has no visor, as in the reference.
10. **The inspector.** Decision: the existing chat details panel stays the fourth column. Its look is #172.
11. **The banners.** Decision: the problem banner and the "Reconnecting…" banner stay at the top of the content column, next to the rail. #179 restyles them.
12. **Safe areas.** Decision: the content column keeps the top inset, and the tab bar gets the bottom inset, so nothing hides under a notch or a home bar.

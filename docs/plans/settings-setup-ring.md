# Settings: the setup ring, chips and the restart

Issue #176. PR #166 built most of it: sections, a page per setup step, and a save per section.
This plan covers what stays open.

## Why

The owner wants Settings to look like the "Setup and appearance" capture in `docs/design/eve/reference.html`.
A person must see at once how much setup is left. A failed test must not look like a step that is done.
A restart must tell the person which chats it stops, in the page, also on a phone.

## Work

1. **Setup ring.** Show a ring with "done/total" and "Setup: N steps left". It replaces the coloured bar on the Settings home page and on the Setup page.
2. **Failed mark.** A step whose last Test failed shows its own round mark: an `x` on `--bad`, and the word "Failed".
3. **Chips.** The theme (Light, Dark, System) and the density (Comfortable, Compact) are chips. Each chip is a button with `aria-pressed`, and it saves at once.
4. **Restart Eva in the page header.** The button opens an in-page confirmation. It names the running chats. The Updates card and the restart callout open the same confirmation.

## Gaps and decisions

- **What the ring counts.** The capture shows "4/6" with one step left and two optional steps. Decision: the number is the done steps over all steps. "Left" counts the steps that need the person.
- **Which mark wins: done or failed.** Decision: a failed last test wins. The step is set up, but it does not work now, so the person must act.
- **Where the running chat names come from.** Decision: `api.status()` gives the busy ids, and `api.sessions()` gives their titles. No new API.
- **Separate Telegram and Google sections.** The capture lists them apart, but PR #166 grouped them under Connections on purpose. Decision: keep Connections. The issue says "if the reference needs them", and the setup steps already give each one its own page.
- **The `.chip` class.** It already styles a chat element. Decision: add a new `choice-chip` class.

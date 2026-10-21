# Plan: where each setting lives (issue #310)

## Goal

The Settings home page ends with a card that names the vault settings and the machine settings in one paragraph. Its "Log out" button does not say what it ends.

## Changes

1. Add `settingPlaces` to `client/settings-routes.ts`: each row has a title, a home (`vault`, `machine` or `browser`), the vault keys it covers, and the card it links to.
2. Add a test that every key of `sharedSettingKeys` shows in a vault row, and that every link names a known search entry.
3. Replace the paragraph with one line and a "See where each setting lives" button. The button opens the shared `Dialog` with one list for each home.
4. Extract the search result row into a shared `SettingLink`. Use it in the search results and in the dialog.
5. Move Log out to the Devices card as "Log out of this browser".

## Gaps and decisions

- **Where does Log out go?** Decision: the Devices card in Access. It lists the browser logins, and it already has "Log out every device". The home page keeps no account button, because Eva has no account.
- **A setting with no page,** such as the voice language or the trusted repository owners. Decision: list it without a link, with its setting key, so the list stays complete.
- **A card with parts in two homes,** such as Claude Code (model in the vault, token on the machine). Decision: one row for each part, both link to the same card.
- **"Filter by the search".** Decision: a row opens its card the same way as a search result: the page scrolls to the card and shows it for a moment.

# Files page as columns, with an editable preview (issue 308)

## Goal

On a wide screen, the Files page shows each open folder as a column, and the open file as a preview at the right. The preview can grow to fill the page. The person can edit a text file and save it in the vault.

## Decisions

- **One view for both sizes.** The page renders a column for each folder on the path, then the preview. On a narrow screen, CSS shows only the last one, so the phone keeps today's view and the crumbs.
- **The address stays the only state of the path.** The page reads each folder on the path through `GET /api/files`, and keeps the answers in a cache by path.
- **A save names the version that it read**, as the project file editor does. The core answers `file_changed` when the file changed meanwhile.
- **A file with a redacted secret is read only.** The shown text holds the redaction mark, so a save would write the mark over the secret. The core answers `file_read_only`, and the page shows no Edit button.
- **A save only replaces an existing text file.** It never creates a file, and it keeps the line endings and byte order mark of the file on disk (`matchFileStyle`).
- **The vault sync needs no new code.** The idle sweep commits every change in the vault.
- **The formatted view:** Markdown as today, JSON indented, and code with comments, strings, numbers and keywords in their own colours. The editor shows plain text.
- **Large mode** hides the folder columns. It is a page state, not part of the address.

## Gaps

None left open. The issue lists the assumptions.

# Plan: widget updates and the clone preview (#693)

## Goal

Eva keeps each installed widget up to date with `main` of its repository. An update with no new permission installs by itself. Any other update waits for the person. A widget project also gets a preview of each clone, with example data or the person's data.

## Parts

1. **Compare permissions** (`src/core/widgets/widget-changes.ts`, pure). Compare a new manifest with the approved record. A permission is each folder or file input with its access, type and file pattern, the location, each host, the prompt line, and the text of each written schema. A read-only fallback of #692 stays read only and is no new permission.
2. **Wait reasons.** A manifest that fails, a newer contract, a missing entry page, a required input with no value, a value that no longer fits, and a format conflict of a write. Each reason is a sentence.
3. **The light check** (`WidgetCopies.newestCommit`): `git ls-remote <remote> HEAD`. It downloads no code.
4. **The update state** (`state/widget-updates.json`, machine): for each widget, the time of the last check, the waiting update (commit, new permissions, reasons, notes) and the refused commit.
5. **The check** (`Widgets.checkUpdates`): it runs in `Eva.backgroundTick` on each computer. The person's own widgets (repositories of widget projects) are due after `widgets.checkIntervalMinutes`. Every other widget is due after one day. "Check for updates" checks every widget at once.
6. **The install.** Fetch the new commit with no checkout, check it, then check it out whole. Pause the file answers of that widget while git works. Write the new commit in the record after the files are in place. The tokens of the old commit stop, so the grid reloads the widget.
7. **The notice.** A waiting update is an open problem `widget_update:<owner>/<name>:<commit>`, so it reaches the phone by Telegram and push, and the notification center. A computer that is not the hub reports it in its machine report, and the hub relays it with the computer's name. The notice lists the new permissions, the reasons and the release notes since the installed commit, or the commit subjects (GitHub API through the `GithubRequest` seam).
8. **Approve or refuse.** The settings row shows the waiting update. "Review the update" opens the activation dialog, which now lists what is new. "Keep this version" refuses the commit. Eva asks again only for a newer commit.
9. **The setting** `widgets.checkIntervalMinutes`: vault, shared and live, 30 by default, 5 at least. A card "Widget updates" in Personalize, with the "Check for updates" button and a search entry.
10. **The preview** (`src/core/widgets/widget-previews.ts`). On a widget project, each clone's widget repository gets "Preview". The preview serves the clone folder as it is, from a token path, with the same frame, policy and path checks. It never serves `..`, a link, a hidden name or a file that git ignores.
    - "Example data" (the default): `config.json`, `data/` and `eva/location.json` (from `example/location.json`) come from the clone's mock files. A write fails, so the widget shows its demo note.
    - "My data": the contract paths answer from the vault. A widget that is set up uses its values and its approved record, and asks only for what the clone adds. A widget that is not set up asks for every permission. The preview's grant lives in `state/widget-previews.json`, by clone folder, and goes when the clone goes. It never changes the approved record or `.eva/widgets.json`.

## Gaps and decisions

- **Setting key name.** `widgets.checkIntervalMinutes`, like `sync.pullIntervalMinutes`. Choices from 5 minutes to 1 day.
- **Release notes source.** GitHub REST: `compare/<old>...<new>` for the subjects and the date of the old commit, and `releases` published after it. A failure gives no notes; the notice still names the permissions.
- **Own hosts in the background.** A host is new unless the record has it, so a background check needs no host list of Eva's own. The review of the update checks each host again.
- **Example data hosts.** The example mode allows the clone manifest's hosts that pass the host check: it has no person data to send, and a weather widget shows nothing without its host.
- **A waiting update that a newer commit replaces.** The old notice goes quietly, and the newer commit gets one notice.
- **Approve on the hub for another computer.** The relayed notice names the computer and says to approve there. A link to that computer's page is out of scope.

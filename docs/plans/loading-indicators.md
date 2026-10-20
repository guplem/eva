# Plan: one standard loading indicator

Issue: #249.

## Why

Each wait on the web page is its own sentence, such as "Installing 1.4.0…". A long wait then looks stuck. The owner wants one standard: a progress bar inside a card, and a shimmer skeleton for content that fills a large area. The owner also wants a clear rule in `AGENTS.md`: reuse components, and keep patterns consistent.

## Parts

- `ProgressBar`: a pill track with a fill.
  - Known share: the fill grows to the share, and a label shows the percentage.
  - Unknown share: lines run across the track.
  - A short text says what Eva does, so the state never relies on the motion alone.
- `Skeleton` shapes: grey rounded blocks with a shimmer that moves across them. Each skeleton copies the layout of the content that replaces it.

## Gaps

1. Where do the parts live, and what are their names?
2. Can the Eva update report a real share of its work?
3. Which waits get a bar, and which get a skeleton?
4. Which tokens and motion match the EVE design?
5. What does reduced motion show?
6. Which roles and names serve screen readers and the end-to-end tests?
7. How does the chat list know that it has not read the chats yet?
8. Where do the rules go: the root `AGENTS.md`, the web `AGENTS.md`, the EVE guide, the design reference page?

## Decisions

1. **Parts.** `client/Loading.tsx` holds `ProgressBar` and the skeletons. `loading.css` holds their style, linked in `index.html` so the executable bundles it. Visor.tsx and icons.tsx set the one-part-per-file precedent. The share math lives in `client/progress.ts`, so a unit test reaches it.
2. **A real share for the Eva update.** Yes, for the executable download only.
   - `UpdateChannel.apply(version, onDownload)` reports `{ receivedBytes, totalBytes }`. The download reads the body as a stream.
   - The total comes from `content-length`, else from the GitHub asset `size`. With neither, the total is null and the bar runs.
   - `UpdateStatus.download` carries it while the phase is `updating`, else null. The field is new and nullable, so it is additive. The web and the CLI read it tolerantly (`?? null`). Nothing is stored, so no migration.
   - The web page polls `GET /api/update` each second while the POST runs. A dropped POST (the server idle timeout) keeps the poll going.
   - `describeUpdate` adds the percentage, for the CLI and Telegram.
   - The git checkout and `claude update` give no share: their bars run.
3. **Bar or skeleton.**
   - A wait inside a card gets `ProgressBar` with its sentence: the update check, the install, the restart wait, the Claude Code update, the clone list, the GitHub reads, the note conflicts, the project file, the device list, the phone access status, the Tailscale install.
   - A wait for content that fills a page gets a skeleton: the first page load (chats or cards, by the address), the settings, the setup, the project list and the Versions card.
   - A button label for a short action stays, such as "Testing…". The login page keeps its faces. The chat keeps its working dots.
4. **Look.** The track is `--chip`, a pill. The fill is `--accent` with a `--glow` shadow, as the "now" line of the day timeline. The skeleton blocks are `--chip` with a `--panel` shimmer, with the radius of the part they copy.
5. **Reduced motion.** No shimmer. The running bar shows a still part of the fill. The sentence still says that Eva works.
6. **Roles.** A `role="status"` wrapper holds the sentence. A `role="progressbar"` element carries `aria-valuenow` only when the share is known. Skeleton shapes are `aria-hidden`, in an `aria-busy` box with a visually hidden status sentence, so the end-to-end tests keep their texts.
7. **Not read yet.** The chats arrive with the login check, so the first page load already waits. The project list starts as `null`, so it never says "No project matches." before it reads.
8. **Rules.** The root `AGENTS.md` gets one reuse rule. The web `AGENTS.md` names the loading parts. The EVE guide lists both in its Components table. The design reference page shows both, and its test checks each class. `reference.html` stays: the guide says to design a new part with the same tokens.

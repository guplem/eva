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

To be filled in step 3.

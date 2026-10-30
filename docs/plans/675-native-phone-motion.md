# Plan: native feel on a phone, cheap motion and a narrow-phone test (#675)

The issue settles the goal and most choices. This plan lists the gaps that the issue leaves to the implementer, with the decision for each.

## Gaps and decisions

1. **Token values.** `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)` (the curve of the dialogs today), `--ease-in: cubic-bezier(0.4, 0, 1, 1)` (the close of the chat details today), `--dur-press: 100ms`, `--dur-fast: 150ms`, `--dur-medium: 220ms`, `--dur-slow: 400ms`. Each transition today maps to the nearest token.
2. **Exception comment.** A comment on the line before the rule or the declaration, that starts with `Motion exception:` and gives the reason. The test finds it by that text.
3. **Chat details panel.** The frame takes its full width at once. The column inside slides in and out with `transform` and `opacity`. The conversation rewraps once, not on each frame. `ChatPanel.tsx` reacts to the animation by its name, because the animation moves from the frame to the column.
4. **Running `ProgressBar`.** Each line moves with `transform: translateX()`. A translate share is a share of the line, not of the track, so each line has its own keyframes.
5. **`ProgressBar` with a share.** `scaleX()` squeezes the rounded ends and the glow. Keep `width`, with an exception comment.
6. **Skeleton shimmer.** A skeleton shape can be an `input`, which has no pseudo-element, so a moving overlay cannot replace the moving background. Keep `background-position`, with an exception comment.
7. **Visor.** The face morph keeps `width`, `height`, `top` and `left`, with an exception comment, because the EVE guide gives that morph.
8. **`box-shadow` transitions.** The hover ring of a suggestion card and the glow of the send button change at once: a hover is frequent. The flash of a card moves from `box-shadow` to `outline-color`.
9. **Hover gate.** `@media (hover: hover) and (pointer: fine)`, the same query as `pointerQuery` in `client/visor-gaze.ts`.
10. **Enter key hint.** A pure function next to `sendsOnEnter` in `conversation-parts.ts` gives `enter` on a touch screen and `send` on others.

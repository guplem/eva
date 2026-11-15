# Plan: the box morphs into the bubble, and folds on short screens (#943)

## Goal

- A send turns the message box into the person's new bubble ("Metamorphosis").
- On a short screen, the box is one row with a + menu ("Adaptive").

## Decisions

- The person chose both designs in a prototype. They keep the settings row on a computer with room, and the drag handle of issue 660.
- A pure module, `client/send-morph.ts`, holds the math: the spring, the box between two places, the corners and the cross-fade. Unit tests cover it.
- `client/send-morph-player.ts` plays the morph in the page. It runs each frame and measures the newest bubble again, so the morph follows a chat that scrolls or a bubble that React replaces.
- A pure module, `client/composer-layout.ts`, decides when the box folds and how many lines the text takes. Unit tests cover it.
- The box folds when the visible window is lower than 640 px, or on a phone with a touch screen. The decision does not follow the focus, so the row does not flash while the keyboard opens.
- The + button is a second trigger of the engine chip's menu. The menu adds the attach button, the text actions and the saved prompts above the engine groups. So one menu keeps one save queue and one way to close.
- The textarea keeps its place in the tree when the box folds, so it keeps the focus and the keyboard stays open.
- "Reduce motion" turns the morph off: the bubble fades in, as today.
- `src/frontends/web/AGENTS.md` gets the exception for the send: the owner asked for it.

## Gaps

None left: the person answered both open choices.

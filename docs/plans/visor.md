# Plan: EVE's visor and expressions (issue #165)

## Motivation

The EVE redesign (#161) gives Eva a face: a black visor with two glowing eyes. The eyes show what Eva does, and one state always uses the same face. The shell (#167) and several pages (#168, #170, #179) wait for this component. The design is in `docs/design/eve/` (PR #162): the `.mk` CSS, the `e-*` classes, the keyframes, `FACES` and `CYCLE` in `reference.html` are the specification.

## What to build

- `src/frontends/web/visor.css`: the `.mk` rules, the `e-*` classes and the keyframes, copied from the reference.
- `src/frontends/web/client/visor-faces.ts`: the 15 faces, the class of each face and size, the login rotation, and the map from Eva's states to faces.
- `src/frontends/web/client/Visor.tsx`: the React component, with a size, a face and an optional rotate mode.
- The brand mark in the top bar uses the visor, with the face from the state map.
- A test page in `test/e2e/` shows each face at each size, for the end-to-end tests and for captures.

## Gaps and decisions

1. **Where the CSS lives.** A separate `visor.css`, linked from `index.html`. Issue #163 rewrites the tokens in `styles.css` at the same time, and a separate file avoids a conflict. Bun bundles both links.
2. **Colour tokens before #163.** `visor.css` defines `--h`, `--c`, `--eye`, `--glow`, `--visor`, `--visor2` and `--shell` with the guide's formulas and the EVE blue seed (`#2aa8ff`: hue 245.1, chroma 0.164). The rules use `:where(:root)`, which has no specificity, so the tokens of #163 on `:root` take over with no change here.
3. **The font of the "z".** The reference uses `var(--font)`. The web client has no `--font` yet, so the rule falls back to `system-ui, sans-serif`.
4. **The neutral face.** The reference gives `.mk.e-neutral .eyes` a `glance` animation, but defines no `glance` keyframes, so the neutral face only blinks. The guide says the same ("Blink every 7 s"). The plan leaves out the dead rule, and the neutral face gets no class, as in the reference gallery.
5. **Sizes.** `size` is 28, 36, 76 or 128. They map to the classes `s`, none, `l` and `xl`. 76 and 128 have the white shell ring.
6. **Face names.** The names of the guide, in lower case: `neutral`, `happy`, `wink`, `delighted`, `surprised`, `thinking`, `searching`, `listening`, `focused`, `firm`, `skeptical`, `worried`, `sad`, `error`, `asleep`.
7. **Rotate mode.** It follows `CYCLE` exactly: searching 5 s, thinking 3 s, happy 2.2 s, wink 2.2 s, surprised 2.6 s, listening 2.4 s, delighted 2.2 s, then again. With reduced motion, the visor stays on searching, as in the reference. The timer goes through a small scheduler seam, so a unit test drives it.
8. **The state map.** One record, `stateFaces`, from the "Use" column of the guide: idle, greeting, done, saved, thanked, news, thinking, searching, waiting, project work, asks permission, conflict, offline, failed, broken and resting.
9. **Accessibility.** The visor is decorative, so it is `aria-hidden`. The text next to it carries the meaning.
10. **Where Eva uses it now.** A 28 px visor at the start of the top bar. It is neutral, and worried while the page reconnects (the guide's "No connection to the hub"). The nav rail of #167 replaces the top bar later.
11. **The test page.** The end-to-end demo server also serves a gallery page on its own port, from `test/e2e/`. The product gets no new route.

# Plan: bring the EVE design guide up to date (#212)

## Why

The EVE redesign (#161) is done, apart from #210 and #211. The guide in `docs/design/eve/README.md` still lists the gaps from the start of the work. A reader who builds a new page reads the guide first. So each fact in it must match the code on `main`.

## Steps

1. Remove each gap that the redesign closed.
2. Keep each open gap, with its issue: #210 (context ring for pi) and #211 (time of each message).
3. Add the differences that the pull requests of #161 chose on purpose.
4. Check the rest of the guide against the code: tokens, fonts, radii, components, expressions and pages. Fix each fact that changed.
5. Leave `reference.html` and the captures as they are.

## Gaps

- Which differences did the pull requests choose on purpose? Read the bodies of the 20 merged pull requests.
- Which facts of the guide no longer match the code? Check each section against `src/frontends/web/`.
- The last row of the gaps table names a progress bar and skeletons under "Today". The code has them, and the reference does not. Decide where this fact belongs.

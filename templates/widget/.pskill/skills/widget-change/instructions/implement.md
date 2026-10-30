Write the smallest code that passes the new test. Follow `AGENTS.md` and the widget contract.

- Keep the widget plain web code: no framework, no build step, no inline script and no inline style.
- When the widget changes a data file, keep the fields that it does not know.
- Keep the mock files of `config.json`, `data/`, `eva/` and `example/` in line with the change. Never put real data of a person in them.
- A new data field follows the naming rules of the contract: camelCase, full English words, the unit in the name.

Run `npm run check` until it passes.

# Example widget

A widget for [Eva](https://github.com/guplem/eva)'s home page. It shows your habits, and marks a habit done for today.

**Demo:** https://example-owner.github.io/example-widget/

The demo uses mock data. A change in the demo shows on the screen only. It shows your real location when your browser allows it, and an example location otherwise.

## Add it to Eva

In the Eva of the person who owns this repository, the widget project shows in the list of widgets by itself. In any other Eva, add the widget by its address: `https://github.com/example-owner/example-widget`. Eva asks for its inputs and its permissions when you turn it on.

## Run it on your computer

A browser does not run the widget from a double-click on `index.html`. Run a small web server instead:

```sh
npm install
npm start
```

Then open http://localhost:3000/. Add `?size=small`, `medium`, `large` or `full` to the address to see each size.

## Change it

The widget follows the [widget contract](https://github.com/guplem/eva/blob/main/docs/widgets.md) of Eva. `AGENTS.md` says how to work on it, for people and for coding agents. `npm run check` runs every check.

## License

MIT. See [`LICENSE`](LICENSE).

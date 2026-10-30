Compare `eva-widget.json` with the one on main: `git diff origin/main -- eva-widget.json`.

A change widens the permissions when it adds an input, a folder or file input with `write` access, an `eva-location` input, or a host, or when it changes `read` to `write`. Eva asks the person again before a widget gets a new permission, so the pull request must say each one.

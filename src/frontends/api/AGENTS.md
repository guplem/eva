# Local API

- Listen on `127.0.0.1` only.
- Check `Host` and `Origin` on every request and every WebSocket upgrade.
- In `Bun.serve` `routes`, serve a file as a `Response`, never as `Bun.file`: the single executable refuses `Bun.file`.
- After you change the served files, run `bun run build:executable` and start `dist/eva` once.

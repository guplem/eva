# Remote access

- The Tailscale identity header never authenticates alone: any local program can forge it.
- A new browser logs in through the Telegram Allow (device login) or the token.
- Publish the web UI only inside the tailnet. Never use Funnel or a public tunnel.

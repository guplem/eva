# Remote access

- Never let the Tailscale identity header authenticate alone: any local program can forge it.
- Log in a new browser with a code that Telegram or the terminal allows (device login), or with the token.
- Any local program can use up the device-login limit of "this computer". The token login stays as the way in then.
- Never use Tailscale Funnel: it publishes the web UI to the internet.

# Remote access

- Never let the Tailscale identity header authenticate alone: any local program can forge it.
- Let a new browser log in with the token. Also let it use a device login: a code that Telegram, the terminal or a logged-in web app page allows.
- Keep the token login. Any local program can use up the device-login rate limit of the "this computer" account. Then the token is the only way to log in.
- Never use Tailscale Funnel: it publishes the web app to the internet.

# Remote access

- Never let the Tailscale identity header authenticate alone: any local program can forge it.
- Give a new browser two ways to log in: the token, or a device login with a code that Telegram, the terminal or a logged-in web app page allows.
- Keep the token login. Any local program can use all the device-login requests of the "this computer" account. Then the token is the only way to log in.
- Never use Tailscale Funnel: it publishes the web app to the internet.

# Instance

- The hub is the computer that runs the Telegram bot, the schedules and the vault migrations. A satellite is any other computer with Eva and the same vault.
- Pull the vault before a hub claim, so a machine never claims a hub that another machine already pushed.
- Keep each machine's last role when `hub.json` is broken. Never make a second hub.

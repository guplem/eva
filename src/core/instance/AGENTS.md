# Instance

- The hub is the computer that runs the Telegram bot, the schedules and the vault migrations. A satellite is any other computer with Eva and the same vault.
- Pull the vault before a hub claim, so a computer never claims a hub that another computer already pushed.
- Keep the last role of each computer when `hub.json` is broken. Never make a second hub.

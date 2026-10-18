# Migrations

- Never edit a migration that is on `main`. Write a new migration for a later fix.
- Keep each migration frozen: copy the key lists that it needs, and work on raw JSON. Import no key list or helper from `src/core/settings/`.
- Add each new migration to the list in `migrations.ts`.
- A satellite can update before the hub migrates the vault. Make new code read the old vault format too, for at least one release.

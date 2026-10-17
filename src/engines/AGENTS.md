# Engines

- Map structured engine fields, never English text (lesson 36).
- End every turn stream with exactly one `turn_finished` or `turn_failed`.
- Order events by `seq`, never by `at`.
- Redact the text of each event with `Redactor` before it leaves the core.
- Parser tests use fixtures captured from the neutral demo vault. Contract tests pin the exact SDK options and argument lists for each mode.
- Never embed `claude`: it adds about 270 MB and breaks updates. Never run pi inside the core process: it would see every secret. Never use a Claude login in pi: it bills as extra usage.

---
name: rename-symbol
description: Rename or refactor a symbol safely by searching every naming-case variant across code, tests, docs, configs, and JSON. Use when renaming any identifier so no reference is missed.
---

# Rename a symbol safely

- Search **every** naming variant: camelCase, PascalCase, snake_case, kebab-case and UPPER_CASE.
- Search the whole project: code, tests, docs, configs and JSON files. A missed variant in a config key or a data file compiles, but breaks at runtime.
- Follow the list of stored names and registration points in `AGENTS.md`.

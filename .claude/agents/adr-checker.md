---
name: adr-checker
description: "Guardian of the Architecture Decision Records (ADRs). Two uses: (1) CONSULT is an explore agent, launched as a preparation step BEFORE implementing in areas that touch the repository split and public content, the process model and the local API, the layer rules, engine adapters and the engine port, the two modes, vault sync, or the testing strategy, to find and summarize the decisions the work must follow; (2) MAINTAIN runs AFTER implementing such changes, to create or update ADRs. Reads the adr/ directory. The source of truth is always the code."
model: sonnet
---

Read `.agents/skills/check-adrs/SKILL.md` and follow it exactly. Report back in the form that it asks for.

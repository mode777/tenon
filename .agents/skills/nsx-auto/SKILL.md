---
name: nsx-auto
description: Take an idea, bug report or named nanospec change through clarification, planning, implementation and sync when no human decision is required.
---

# nsx-auto

Read `references/rules.md`. Accept the same input as `/nsx-change` or `/nsx-bugfix`.

1. Resume the named change if it exists. Otherwise classify the work as a bugfix, a single change or a multi-stage feature, and use that workflow.
2. Research facts and ask the user only when a human gate applies or no safe, evidence-based default exists. Never invent user answers or approval. Record safe assumptions and their rationale in the change.
3. For single changes and bugfixes, converge the document, apply it, then sync. A bugfix needs an evidenced root cause and a confirmed-red proof test before its fix is applied. For multi-stage features, create the roadmap and stop for user approval; after approval, process each dependency-ready stage in order. Never bypass an approval gate.
4. After each successful sync, `/nsx-sync` invokes the `nsx-retro` skill. Do not run a duplicate retro.
5. Stop at any human gate, failed verification limit or unavailable decision. Leave documents consistent and report the exact resume command.
6. Report assumptions, decisions, acceptance evidence and updated/archive paths. Never push, publish or deploy.

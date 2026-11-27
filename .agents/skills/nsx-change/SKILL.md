---
name: nsx-change
description: Interview and write or resume a concise, single-deliverable nanospec change. Use for a feature or improvement that is not multi-stage; use nsx-bugfix for defects.
---

# nsx-change

Read `references/rules.md`, `specs/project.md`, `specs/tech-stack.md`, `specs/memory.md`, then only relevant requirements, architecture and code.

1. If a matching change exists, resume it. Otherwise choose a short kebab-case name.
2. Size the work. For a trivial, fully specified diff, explain the fast path and stop. If it needs independent stages, recommend `/nsx-multi`; if it is a defect in existing behaviour, recommend `/nsx-bugfix`. Switch only with consent.
3. Create `changes/change-<name>.md` from `assets/change.md`. Interview one question at a time; update the document as answers arrive.
4. Keep requirements as deltas with stable IDs, derived from stakeholder goals rather than code branches. Include only needed behaviour, qualities or constraints; state one distinct capability per EARS requirement and give it an observable acceptance criterion. Delete inapplicable sections.
5. Converge when no decision is unresolved, requirements and tasks are verifiable, and a fresh-context readiness check finds no blocking question. If fresh context is unavailable, state that it was skipped.
6. Summarize the proposal and ask for approval. Set `Status: ready` only after approval. Do not implement.

---
name: nsx-multi
description: Interview and plan a multi-stage nanospec feature with independent outcomes, dependencies and a roadmap.
---

# nsx-multi

Read `references/rules.md`, `specs/project.md`, `specs/tech-stack.md`, `specs/memory.md`, then relevant specs and code.

1. Resume a matching `changes/change-<name>/index.md`, or choose a kebab-case name.
2. Interview one question at a time until the outcome, boundaries and stage seams are clear. Recommend options and challenge assumptions.
3. Create `changes/change-<name>/index.md` from `assets/index.md`. Order stages by dependency; each must deliver an independently verifiable outcome. Split only when it reduces risk or enables useful sequencing.
4. After roadmap approval, plan only the first stage whose dependencies are synced. Create `NN-<stage>.md` from `assets/change.md`, with `Parent: change-<name>` and the standard change sections.
5. Ask for approval before setting the roadmap `Status: ready`. Do not implement. Later stages are detailed one at a time after prior dependencies sync.
6. Continue the feature with `/nsx-apply` and `/nsx-sync`; archive the folder only when every stage is synced.

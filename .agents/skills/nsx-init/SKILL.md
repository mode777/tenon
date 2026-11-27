---
name: nsx-init
description: Initialize nanospec project specs. Interview for a greenfield project or derive a cautious, evidence-linked baseline from an existing codebase.
---

# nsx-init

Read `references/rules.md` and the relevant templates first.

1. Create `specs/project.md`, `specs/tech-stack.md`, `specs/memory.md`, `specs/architecture/system.md`, `specs/requirements/` and `changes/archive/`. Use the templates in `assets/`; never overwrite existing files.
2. Choose brownfield if code or manifests exist; otherwise greenfield. Ask if unclear.
3. Greenfield: interview one question at a time, in order: purpose/scope/users/goals; stack and commands; features; system/modules. Fill each document as its topic converges. Leave unknowns `TBD`.
4. Brownfield: read manifests, README and CI for the stack; inspect module boundaries, behaviour and tests. Derive requirements from stakeholder goals, not code branches. Start with system context and a system/subsystem overview; create module specs only for cohesive blocks with significant concerns. For large codebases, establish this map first and leave unexplored detail `TBD`. Cite paths; never invent rationale.
5. Stop for human correction of the draft baseline. Do not edit source code.
6. Create or extend root `AGENTS.md` with a `## Nanospec docs` section. If the file exists, preserve its content; update an existing section instead of adding a duplicate. Link the persistent docs with relative Markdown links:
   - `[Project](specs/project.md)`, `[Tech stack](specs/tech-stack.md)`, `[Memory](specs/memory.md)`
   - `[Requirements](specs/requirements/)`, `[System architecture](specs/architecture/system.md)`, `[Module architecture](specs/architecture/)`
   - `[Active changes](changes/)`, `[Archived changes](changes/archive/)`
   State: read project, tech stack and memory first; read other specs only when relevant. Baseline specs are updated only through `nsx-init`, `nsx-explore` and `nsx-sync`; `nsx-retro` may update `memory.md` only.

---
name: nsx-sync
description: Merge a completed nanospec change or bugfix into current requirements and architecture, archive it, and automatically run the project-memory retrospective.
---

# nsx-sync

Read `references/rules.md`. Select the named `done` change; otherwise select the sole `done` change. If multiple are done, ask which. Stop if any task or acceptance criterion is unchecked.

1. Merge requirement deltas (a change's section 3, a bugfix's Spec Impact) into the relevant `specs/requirements/feature-*.md` (create it from `assets/feature.md` if missing): add, replace or remove exactly as approved. Check new IDs are unique across specs.
2. Merge architecture deltas into `specs/architecture/system.md` and relevant module specs (create a new one from `assets/module.md`). Mark replaced decisions `superseded`; update `tech-stack.md` only if the verified stack or commands changed.
3. Check that the implementation satisfies every approved requirement and acceptance criterion. If not, stop without syncing; do not weaken the spec to match incomplete work.
4. Set status `synced`. Move a flat document to `changes/archive/YYYYMMDD-HHmm-<file name>`, e.g. `…-change-<name>.md` or `…-bugfix-<name>.md`. For a stage, mark its roadmap entry synced; set the index to `done` when all stages are implemented and verified, then `synced` when all are synced. Archive the full folder with that timestamp prefix only when every stage is synced.
5. Report spec files changed and the archive path.
6. **After a successful sync, invoke the `nsx-retro` skill automatically**, including for a single stage and when invoked by `/nsx-auto`. Do not skip the retrospective; it decides whether anything qualifies.

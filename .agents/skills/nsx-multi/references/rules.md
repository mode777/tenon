# nanospec shared rules

## Source of truth
- `specs/` describes the current, confirmed project. `changes/` describes proposed deltas.
- Read `specs/project.md`, `specs/tech-stack.md` and `specs/memory.md` first; read other specs and code only as relevant.
- Keep state in the files, not chat. Resume from the change document and its checkboxes.
- Never infer missing facts or rationale. Mark unknowns `TBD` or `reason: unknown`; cite paths for brownfield claims.
- Keep docs short. Remove sections that do not apply. Link to evidence instead of copying it.

## Requirements and architecture
- Requirements use stable, unique, non-numeric IDs such as `LOGIN-LOCKOUT`; never renumber or reuse IDs.
- Derive requirements from stakeholder goals, not code branches. For large systems, group goals by system and subsystem; link refinements to their parent requirement.
- Include only needed behaviour, qualities or constraints. Each requirement needs a stakeholder rationale and an observable fit criterion.
- State one distinct capability per EARS requirement. Split when actors, triggers or outcomes differ, or one fit criterion cannot verify it as a unit.
- Say what the system must do, not how. Add detail only to resolve meaningful ambiguity or risk; record imposed design as a constraint with its reason.
- Start architecture with system context and a concise building-block overview. For large systems, group blocks into subsystems, then detail selected areas.
- Add a module document only for a cohesive block with a meaningful interface and significant concern, complexity, risk or decision—not per file or function.
- Refine architecture selectively for stakeholder concerns; document consequential decisions with rationale and alternatives. Link to code instead of repeating it.
- Planned behaviour remains in a change until implemented, verified and synced.

## Change sizing and state
- Trivial: if one sentence fully defines the diff and checks, skip the change doc; make the edit and report the check.
- Single deliverable: use one `changes/change-<name>.md`.
- Multiple independently verifiable stages: use `changes/change-<name>/index.md` and numbered stage documents. Define outcomes and dependencies in the roadmap; detail only the next stage.
- Defect in existing behaviour: use `changes/bugfix-<name>.md` via `nsx-bugfix`. Evidence the root cause, then prove it with a failing test, before planning the fix.
- "Change" in these rules and skills includes bugfix documents unless stated otherwise.
- Statuses: `draft` → `ready` → `doing` → `done` → `synced`. A stage is synced before its roadmap item is checked off.
- For a multi-stage index, set `ready` after roadmap approval, `doing` when work starts, `done` when every stage is implemented and verified, and `synced` when every stage is synced.
- A change is ready only when questions are resolved or explicitly accepted as safe assumptions, each requirement has an acceptance criterion, each task has a verification, and the user has approved it. `nsx-auto` may proceed on safe assumptions, but never invent user approval.
- A bugfix is ready only when its root cause has evidence, its proof test fails for that cause, every task has a verification, and the user has approved it.
- Each task must be small, leave the project working, and state files and a verification command or manual check.

## Interview and implementation
- Research facts in the repository; ask the user only for decisions. Ask one focused question at a time and include a recommendation.
- Challenge assumptions. Stop when decisions are resolved; do not ask questions whose answers are already in the repo.
- Do not change the plan during implementation without explaining the discrepancy and getting user confirmation.
- Never weaken or delete tests to make checks pass. Use the narrowest relevant check, then run every acceptance validation fresh.
- Do not claim success without running the check and reading its output. If the same check fails three times, stop and report evidence.

## Human gates
Stop and ask before: a decision that changes scope, security, data or a hard-to-reverse design; removing a requirement or superseding a decision; deviating from an approved plan; destructive work; exposing secrets or changing permissions; or an external action such as pushing, publishing or deploying.

## Persistent memory
- `specs/memory.md` stores only concise, actionable, unusual lessons that are highly likely to recur and affect the whole project.
- Exclude speculation, session summaries, local one-offs, duplicate guidance and sensitive or confidential details. When unsure, do not record.
- Run `nsx-retro` after every successful sync. If no lesson qualifies, leave memory unchanged.

## Workflow boundaries
- `nsx-init` creates the baseline; `nsx-explore` adds confirmed facts about current state; `nsx-sync` merges completed change deltas. Only these workflows update baseline specs, except `nsx-retro`, which may update `specs/memory.md`.
- `nsx-explore` does not implement, create a change plan, or add proposed behaviour to baseline requirements. Recommend `nsx-change`, `nsx-multi` or `nsx-bugfix` when discovery converges; switch only with user consent.
- `nsx-bugfix` adds only the failing proof test; it does not change production code. `nsx-apply` does not alter that test without user confirmation.
- `nsx-apply` changes code, not baseline specs. `nsx-sync` updates specs to match the verified implementation, never uses a spec edit to conceal a code mismatch.
- If implementation does not meet the approved requirements or acceptance criteria, do not sync or rewrite the spec to claim success; resume implementation or ask the user.
- `nsx-auto` stops whenever a human gate applies or a safe, evidence-based default is unavailable. It never pushes, publishes or deploys.

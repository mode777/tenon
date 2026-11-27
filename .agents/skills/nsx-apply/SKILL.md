---
name: nsx-apply
description: Implement and verify the next planned nanospec change or bugfix, or continue a named one until its tasks and acceptance criteria pass.
---

# nsx-apply

Read `references/rules.md`. Select the named change; otherwise the `doing` change, then the first `ready` change by name. For a multi-stage change, select its next ready stage in roadmap order. If none is ready, report why. A `draft` change must go through `/nsx-change`, `/nsx-multi` or `/nsx-bugfix`.

1. Read the change and only the specs/code it references. Set its status to `doing`.
2. Bugfix only: run the proof test before editing. If it no longer fails, stop and report. Do not alter the proof test without user confirmation.
3. Implement one task at a time, making the smallest complete change. For behaviour, derive tests from acceptance criteria, not implementation.
4. Run each task's verification. Read its output, fix failures, then check off the task.
5. If the plan is wrong or incomplete, explain the discrepancy and stop. Update the plan only after user confirmation.
6. Run every acceptance validation fresh. Check off only passing criteria. If the same check fails three times, stop and report evidence.
7. When every task and criterion passes, set `Status: done` and suggest `/nsx-sync`. Do not edit baseline specs, commit, push or deploy.

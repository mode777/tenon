# Bugfix: <name>
Status: draft | ready | doing | done | synced
Created: <YYYY-MM-DD>

## 1. Symptom
- Observed: <what happens; exact error or output>
- Expected: <correct behaviour; source: `<REQUIREMENT-ID>`, doc or user>
- Reproduce: <minimal steps, inputs, environment>

## 2. Root Cause
<Why it happens, 1–3 sentences. The cause, not the symptom.>
Evidence: `<path:line>`; <log, trace or experiment result>
Same cause elsewhere: <paths, or none found>

## 3. Proof
- Test: `<path>` › `<test name>` — run: `<command>`
- Failure before fix: <assertion or error excerpt that shows the root cause>
- [ ] Confirmed red for the stated root cause

## 4. Fix Plan
- [ ] T1 <smallest complete change to the root cause> — files: `<paths>` — verify: `<command>`

## 5. Spec Impact
<!-- Delete if the specs already describe the expected behaviour correctly. -->
- Added: `<ID>` — <short description>: <EARS requirement>
- Changed: `<ID>` — <full new EARS requirement>; previously: <old requirement>
- Architecture: <system/module change; decision — why — alternatives>

## 6. Risks & Regressions
| Risk | Mitigation |
|---|---|
| <risk> | <action> |

## 7. Acceptance & Validation
- [ ] AC1: Proof test passes — validate: `<command>`
- [ ] AC2: No regressions — validate: `<full test command>`
- [ ] AC3: Reproduction no longer occurs — validate: <steps; delete if AC1 covers it>

## 8. Questions & Decisions
- [ ] Q1: <decision> (recommended: <option>)
- [x] Q2: <decision> → <answer>; why: <reason>

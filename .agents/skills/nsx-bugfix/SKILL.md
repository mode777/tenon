---
name: nsx-bugfix
description: Investigate a defect, find its root cause, prove it with a failing test and plan the fix in changes/bugfix-<name>.md. Use for broken or regressed existing behaviour, not new features.
---

# nsx-bugfix

Read `references/rules.md`, `specs/project.md`, `specs/tech-stack.md`, `specs/memory.md`, then only relevant requirements, architecture and code.

1. Resume a matching `changes/bugfix-<name>.md`, or create one from `assets/bugfix.md` with a short kebab-case name. If the request is new behaviour, not a defect, recommend `/nsx-change` and switch only with consent.
2. **Symptom.** Record observed and expected behaviour and minimal reproduction steps. Take the expected behaviour from the specs; ask the user only when no source settles it.
3. **Root cause first.** Trace from the symptom to the cause. Do not edit production code. Test one hypothesis at a time and confirm it with evidence: `path:line`, logs or a minimal experiment. Record the cause, not the symptom, and whether it occurs elsewhere. If it is unconfirmed, keep `Status: draft` and report what is known.
4. **Prove with a test.** Write the smallest test that reproduces the bug through the public interface. Take expected values from the expected behaviour, not from the current code. Run it: it must fail because of the stated root cause, not a setup or syntax error. Record the test, command and failure excerpt, then tick "Confirmed red". If no automated test is feasible, record exact manual steps and the reason, and get the user's acceptance.
5. **Plan the fix.** Target the root cause with the smallest complete change; give every task a verification. Fill Spec Impact only if the specs miss or misstate the expected behaviour. Delete inapplicable sections.
6. Summarize the root cause, proof and plan, and ask for approval. Set `Status: ready` only after approval. Do not implement the fix.

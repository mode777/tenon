# Change: Unified editor undo/redo

Status: doing
Created: 2026-11-28

## 1. Proposal

Tenon already has per-document undo/redo, but it is inconsistent. The scene editor uses the
shared snapshot hook (`plugin/src/core/history.ts`) with toolbar buttons, keyboard shortcuts,
and panel intents. The schema editor keeps a private duplicate history and only handles the
keyboard. The project editor uses the shared hook without any undo/redo surface. Exo shell
`0.13.0` / SDK `1.11.0` now sends id-less `shell/undo` and `shell/redo` intents to the active
writable plugin editor, but Tenon is on SDK `1.10.0` and subscribes to neither.

This change makes one history behavior cover every document editor, restores selection with
the document, groups continuous edits into logical undo steps, and wires the Exo menu,
palette, and shortcut intents while keeping history plugin-owned.

## 2. Goals & Non-Goals

- Goals:
  - One reusable per-document history layer for the project, schema, and scene/level editors.
  - Predictable granularity: one undo step per completed edit, drag, or discrete command.
  - Selection restored with each history entry; transient UI state stays outside history.
  - Shell Undo/Redo, frame controls, and keyboard shortcuts all use the same local history.
  - Future format editors can reuse the layer without a new undo implementation.
- Non-goals:
  - A shell-side undo stack, content snapshot, or cross-tab history.
  - The planned generator editor or any new authoring format.
  - Changing authoring JSON, save semantics, validation, or dirty ownership.
  - Persisting history across frames, reloads, or workspace sessions.

## 3. Added / Changed / Removed Requirements

### Added

- `HISTORY-SHARED` — One per-document history behavior.
  The plugin shall provide the same undo/redo behavior in the project, schema, and
  scene/level editors, with an independent history in each open frame.
  Why: authors should not learn different undo rules per format, and future formats must not
  duplicate history code.
  Fit: all three editors expose the same controls and shortcuts; undoing in one tab does not
  affect another tab.

- `HISTORY-SHELL` — Shell intents use plugin-owned history.
  When the Exo shell invokes Undo or Redo for the active writable Tenon document, the editor
  shall apply the action to its own history and report the resulting dirty state without
  writing content.
  Why: Exo owns the menu and palette, while the plugin owns the buffer and history.
  Fit: Edit > Undo, the palette command, and the shell shortcut change the active document;
  no save or content acknowledgement is sent.

- `HISTORY-FALLBACK` — Older shells keep frame-local controls.
  If the Exo shell does not send undo/redo intents, each Tenon document editor shall keep its
  own Undo/Redo controls and keyboard shortcuts usable.
  Why: the manifest remains compatible with Exo 0.11.0+, which predates the intents.
  Fit: with no shell intents delivered, the frame buttons and Ctrl/Cmd+Z still undo.

- `HISTORY-GRANULARITY` — Continuous edits are one undo step.
  When a user completes a continuous edit to one value, the editor shall record one undo step
  for that edit instead of one step per keystroke or pointer update.
  Why: per-keystroke history is unpredictable and quickly exhausts the history limit.
  Fit: typing a name and leaving the field, dragging a transform once, and invoking one
  discrete command each reverse in a single Undo.

- `HISTORY-SELECTION` — Selection follows the restored document.
  When Undo or Redo restores a history entry, the editor shall restore the selection stored
  with that entry and leave transient UI state unchanged.
  Why: undoing a delete, duplicate, or create should return the author to the affected item.
  Fit: undoing an entity or definition delete reselects the restored item; search, active
  tab, drawers, and transform mode do not change.

- `HISTORY-CONTROLS` — Visible and keyboard controls in every frame.
  Each Tenon document editor shall expose Undo and Redo controls and Ctrl/Cmd+Z,
  Shift+Ctrl/Cmd+Z, and Ctrl/Cmd+Y shortcuts; the controls shall be disabled when the
  relevant history is empty or the document is read-only.
  Why: undo must remain discoverable and keyboard-accessible when the frame owns focus.
  Fit: each toolbar shows enabled/disabled Undo and Redo; shortcuts work outside text inputs;
  a read-only frame cannot undo or redo.

- `HISTORY-DIRTY` — Dirty follows the saved text.
  When Undo or Redo changes the document, the editor shall report dirty by comparing the
  buffer with the last saved text; returning to the saved text shall clear dirty without a
  save.
  Why: undo must not falsely mark a document dirty or hide unsaved changes.
  Fit: save, edit, undo to the saved text reports clean; redo reports dirty.

- `HISTORY-RELOAD` — Reload starts a new history.
  When the editor reloads the open document from disk, it shall clear the undo and redo
  history.
  Why: entries from the replaced buffer must not be replayed onto the new document.
  Fit: after Reload, Undo is disabled and no pre-reload edit can be restored.

- `HISTORY-SAVE` — Save keeps history.
  When the shell reports a successful save, the editor shall retain its undo and redo history
  and update the saved-text baseline.
  Why: authors expect to undo past a save; only dirty state should change.
  Fit: save, then Undo, still restores the previous document and reports dirty.

- `PROJECT-UNDO` — Project import-map edits are undoable.
  The project editor shall undo and redo import-map additions, changes, and removals without
  sharing history with another frame.
  Why: `project.json` is authored source data and its edits are as reversible as schema or
  scene edits.
  Fit: add, change, and remove an import; each is undone and redone independently.

### Changed

None. Existing `SCENE-UNDO` and `SCHEMA-UNDO` remain satisfied and are refined by the added
`HISTORY-*` requirements.

### Removed

None.

## 4. Architecture Changes

- **Core history (`plugin/src/core/history.ts`)**: add one generic `useDocumentHistory` hook
  over `{ doc, selection }` entries and retire the current `useHistory` API after all frames
  migrate. It exposes `commit`/`replace`, `select`, `undo`, `redo`, `reset`, `canUndo`, and
  `canRedo`; it keeps the 100-entry limit, stable callbacks, and an optional coalescing key
  with a short fallback window. Decision: snapshot storage with a command-style commit API —
  new operations become undoable without inverse code — rejected explicit inverse commands and
  patch storage because every operation must opt in or needs diff complexity.
- **History boundaries**: text and number fields commit on blur/Enter; one viewport drag is
  one commit; discrete commands commit once. Coalescing remains a fallback for controls that
  must update live. Decision: logical boundaries first, time coalescing second.
- **Selection**: selection-only changes update the present entry without adding history;
  document commits capture the selection at the boundary. Undo/redo restore it; invalid
  selections fall back to a valid item. Decision: document plus selection — transient UI
  stays out.
- **Shell adapter (`plugin/src/core/useShellHistory.ts`)**: one hook subscribes to
  `onUndoRequest`/`onRedoRequest`, gates on `canWrite`, and invokes stable undo/redo callbacks.
  Decision: one adapter for every frame — avoids three divergent subscriptions.
- **SDK (`sdk/`)**: update the vendored `@exo/plugin-sdk` to upstream `1.11.0` byte-for-byte;
  update `plugin/package.json` and `package-lock.json`. The manifest stays
  `engines.exo: ">=0.11.0"` because the intents are additive and the fallback remains usable.
- **Editors**: project, schema, and scene/level frames all use the shared history, shell
  adapter, controls, and shortcuts. Scene panel commands keep the editor as the only writer;
  panel-originated edits use the same commit path.
- **Dirty and save**: keep the existing serialized-text comparison and `setDirty` effect; a
  successful save updates the baseline but does not reset history; external reload resets it.
- **Docs**: add TD-32 for editor undo/redo, update TD-15's command-pattern wording, and update
  the schema/scene UI docs, README status, and host-boundary notes.
- **Sync**: add the new history feature file and row to `specs/requirements/README.md`, update
  the SDK version in `specs/tech-stack.md`, and replace the schema-local history note in
  `specs/architecture/core-model.md` with the shared hook.

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Coalescing merges unrelated edits | Commit on blur/Enter at logical boundaries; coalescing keys include the document, field, and item. |
| Snapshot memory grows with large scenes | Keep the 100-entry bound and coalesce continuous edits. |
| Undo restores a selection that no longer exists | Normalize after restore and fall back to the nearest valid item or no selection. |
| Shell intent arrives while a text draft is uncommitted | Commit text on blur/Enter; the menu click blurs the field before the intent is handled. |
| Frame keys and shell keys double-undo | Iframe key events do not reach the shell; the frame handles focus and the shell adapter handles menu/palette only. |
| Read-only document mutates through an intent | Gate the adapter and controls on `canWrite`; the shell also gates writable documents. |
| Schema editor loses behavior when its duplicate hook is removed | Migrate every existing mutation to the shared commit API and run the existing schema suite plus new history tests. |
| Vendored SDK drifts from upstream | Copy the upstream `1.11.0` package wholesale and run the SDK suite and typecheck. |
| Older shell lacks the intents | Keep frame controls and shortcuts independent of the adapter; test with no intents delivered. |

## 6. Acceptance Criteria & Validation

- [x] AC1 `HISTORY-SHARED`: project, schema, and scene editors use one history implementation
  with independent stacks — validate:
  `cd plugin && npx vitest run src/core/history.test.tsx src/project-editor/ProjectEditor.test.tsx src/schema/SchemaEditor.test.tsx src/scene/SceneEditor.test.tsx`.
- [x] AC2 `HISTORY-SHELL`: simulated `shell/undo` and `shell/redo` intents change the active
  writable document and report dirty without save — validate: editor tests with a mock client.
- [x] AC3 `HISTORY-FALLBACK`: frame Undo/Redo buttons and shortcuts work when no intent is
  delivered — validate: editor tests without shell intent calls.
- [x] AC4 `HISTORY-GRANULARITY`: one completed text edit, one drag, and one command each undo
  in one step — validate: history and editor tests.
- [x] AC5 `HISTORY-SELECTION`: undo after delete/duplicate/create restores the associated
  selection; transient state is unchanged — validate: scene and schema editor tests.
- [ ] AC6 `HISTORY-CONTROLS`: every frame shows disabled-state Undo/Redo controls and handles
  all three shortcuts outside text inputs — validate: editor tests; manual keyboard check.
- [x] AC7 `HISTORY-DIRTY`: undo to saved text clears dirty; redo marks dirty again — validate:
  editor tests asserting `setDirty` calls.
- [x] AC8 `HISTORY-RELOAD`: reload clears history — validate: editor tests.
- [x] AC9 `HISTORY-SAVE`: save retains history and updates the baseline — validate: editor tests.
- [x] AC10 `PROJECT-UNDO`: import-map add, change, and remove each undo and redo — validate:
  `ProjectEditor.test.tsx`.
- [x] AC11 SDK and compatibility: vendored SDK is `1.11.0`, plugin depends on it, manifest
  stays `>=0.11.0` — validate: `npm test --workspace sdk`,
  `npm run typecheck --workspace sdk`, and version assertions.
- [x] AC12 Ship gate: `npm test`, `npm run typecheck`, and `npm run build` pass — validate:
  run all three from the repository root.
- [ ] AC13 Shell integration: on Exo 0.13.0+, Edit > Undo/Redo and the palette change the
  active Tenon document — validate: manual check in the hosted shell after deployment.

## 7. Questions & Decisions

- [x] Q1: Which editors share the architecture? → scene, schema, and project; why: consistent
  behavior and the project already has the underlying history.
- [x] Q2: Snapshot or inverse-command storage? → bounded snapshots behind a command-style
  commit API; why: every present and future document mutation is undoable without inverse code.
- [x] Q3: How are continuous edits grouped? → logical boundaries plus same-field coalescing;
  why: predictable undo steps and bounded history.
- [x] Q4: Is selection part of history? → document plus selection, with transient UI excluded;
  why: undo should return the author to the affected item.
- [x] Q5: How is Exo integrated? → SDK 1.11.0 and shell intents in every frame, manifest stays
  `>=0.11.0`; why: additive compatibility with frame-local fallback.
- [x] Q6: Visible controls? → Undo/Redo controls in all three frames; why: discoverability and
  parity with the existing scene toolbar.
- [x] Q7: Safe assumption — keep the 100-entry limit and use a 750 ms coalescing fallback;
  why: preserves the existing bound while logical boundaries do the main grouping.
- [x] Q8: Safe assumption — history survives save and resets only on external reload; why:
  standard editor semantics and the current reload behavior.
- [x] Q9: Safe assumption — bump the plugin to `0.6.0`; why: every prior shipped feature
  commit advanced the plugin minor version.

No open questions.

## 8. Implementation Plan

- [x] T1 Copy the upstream `@exo/plugin-sdk` `1.11.0` package over `sdk/` and update the plugin
  dependency — files: `sdk/`, `plugin/package.json`, `package-lock.json` — verify:
  `npm test --workspace sdk`, `npm run typecheck --workspace sdk`, and confirm `SDK_VERSION`
  is `1.11.0`.
- [x] T2 Add `useDocumentHistory` with document-plus-selection entries, `select`, commit
  boundaries, coalescing, stable callbacks, and unit tests; keep `useHistory` temporarily —
  files: `plugin/src/core/history.ts`, `plugin/src/core/history.test.tsx` — verify:
  `cd plugin && npx vitest run src/core/history.test.tsx`.
- [x] T3 Add the shared shell history adapter hook and its tests — files:
  `plugin/src/core/useShellHistory.ts`, `plugin/src/core/useShellHistory.test.tsx` — verify:
  `cd plugin && npx vitest run src/core/useShellHistory.test.tsx`.
- [x] T4 Migrate the project editor's document history to `useDocumentHistory` and capture no
  selection — files: `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/project-editor/ProjectEditor.test.tsx` — verify:
  `cd plugin && npx vitest run src/project-editor/ProjectEditor.test.tsx`.
- [x] T5 Commit project import-map paths on blur/Enter and add Undo/Redo toolbar controls,
  shortcuts, and shell intents — files:
  `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/project-editor/ProjectEditor.test.tsx`, `plugin/src/project-editor/project-editor.css`
  — verify: `cd plugin && npx vitest run src/project-editor/ProjectEditor.test.tsx`.
- [x] T6 Replace the schema editor's duplicate history with `useDocumentHistory` and capture
  definition, field, event, payload-field, and enum selection — files:
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/schema/SchemaEditor.test.tsx` — verify:
  `cd plugin && npx vitest run src/schema/SchemaEditor.test.tsx`.
- [x] T7 Commit schema identity fields on blur/Enter and add Undo/Redo toolbar controls,
  Ctrl/Cmd+Y, and shell intents — files: `plugin/src/schema/SchemaEditor.tsx`,
  `plugin/src/schema/Inputs.tsx`, `plugin/src/schema/SchemaEditor.test.tsx`,
  `plugin/src/schema/schema.css` — verify:
  `cd plugin && npx vitest run src/schema/SchemaEditor.test.tsx`.
- [x] T8 Migrate the scene editor history to document-plus-selection entries and route every
  command and viewport transform through the same commit path — files:
  `plugin/src/scene/SceneEditor.tsx`, `plugin/src/scene/scene-commands.ts`,
  `plugin/src/scene/SceneEditor.test.tsx` — verify:
  `cd plugin && npx vitest run src/scene/SceneEditor.test.tsx`.
- [x] T9 Add scene Undo/Redo shell intents and verify toolbar, keyboard, and panel-originated
  undo/redo — files: `plugin/src/scene/SceneEditor.tsx`,
  `plugin/src/scene/useScenePanelBridge.ts`, `plugin/src/scene/SceneEditor.test.tsx`,
  `plugin/src/scene/panels/panel-bridge.test.tsx` — verify:
  `cd plugin && npx vitest run src/scene/SceneEditor.test.tsx src/scene/panels/panel-bridge.test.tsx`.
- [x] T10 Make scene-panel text and number edits commit at logical boundaries while keeping
  panel commands on the editor history path — files:
  `plugin/src/scene/panels/InspectorPanel.tsx`, `plugin/src/scene/panels/InspectorPanel.test.tsx`
  — verify: `cd plugin && npx vitest run src/scene/panels/InspectorPanel.test.tsx`.
- [x] T11 Remove the superseded `useHistory` API and update remaining imports — files:
  `plugin/src/core/history.ts`, `plugin/src/core/history.test.tsx`, and any remaining editor
  imports — verify: `npm run typecheck`.
- [x] T12 Update the design docs and decision record — files:
  `docs/technical-decisions.md` (TD-15, TD-26, new TD-32),
  `docs/schema-editor-ui.md`, `docs/scene-editor-ui.md`, `README.md` — verify: grep for stale
  command-pattern wording and re-read the keyboard/toolbar sections.
- [x] T13 Bump the plugin version to `0.6.0` and keep the manifest engine range at
  `>=0.11.0` — files: `plugin/package.json`, `plugin/public/exo-manifest.json`,
  `package-lock.json` — verify: `npm run build` and inspect the manifest versions.
- [x] T14 Run the full ship gate and a fresh-context review of the diff — files: none —
  verify: `npm test`, `npm run typecheck`, `npm run build`, `npm test --workspace sdk`.

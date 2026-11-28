# Feature: Editor history

Per-document undo/redo across every Tenon document editor, with plugin-owned history and Exo
shell intents.

## Requirements

- `HISTORY-SHARED` — One per-document history behavior.
  The plugin shall provide the same undo/redo behavior in the project, schema, and
  scene/level editors, with an independent history in each open frame.
  Why: authors should not learn different undo rules per format, and future formats must not
  duplicate history code.
  Fit: all three editors expose the same controls and shortcuts; undoing in one tab does not
  affect another tab.
  Evidence: `plugin/src/core/history.ts`, `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/scene/SceneEditor.tsx`, TD-32.

- `HISTORY-SHELL` — Shell intents use plugin-owned history.
  When the Exo shell invokes Undo or Redo for the active writable Tenon document, the editor
  shall apply the action to its own history and report the resulting dirty state without
  writing content.
  Why: Exo owns the menu and palette, while the plugin owns the buffer and history.
  Fit: Edit > Undo, the palette command, and the shell shortcut change the active document;
  no save or content acknowledgement is sent.
  Evidence: `plugin/src/core/useShellHistory.ts`, `plugin/src/*Editor.tsx`, TD-32.

- `HISTORY-FALLBACK` — Older shells keep frame-local controls.
  If the Exo shell does not send undo/redo intents, each Tenon document editor shall keep its
  own Undo/Redo controls and keyboard shortcuts usable.
  Why: the manifest remains compatible with Exo 0.11.0+, which predates the intents.
  Fit: with no shell intents delivered, the frame buttons and Ctrl/Cmd+Z still undo.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/scene/SceneEditor.tsx`, TD-32.

- `HISTORY-GRANULARITY` — Continuous edits are one undo step.
  When a user completes a continuous edit to one value, the editor shall record one undo step
  for that edit instead of one step per keystroke or pointer update.
  Why: per-keystroke history is unpredictable and quickly exhausts the history limit.
  Fit: typing a name and leaving the field, dragging a transform once, and invoking one
  discrete command each reverse in a single Undo.
  Evidence: `plugin/src/core/history.ts`, `plugin/src/schema/Inputs.tsx`,
  `plugin/src/scene/panels/InspectorPanel.tsx`, `plugin/src/project-editor/ProjectEditor.tsx`.

- `HISTORY-SELECTION` — Selection follows the restored document.
  When Undo or Redo restores a history entry, the editor shall restore the selection stored
  with that entry and leave transient UI state unchanged.
  Why: undoing a delete, duplicate, or create should return the author to the affected item.
  Fit: undoing an entity or definition delete reselects the restored item; search, active
  tab, drawers, and transform mode do not change.
  Evidence: `plugin/src/core/history.ts`, `plugin/src/scene/SceneEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, TD-32.

- `HISTORY-CONTROLS` — Visible and keyboard controls in every frame.
  Each Tenon document editor shall expose Undo and Redo controls and Ctrl/Cmd+Z,
  Shift+Ctrl/Cmd+Z, and Ctrl/Cmd+Y shortcuts; the controls shall be disabled when the
  relevant history is empty or the document is read-only.
  Why: undo must remain discoverable and keyboard-accessible when the frame owns focus.
  Fit: each toolbar shows enabled/disabled Undo and Redo; shortcuts work outside text inputs;
  a read-only frame cannot undo or redo.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/scene/SceneEditor.tsx`, TD-32.

- `HISTORY-DIRTY` — Dirty follows the saved text.
  When Undo or Redo changes the document, the editor shall report dirty by comparing the
  buffer with the last saved text; returning to the saved text shall clear dirty without a
  save.
  Why: undo must not falsely mark a document dirty or hide unsaved changes.
  Fit: save, edit, undo to the saved text reports clean; redo reports dirty.
  Evidence: `plugin/src/*Editor.tsx`, TD-32.

- `HISTORY-RELOAD` — Reload starts a new history.
  When the editor reloads the open document from disk, it shall clear the undo and redo
  history.
  Why: entries from the replaced buffer must not be replayed onto the new document.
  Fit: after Reload, Undo is disabled and no pre-reload edit can be restored.
  Evidence: `plugin/src/project-editor/ProjectEditor.test.tsx`,
  `plugin/src/core/history.ts`, TD-32.

- `HISTORY-SAVE` — Save keeps history.
  When the shell reports a successful save, the editor shall retain its undo and redo history
  and update the saved-text baseline.
  Why: authors expect to undo past a save; only dirty state should change.
  Fit: save, then Undo, still restores the previous document and reports dirty.
  Evidence: `plugin/src/project-editor/ProjectEditor.test.tsx`, TD-32.

## Sources

- `plugin/src/core/history.ts`
- `plugin/src/core/useShellHistory.ts`
- `plugin/src/project-editor/ProjectEditor.tsx`
- `plugin/src/schema/SchemaEditor.tsx`
- `plugin/src/scene/SceneEditor.tsx`
- `plugin/src/scene/panels/InspectorPanel.tsx`
- `docs/technical-decisions.md` TD-32
- Exo SDK 1.11.0 `EditorClient.onUndoRequest` / `onRedoRequest`

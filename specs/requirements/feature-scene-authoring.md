# Feature: Scene and level authoring

The scene editor authors one scene or level document at a time. It adds the three.js viewport
and writes document edits through the shell; the Hierarchy & Assets, Inspector, and Inspection
panels follow the active scene/level editor.

## Requirements

- `SCENE-EDITOR` — One editor for scenes and levels.
  The plugin shall open `scenes/*.scene.json` and `levels/*.scene.json` in the same scene
  editor, with levels treated as the top-level world.
  Why: a level is a scene document, so one editor should cover both without a separate format.
  Fit: opening a level shows level mode in the same frame; opening a scene shows scene mode.
  Evidence: `plugin/public/exo-manifest.json`, `plugin/src/scene/main.tsx`,
  `docs/scene-editor-ui.md`.

- `SCENE-ENTITIES` — Place and edit host entities.
  The scene editor shall place concrete definitions, scene instances, and GLB assets; select,
  move, rotate, scale, duplicate, and delete host entities.
  Why: these are the core scene-authoring operations.
  Fit: each operation changes the scene document through the editor's history.
  Evidence: `plugin/src/scene/SceneEditor.tsx`, `plugin/src/scene/scene-commands.ts`,
  `plugin/src/scene/panels/HierarchyPanel.tsx`, `docs/scene-editor-ui.md`.

- `SCENE-TRANSFORMS` — Every entity has a transform.
  Every scene entity shall have a built-in local transform outside `props`; omitted
  transforms or components shall resolve to identity, rotations shall be Euler XYZ degrees in
  authoring JSON, and parent transforms shall compose to children.
  Why: placement is not schema data, and runtime movement must propagate through the
  hierarchy.
  Fit: placing an entity starts at identity; moving a parent moves its children.
  Evidence: `plugin/src/core/scene.ts` (`IDENTITY_*`, `normalizeTransform`, `composeTransforms`),
  TD-20, TD-23.

- `SCENE-HIERARCHY` — Show the host tree without internals.
  The scene hierarchy shall show the host entity tree, with each scene instance as one atomic
  node and host attachments shown under their instance.
  Why: scene instance internals are private; the hierarchy must reflect the authoring
  boundary.
  Fit: a level lists the train instance as one node; the attached button appears beneath it;
  internal train entities do not.
  Evidence: `plugin/src/scene/panels/HierarchyPanel.tsx`, `docs/scene-editor-ui.md`.

- `SCENE-LIBRARY` — Browse entities, scenes, and assets.
  The scene library shall show concrete definitions only, other scene documents that can be
  instanced, and workspace assets; each tab shall support search and refresh.
  Why: authors need to place schema-defined entities and reusable scenes without hand-editing
  JSON.
  Fit: abstract definitions never appear; placing a definition from another namespace adds
  its exact requirement; refresh picks up external files.
  Evidence: `plugin/src/scene/panels/HierarchyPanel.tsx`,
  `plugin/src/scene/scene-workspace.ts`, `docs/scene-editor-ui.md`.

- `SCENE-ASSETS` — Place mesh assets.
  Files under `assets/` shall be assets, not entities; a `.glb` shall be placeable as a
  `basic3d:mesh` instance; `scene` and `assetRef` paths shall accept workspace-absolute or
  scene-relative references.
  Why: imported meshes are source assets; placing one creates an entity instance.
  Fit: a GLB in `assets/` can be selected and placed; the resulting entity references the
  asset path.
  Evidence: `plugin/src/scene/panels/HierarchyPanel.tsx`,
  `plugin/src/scene/scene-commands.ts`, `plugin/src/core/scene.ts` (`resolveScenePath`), TD-21.

- `SCENE-PANELS` — Panels follow the active scene editor.
  The scene Inspector and Inspection panels shall follow the active Tenon scene/level editor,
  request a fresh snapshot on mount and active-editor changes, and send typed commands back to
  that editor instance.
  Why: panels are shell-owned surfaces; the editor must remain the only writer and own undo,
  dirty state, and save.
  Fit: switching scene tabs updates both panels; no scene open shows an empty state.
  Evidence: `plugin/src/scene/useScenePanelBridge.ts`,
  `plugin/src/scene/panels/useScenePanel.ts`, TD-31.

- `SCENE-HIERARCHY-PANEL` — Hierarchy and library live in a shell panel.
  The scene/level workspace shall expose the host hierarchy and entity/scene/asset library in
  the singleton `tenon.scene.hierarchy` primary shell panel, auto-revealed as a companion of
  the active scene/level editor and following the active editor instance.
  Why: the primary sidebar is shell-owned and keeps the viewport uncluttered.
  Fit: opening a scene/level reveals the panel; switching to a project/schema editor hides it;
  switching scene tabs updates it; opening it with no scene shows an empty state.
  Evidence: `plugin/public/exo-manifest.json`,
  `plugin/src/scene/panels/HierarchyPanel.tsx`,
  `plugin/src/scene/panels/panel-roots.tsx`, TD-31.

- `SCENE-PANEL-COMMANDS` — Panel edits are editor commands.
  The hierarchy panel shall send typed commands for selection and for adding entities, scene
  instances, and assets to the active scene/level editor; the editor shall apply them through
  its existing reducer and history and remain the only writer.
  Why: the shell panel must not write workspace files or own document state.
  Fit: adding from the panel marks the document dirty, selects the new entity, and is undoable;
  a read-only workspace disables placement.
  Evidence: `plugin/src/scene/scene-commands.ts`,
  `plugin/src/scene/panels/HierarchyPanel.tsx`,
  `plugin/src/scene/useScenePanelBridge.ts`.

- `SCENE-PANEL-SHORTCUTS` — Keyboard behavior survives the move.
  While the hierarchy panel has focus, Delete/Backspace, Ctrl/Cmd+D, Escape, Ctrl/Cmd+Z,
  Shift+Ctrl/Cmd+Z/Ctrl+Y, Ctrl/Cmd+S, and W/E/R shall perform the same actions as when the
  scene frame has focus, except while a text input, select, or contenteditable element has
  focus.
  Why: moving the pane out of the editor frame would otherwise regress the current shortcut
  behavior.
  Fit: panel-focused shortcuts edit/undo/save/switch mode through the active editor and do not
  fire while searching or typing.
  Evidence: `plugin/src/scene/panels/HierarchyPanel.tsx`,
  `plugin/src/scene/useScenePanelBridge.ts`,
  `plugin/src/scene/panels/HierarchyPanel.test.tsx`.

- `SCENE-PANEL-REFRESH` — One refresh updates both views.
  When the user refreshes the hierarchy panel, the panel shall reload its workspace view and
  the active editor shall reload its schema/asset context so validation and placement use the
  same workspace state.
  Why: panel and editor must not drift after an external schema/asset change.
  Fit: adding a schema or asset outside the editor and refreshing updates the palette, asset
  list, and scene validation without reopening the document.
  Evidence: `plugin/src/scene/panels/panel-roots.tsx`,
  `plugin/src/scene/useScenePanelBridge.ts`,
  `plugin/src/scene/panels/HierarchyPanelRoot.test.tsx`.

- `SCENE-INSPECTOR` — Schema-generated entity inspector.
  The Inspector shall show schema-generated fields and the built-in transform for the selected
  entity, scene settings when nothing is selected, and the referenced scene's public surface
  for a scene instance; internals shall remain read-only.
  Why: the inspector must be generic across definitions and respect scene boundaries.
  Fit: selecting a definition shows its effective fields; selecting a train instance shows
  public fields, not internal entities.
  Evidence: `plugin/src/scene/panels/InspectorPanel.tsx`, `docs/scene-editor-ui.md`.

- `SCENE-INSPECTION` — Validation, public surface, and debug expansion.
  The Inspection panel shall show validation issues, the scene public surface with promotion
  and slot editors, and a debug expansion of scene instances.
  Why: these are cross-cutting scene concerns that do not fit the viewport or Inspector.
  Fit: the three tabs show the corresponding data; selecting an issue selects its entity.
  Evidence: `plugin/src/scene/panels/InspectionPanel.tsx`, `docs/scene-editor-ui.md`.

- `SCENE-VALIDATION` — Validate the open scene.
  The scene editor shall validate scene requirements, entity IDs and references, transforms,
  hierarchy cycles and multiple parents, scene instances, promotions, slots, and attachments,
  and provide jump-to-entity.
  Why: invalid authoring data must be visible before save and build.
  Fit: a broken slot or promotion shows an error; selecting it focuses the relevant entity.
  Evidence: `plugin/src/core/scene.ts` (`validateScene`),
  `plugin/src/scene/SceneEditor.tsx`, TD-16.

- `SCENE-UNDO` — Per-document undo/redo.
  The scene editor shall provide undo and redo for the open scene or level without sharing
  history with another frame.
  Why: placement and composition edits are exploratory; per-document history prevents
  cross-tab surprises.
  Fit: undo reverses a transform or placement in the active document only, including edits
  issued from a scene panel.
  Evidence: `plugin/src/core/history.ts`, `plugin/src/scene/SceneEditor.tsx`,
  `plugin/src/scene/useScenePanelBridge.ts`, `AGENTS.md`.

- `SCENE-DEBUG-EXPANSION` — Preview the resolved world without saving it.
  The Inspection panel's debug expansion shall resolve scene instances, promotions, and slot
  attachments into a flat runtime-shaped entity list, remap instance IDs, and keep concrete
  parent links and local transforms; the result shall be computed in memory and never saved.
  Why: authors need to inspect how composition resolves before a build.
  Fit: expanding the M2 level shows resolved train internals and the attached button; the
  scene file is unchanged.
  Evidence: `plugin/src/core/scene.ts` (`expandScene`),
  `plugin/src/scene/panels/InspectionPanel.tsx`, TD-30.

## Sources

- `plugin/src/scene/`
- `plugin/src/scene/panels/`
- `plugin/src/core/scene.ts`
- `plugin/src/core/history.ts`
- `docs/scene-editor-ui.md`
- `docs/technical-decisions.md` TD-07, TD-16, TD-20, TD-21, TD-23, TD-30, TD-31, TD-32
- `examples/m2-workspace/`

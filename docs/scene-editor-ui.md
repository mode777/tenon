# M2 project and scene editors

The M2 editors turn a Tenon project into a playable scene hierarchy inside Exo. The
project editor owns the import map and project-wide validation; the scene editor owns
one scene or level document at a time and adds the 3D viewport.

## Project editor (`project.json`)

- Edits the namespace-to-location import map.
- Shows every resolved schema with its version, source (builtin/local/remote), content
  hash, and location, plus schemas found in the workspace but not mapped.
- Resolves each bundle's declared imports and validates every schema and scene in the
  project.
- Reports build readiness and the planned build command. It never writes build output.
- Maps a discovered schema in one click and opens the source document for an issue.
- Saves through the Exo shell save handler; dirty, conflict, external-change, theme,
  and read-only behavior follow the shell contract.

## Scene editor (`scenes/*.scene.json`, `levels/*.scene.json`)

A level is a scene document under `levels/`; it opens in the same editor with a level
badge and top-level-world behavior. The scene panels require **Exo 0.11.0+** and SDK
1.10.0+. The panels use the active-editor context and bottom location introduced in Exo
0.10.0; automatic companion binding arrived in Exo 0.11.0. The shell Undo/Redo menu,
palette, and shortcut intents require Exo 0.13.0+; the frame keeps its own controls and
keys as the fallback.

### Layout

The scene frame owns the toolbar, viewport, and save/conflict notices. The Hierarchy &
Assets, Inspector, and Inspection surfaces are Exo shell panels, not iframes inside the
scene frame.

- **Toolbar:** move/rotate/scale mode, snapping, undo/redo, duplicate, delete, and
  Hierarchy/Inspector/Inspection actions with the validation count.
- **Hierarchy & Assets:** the `tenon.scene.hierarchy` primary shell panel. It contains the
  host scene tree and the entity/scene/asset library.
- **Hierarchy:** the host scene tree. Scene instance internals are not listed; a scene
  instance is one atomic node. Host attachments appear under their instance.
- **Library:** three tabs in the lower section of the hierarchy panel.
  - **Entities:** concrete definitions from the available schemas. Placing a definition
    from another namespace adds its exact `namespace@version` requirement to the scene.
    Abstract definitions never appear.
  - **Scenes:** other scene documents that can be instanced.
  - **Assets:** files under `assets/`. A `.glb` can be placed as a `basic3d:mesh` entity.
  Each tab has a refresh action that reloads schemas, scenes, and assets from the
  workspace, so files added outside the editor appear without reopening it.
- **External references:** `scene` and `assetRef` paths are stored workspace-absolute
  (`/scenes/train.scene.json`, `/assets/cube.glb`) when picked from a library list, and
  are also resolved relative to the containing scene (`../assets/cube.glb`). The
  Inspector shows a refresh action next to the scene and `assetRef` pickers.
- **Viewport:** three.js through React Three Fiber and drei, with a grid, transform
  controls, and a camera gizmo.
- **Inspector:** the `tenon.scene.inspector` secondary shell panel. It shows
  schema-generated fields for the selected entity, plus its built-in transform. With no
  selection it shows scene settings. Scene instances expose the referenced scene's public
  surface; internal entities stay read-only.
- **Inspection:** the `tenon.scene.inspection` bottom shell panel. It contains validation,
  the public surface with promotion/slot editors, and a debug expansion of scene
  instances.

### Panel synchronization

- The Hierarchy & Assets, Inspector, and Inspection panels follow the active Tenon
  scene/level editor through Exo's `activeEditor` and `editor/active`. They do not own a
  document or a save path.
- The editor publishes a serialized snapshot on a plugin-local topic; a panel requests a
  fresh snapshot when it mounts or the active editor changes, then sends typed commands
  back to that editor instance.
- The editor applies panel commands through the same reducer as its own controls, so undo,
  dirty state, conflict handling, and Save stay in the scene frame.
- A panel shows an empty state when no scene/level editor is active. Opening a project or
  schema editor does not show a scene panel for that file.
- The panels load the workspace read-only for schema, asset, scene, and validation
  context. Local events are at-most-once; a panel never assumes it has every intermediate
  snapshot.
- The primary sidebar shows one view at a time, so the Hierarchy & Assets panel and the
  project hub cannot be visible simultaneously. The scene/level editor declares the
  hierarchy panel as a primary companion, so the shell reveals it when the scene becomes
  active and hides it when another surface is active.

### Editing behavior

- Place, select, move, rotate, scale, duplicate, and delete host entities.
- `W`, `E`, and `R` switch the transform mode; `Escape` deselects; delete removes the
  selected entity and its subtree; duplicate remaps IDs inside the copied subtree.
- Parent an entity from the Inspector panel. A parent that is a scene instance requires
  one of that scene's declared slots.
- Edits the selected entity's local transform. Rotations are Euler XYZ **degrees** in
  authoring JSON; the viewport converts to radians.
- An omitted transform or component is identity. Transform is never a schema property.
- Undo/redo is per document and restores the selection stored with the edit. The frame
  toolbar, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, and Ctrl/Cmd+Y handle a focused frame; Exo's
  Edit menu, palette, and shortcuts send intents to the active writable frame. Text and
  number fields commit on blur/Enter; one drag is one history step.
- Shell Save, Save All, dirty indicators, and conflict notices are shell-owned; the frame
  answers save requests and reports dirty honestly. Save keeps history; reload clears it.

### Scene composition

- A scene instance uses `scene` instead of `type` and points at another scene document.
- Its transform places the referenced scene. Its `props` may override the referenced
  root's effective fields and the scene's promoted fields, but nothing else.
- Internals are atomic and read-only from the host. The only cross-boundary attachment
  is a declared slot.
- Promotions reach direct children only and are edited in the Inspection panel's Public
  surface tab.
- A slot names a child transform; a host entity attaches with `parent` plus `slot`.
- Removing a slot or promotion, a wrong target, a missing scene, a cycle, or an
  attachment to an undeclared slot is a validation error with jump-to-entity.

### Debug expansion

The **Debug expansion** tab in the Inspection panel resolves scene instances, promotions,
and slot attachments into a flat runtime-shaped entity list. It removes scene boundaries,
keeps parent links and local transforms, remaps instance IDs, and shows the resolved
property values. It is computed in memory and is never saved; the actual build remains a
CLI/CI concern.

## M2 scope

Included: project import map, project-wide validation, New Scene, scene/level editing,
three.js viewport, schema-generated Inspector and Inspection shell panels, entity and scene
palettes, asset placement, scene instances, direct-child field and event promotions, slots, host
attachments, input entity refs, undo/redo, and debug expansion.

Not included: events runtime harness, generators, build/bake, lightmaps, 2D orthographic
views, and cross-file refactors. Those remain their own milestones.

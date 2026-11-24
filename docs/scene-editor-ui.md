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
badge and top-level-world behavior.

### Layout

- **Toolbar:** move/rotate/scale mode, snapping, undo/redo, duplicate, delete, and the
  validation count.
- **Hierarchy:** the host scene tree. Scene instance internals are not listed; a scene
  instance is one atomic node. Host attachments appear under their instance.
- **Palette:** concrete definitions from the available schemas and scene documents that
  can be instanced. Placing a definition from another namespace adds its exact
  `namespace@version` requirement to the scene. Abstract definitions never appear.
- **Assets:** files under `assets/`. A `.glb` can be placed as a `basic3d:mesh` entity.
- **Viewport:** three.js through React Three Fiber and drei, with a grid, transform
  controls, and a camera gizmo.
- **Inspector:** schema-generated fields for the selected entity, plus its built-in
  transform. Scene instances expose the referenced scene's public surface. Internal
  entities stay read-only.
- **Drawer:** validation, the public surface with promotion/slot editors, and a debug
  expansion of scene instances.

### Editing behavior

- Place, select, move, rotate, scale, duplicate, and delete host entities.
- `W`, `E`, and `R` switch the transform mode; `Escape` deselects; delete removes the
  selected entity and its subtree; duplicate remaps IDs inside the copied subtree.
- Parent an entity from the inspector. A parent that is a scene instance requires one of
  that scene's declared slots.
- Edits the selected entity's local transform. Rotations are Euler XYZ **degrees** in
  authoring JSON; the viewport converts to radians.
- An omitted transform or component is identity. Transform is never a schema property.
- Undo/redo is per document. Shell Save, Save All, dirty indicators, and conflict
  notices are shell-owned; the frame answers save requests and reports dirty honestly.

### Scene composition

- A scene instance uses `scene` instead of `type` and points at another scene document.
- Its transform places the referenced scene. Its `props` may override the referenced
  root's effective fields and the scene's promoted fields, but nothing else.
- Internals are atomic and read-only from the host. The only cross-boundary attachment
  is a declared slot.
- Promotions reach direct children only and are edited in the Public surface drawer.
- A slot names a child transform; a host entity attaches with `parent` plus `slot`.
- Removing a slot or promotion, a wrong target, a missing scene, a cycle, or an
  attachment to an undeclared slot is a validation error with jump-to-entity.

### Debug expansion

The **Debug expansion** drawer resolves scene instances, promotions, and slot
attachments into a flat runtime-shaped entity list. It removes scene boundaries, keeps
parent links and local transforms, remaps instance IDs, and shows the resolved property
values. It is computed in memory and is never saved; the actual build remains a CLI/CI
concern.

## M2 scope

Included: project import map, project-wide validation, New Scene, scene/level editing,
three.js viewport, schema-generated inspector, palette, asset placement, scene
instances, direct-child field and event promotions, slots, host attachments, input
entity refs, undo/redo, and debug expansion.

Not included: events runtime harness, generators, build/bake, lightmaps, 2D orthographic
views, and cross-file refactors. Those remain their own milestones.

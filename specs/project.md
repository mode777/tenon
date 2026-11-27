# Tenon

> A browser-based, schema-driven 3D entity and scene editor delivered as one Exo editor plugin.

## Scope

- **In:** authoring schema bundles, project manifests, reusable scenes and levels, and
  scene composition (instances, promotions, slots); live validation; one Exo plugin with
  format-specific frame editors; demo workspaces; static deployment.
- **Out:** engine runtime and engine classes; CLI build, bake, and playtest; runtime event
  execution; generators; lightmaps; 2D views; mesh, UV, or material authoring; cross-file
  refactors; Exo workspace internals.

## Users

- **Technical designer** — authors schemas, scenes, and levels in the browser without
  hand-editing JSON.
- **Engine/runtime developer** — consumes the schema contract and runtime build; relies on
  qualified concrete definition IDs and flat runtime properties.
- **Project maintainer** — installs the Exo plugin, pins compatible shell and SDK versions,
  and runs the demo workspaces.

## Goals

- Author a schema bundle with definitions, composition, fields, enums, events, imports, and
  live validation, then save and reload it. (`../docs/roadmap.md` M1)
- Edit the project import map and validate every schema and scene in one project.
  (`../docs/roadmap.md` M2)
- Author scenes and levels with a 3D viewport, entity placement, transforms, hierarchy,
  assets, scene instances, promotions, and slots. (`../docs/roadmap.md` M2)
- Keep authoring data engine-agnostic; the plugin edits and validates authoring JSON and
  never writes runtime build output. (`../AGENTS.md` model invariants)
- Run as one Exo plugin; the shell owns workspace, tabs, dirty state, saves, consent, and
  theme. (`../AGENTS.md` editor host invariants)
- Keep format editors generic so adding a definition does not require editor code.
- Demonstrate M1/M2 end to end in the example workspaces. (`../examples/`)

## Non-goals

- Runtime event execution, generators, lightmap baking, runtime build, and playtest; these
  are design-only M3–M6. (`../docs/roadmap.md`)
- A general-purpose 3D modeling tool; Tenon does not author meshes, UVs, or materials.
- Authoring engine behavior or engine classes; behavior lives in the engine.
- Editing `exo.json` or `.exo/**`, or managing multiple projects in one workspace.
- Cross-file refactors and background rewrites.
- A plugin-hosted build pipeline or build artifact writer.

## Glossary

- **Schema bundle:** versioned, namespaced JSON containing enums and entity definitions.
- **Definition:** an entity type declaration. A concrete definition is instantiable; an
  abstract definition is non-instantiable and hidden from the palette.
- **Composition:** schema/build-time inclusion of fields, defaults, and events from other
  definitions. It never contributes engine classes, behavior, or instantiability.
- **Project:** a workspace rooted at `project.json`, which maps schema namespaces to
  locations. One Exo workspace is one Tenon project.
- **Scene:** a saved entity tree with one root, reusable and instanceable.
- **Level:** a scene document under `levels/` used as the top-level world.
- **Scene instance:** an atomic node that references another scene, carries a transform, and
  overrides root or promoted properties.
- **Promotion:** an alias from a direct child field or event to the scene root.
- **Slot:** a named child transform exposed by a scene for host attachment.
- **Format editor:** the Exo frame for one authoring format. Current formats are project,
  schema, and scene/level; the generator editor is planned.
- **Runtime build:** engine-specific output produced outside the plugin by the Tenon
  CLI/CI. It is not authored or written by this repository's plugin.
- **`basic3d`:** builtin, immutable, read-only schema shipped with both the plugin and the
  engine.

## Current status

M1 and M2 are implemented. The plugin ships the project hub, New Schema and New Scene
commands, the schema editor, the project import-map editor with project-wide validation, and
the scene/level editor with the three.js viewport, shell Hierarchy & Assets/Inspector/
Inspection panels, entity and scene palettes, asset placement, scene instances, promotions,
slots, attachments, undo/redo, and save/conflict handling.

M3 (events), M4 (generators and bake), M5 (lightmaps), and M6 (1.0 evaluation) remain
design-only. Do not describe their behavior as current.

## Evidence

- `../README.md` — implemented scope and status.
- `../docs/editor-concept.md` — core model and authoring workflow.
- `../docs/roadmap.md` — milestone definitions and M1/M2 acceptance.
- `../docs/technical-decisions.md` — data model, pipeline, formats, and host boundary.
- `../AGENTS.md` — model and editor host invariants.
- `../examples/m1-workspace/` and `../examples/m2-workspace/` — runnable demos.

# Module: Core model

Purpose: pure parsing, resolution, validation, and authoring transformations shared by every
format editor. | Code: `plugin/src/core/`

## Responsibilities

- Parse and serialize schema bundles, project manifests, and scene documents without silently
  losing unknown JSON.
- Resolve schema packages from `project.json`, local `schemas/*.schema.json`, and HTTPS
  locations; hash package text.
- Resolve definition composition, effective fields/events, enums, defaults, and schema
  validation across own, builtin, and imported bundles.
- Analyse a project: resolve schema locations, validate every schema and scene, and report
  build readiness.
- Derive scene surfaces, entity properties/events, slot attachments, and the flattened debug
  expansion of scene instances.
- Provide workspace loading through a narrow SDK-facing client interface and per-document
  undo/redo state.

## Interface

- **Schema:** `parseSchemaText`, `schemaToText`, `validateSchema`, `effectiveDefinition`,
  `resolveSchemaImports`, `lookupDefinition`, `lookupEnum`, `renameNamespaceInBundle`.
  (`plugin/src/core/schema.ts`)
- **Project:** `parseProjectText`, `projectToText`, `analyzeProject`,
  `projectBuildCommand`, `parseImportLocation`. (`plugin/src/core/project.ts`)
- **Scene:** `parseSceneText`, `sceneToText`, `validateScene`, `sceneSurface`,
  `entityProperties`, `entityEvents`, `expandScene`, `addEntity`, `addSceneInstance`,
  `setEntityParent`, `setEntityTransform`, `setEntityProp`, `addPromotion`, `addSlot`.
  (`plugin/src/core/scene.ts`)
- **Workspace:** `loadWorkspace(client)` reads `project.json`, schema packages, scene
  packages, and `assets/`; returns typed issues when listing or parsing fails.
  (`plugin/src/core/workspace.ts`)
- **History:** `useHistory(initial, clone)` provides frame-local undo/redo. A document frame
  owns its history; no history is shared across frames. (`plugin/src/core/history.ts`)

## Relevant details

- **Schema identity.** A bundle has `id`, `namespace`, and `version`; definitions use
  `namespace:LocalName`. `basic3d` is builtin, immutable, and never listed in `imports`.
  Imported definitions are read-only and compose like builtin definitions; imported enums
  are referenced as `namespace:Enum`. (`plugin/src/core/schema.ts`, TD-25, TD-29)
- **Composition.** `effectiveDefinition` flattens the composition DAG, reports cycles and
  field/event collisions, resolves defaults, and records one origin per field. Composition
  contributes fields, defaults, and events only. (`plugin/src/core/schema.ts`, TD-24)
- **Project resolution.** `analyzeProject` maps namespaces to builtin/local/remote bundles,
  checks scene requirements against resolved versions, validates all scenes, and counts
  errors/warnings. `ready` is true only when there are no errors.
  (`plugin/src/core/project.ts`)
- **Scene boundaries.** `validateScene` checks IDs, requirements, transforms, hierarchy,
  scene instances, slots, promotions, property visibility, and references. `sceneSurface`
  derives the public surface; `expandScene` resolves instance boundaries for debug display
  without writing anything. (`plugin/src/core/scene.ts`, TD-07, TD-08, TD-10, TD-30)
- **Defaults.** Field defaults resolve through definition composition, then the instance.
  A field without a default is required. Omitted transforms are identity. (`plugin/src/core/`,
  TD-20, TD-24)
- **Unknown fields.** Parsers preserve unknown object keys via index signatures; the schema
  editor reports unsupported deferred field types rather than dropping them.
  (`plugin/src/core/schema.ts`, `docs/schema-editor-ui.md`)
- **Workspace boundary.** The core never receives a file handle or writes files. It reads via
  `readFile`/`listDirectory` and returns data/issues to a frame, which owns save and dirty
  state. (`plugin/src/core/workspace.ts`, TD-26)

## Dependencies

- **Uses:** `@exo/plugin-sdk` types/errors at the workspace edge; browser `fetch` for remote
  schema packages.
- **Used by:** project hub, project editor, schema editor, scene editor, and Inspector/
  Inspection panels.

## Decisions

| Decision | Why | Source |
|---|---|---|
| Keep parsing/validation pure and frame-agnostic | Editors share one rule set; tests cover the model without the shell | `plugin/src/core/*.test.ts` |
| Flatten composition before runtime; one origin per field | Avoid runtime inheritance and ambiguous defaults | TD-24 |
| Keep scene instances atomic; surfaces and slots are the only boundary | Protect internals and make reuse safe | TD-07, TD-08, TD-10 |
| Validate live and never block Save | Preserve incomplete authoring work | TD-16 |

# Feature: Schema authoring

The schema editor authors one schema bundle at a time: identity, imports, definitions,
composition, fields, enums, events, effective view, and validation. Imported and builtin
bundles are read-only.

## Requirements

- `SCHEMA-ROUNDTRIP` — Open, edit, save, and reload without data loss.
  The schema editor shall open a `schemas/*.schema.json` bundle, edit its supported content,
  and save it through the shell without losing unknown JSON; unsupported field types shall be
  preserved and reported, not dropped.
  Why: authoring files may be newer or hand-edited; silent loss would corrupt source data.
  Fit: save, reopen, and compare definitions, imports, enums, events, and preserved keys.
  Evidence: `plugin/src/core/schema.ts`, `plugin/src/schema/SchemaEditor.tsx`,
  `docs/schema-editor-ui.md`.

- `SCHEMA-IDENTITY` — Edit bundle identity safely.
  The schema editor shall edit the bundle `id`, `namespace`, and `version`; changing the
  namespace shall rewrite this bundle's definition IDs and local qualified references only.
  Why: schema identity is `namespace@version`, and cross-file rewrites are out of scope.
  Fit: the open bundle updates; another file referencing the old namespace reports a
  validation error and is not rewritten.
  Evidence: `plugin/src/core/schema.ts` (`renameNamespaceInBundle`),
  `plugin/src/schema/SchemaEditor.tsx`, TD-29.

- `SCHEMA-DEFINITIONS` — Author definitions.
  The schema editor shall create, rename, and delete abstract and concrete definitions and
  edit their documentation and composition.
  Why: definitions are the core authoring unit.
  Fit: a definition can be authored end to end without hand-editing JSON.
  Evidence: `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/core/schema.ts`.

- `SCHEMA-COMPOSITION` — Compose definitions.
  The schema editor shall compose own, builtin, and imported definitions; composition shall
  contribute fields, defaults, and events only, reject cycles and field/event collisions, and
  show an effective view with origin badges.
  Why: composition is the schema's reuse mechanism and must not imply engine inheritance.
  Fit: a composed definition shows inherited fields/events with origins; an invalid cycle or
  collision is a validation issue.
  Evidence: `plugin/src/core/schema.ts` (`effectiveDefinition`, `wouldCreateCycle`),
  `plugin/src/schema/SchemaEditor.tsx`, TD-24, TD-27.

- `SCHEMA-FIELDS` — Author typed fields and defaults.
  The schema editor shall author fields with `string`, `int`, `float`, `bool`, `enum`,
  `color`, `vec2`, `vec3`, `assetRef`, and `entityRef` types, type-aware defaults, and
  required-by-absence semantics; `array<T>`, `flags`, and `nullable` shall be preserved but
  deferred.
  Why: field metadata drives the scene Inspector and runtime property list.
  Fit: each MVP type can be added and defaulted inline; a deferred type remains intact.
  Evidence: `plugin/src/core/schema.ts` (`MVP_FIELD_TYPES`, `DEFERRED_FIELD_TYPES`),
  `plugin/src/schema/SchemaEditor.tsx`, `docs/schema-editor-ui.md`.

- `SCHEMA-IMPORTS` — Pin and resolve schema packages.
  The schema editor shall declare imports as exact `namespace@version` dependencies, expose
  resolved imported bundles read-only, and reference imported enums as `namespace:Enum`;
  `basic3d` shall be implicit, read-only, and never listed as an import.
  Why: imports need stable identity and must not be edited through the consumer.
  Fit: an imported definition composes; an imported enum appears qualified; `basic3d` is
  pinned and read-only.
  Evidence: `plugin/src/core/schema.ts` (`resolveSchemaImports`),
  `plugin/src/schema/SchemaEditor.tsx`, TD-25, TD-29.

- `SCHEMA-ENUMS` — Author ordered enums.
  The schema editor shall create, rename, and delete enums and reorder, add, rename, and
  delete their values; a field default or reference to a missing value shall be a validation
  error.
  Why: enum values are part of the schema contract and must not silently fall back.
  Fit: changing an enum updates the enum table and dependent validation.
  Evidence: `plugin/src/core/schema.ts`, `plugin/src/schema/SchemaEditor.tsx`,
  `docs/schema-editor-ui.md`.

- `SCHEMA-EVENTS` — Declare events and payloads.
  The schema editor shall declare events with optional typed payload fields, inherit events
  through composition, and reject duplicate event names and invalid payload fields.
  Why: events are the schema's output contract; runtime binding is outside the editor.
  Fit: an event with a typed payload appears in the effective view; a duplicate is an error.
  Evidence: `plugin/src/core/schema.ts`, `plugin/src/schema/SchemaEditor.tsx`, TD-09.

- `SCHEMA-VALIDATION` — Validate live and jump to issues.
  The schema editor shall validate the open bundle and its imports continuously, mark the
  offending definition/field/event/enum, and provide a jump action; errors shall not block
  Save.
  Why: authors need actionable feedback without a separate validation step.
  Fit: a deliberately broken reference shows an error and focuses the offending control;
  Save still works.
  Evidence: `plugin/src/core/schema.ts` (`validateSchema`),
  `plugin/src/schema/SchemaEditor.tsx`, TD-16.

- `SCHEMA-UNDO` — Per-document history.
  The schema editor shall provide undo and redo for the open document without sharing history
  with another frame.
  Why: edits are exploratory and must be reversible; frames must not share mutable state.
  Fit: Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z reverse and replay edits in this frame only.
  Evidence: `plugin/src/core/history.ts`, `plugin/src/schema/SchemaEditor.tsx`,
  `AGENTS.md`.

- `SCHEMA-ISOLATION` — No scene or viewport code.
  The schema editor frame shall not load three.js or scene editor code.
  Why: keep the schema surface small and avoid coupling formats.
  Fit: the schema bundle does not import the scene viewport.
  Evidence: `plugin/src/schema/main.tsx`, TD-27.

## Sources

- `plugin/src/schema/`
- `plugin/src/core/schema.ts`
- `plugin/src/core/history.ts`
- `docs/schema-editor-ui.md`
- `docs/technical-decisions.md` TD-04, TD-05, TD-09, TD-16, TD-24, TD-25, TD-27, TD-28, TD-29

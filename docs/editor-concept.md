# Tenon Editor Concept

Tenon is a browser-based 3D editor for building entity-based scenes. It is schema-driven and data-only: the editor defines and places entities, scenes compose them, and the engine interprets concrete definitions at runtime.

The editor is designed as one Exo editor plugin. The Exo shell owns the workspace, tabs, dirty state, saves, consent, and theme; Tenon contributes one visual editor per authoring format. The engine and build runner stay outside the editor frame.

A **level** is simply a scene document used as the top-level world.

## Core model

| Concept | Definition |
|---|---|
| **Schema bundle** | A versioned, namespaced JSON file containing enums and entity definitions. Builtin, project-local, or remote; it can import other bundles as versioned packages. |
| **Schema package** | A declared, exactly versioned schema import. Its definitions are read-only and compose like builtin definitions; its enums are referenced as `namespace:Enum`. |
| **Entity definition** | A named schema entry with fields, defaults, optional events, and optional composition. Concrete definitions are instantiable; abstract definitions are not. |
| **Abstract definition** | A non-instantiable definition used as a base or mixin. Hidden from the entity palette and has no engine class. |
| **Definition composition** | A schema/build-time `compose` list that includes fields, defaults, and events from abstract or concrete definitions. Flattened before runtime; never runtime inheritance. |
| **Entity instance** | A placed entity with a stable local ID, display name, concrete definition ID, transform, property values, and optional parent/slot. |
| **Scene** | A saved entity tree with one root entity. Reusable and instanced. |
| **Scene instance** | A node that references a scene document, carries its own transform, and supplies overrides for its promoted properties. Atomic from the outside. |
| **Promotion** | An alias from a direct child field or event to the scene root. Defines public API. |
| **Slot** | A named transform exposed by a scene where a host may attach an entity. |
| **Event** | A named output with an optional typed payload. Declared by a definition, emitted by the engine class. |
| **Generator** | A parameterized asset source. Runs in the editor/build; bakes to a static mesh. |

Definitions are flat after composition. Composition is schema/build-time and data-only:
it includes fields, defaults, and events, never engine classes or behavior. Abstract
definitions are hidden and non-instantiable; concrete definitions are instantiable and
map to one engine class. Transforms are built-in placement data, not fields.

## Schema

- Project schema bundles are checked in; remote bundles resolve through imports. Builtin bundles ship with the Tenon plugin and engine (TD-25).
- Each bundle declares a namespace and a version.
- A bundle may import other schemas as versioned packages (`imports`), then compose their definitions or reference their enums (TD-29). Imported definitions are read-only.
- The project manifest maps namespaces to locations; scenes require `namespace@version`.
- `basic3d` is the builtin default. Its reference schema is [basic3d.schema.json](basic3d.schema.json). It is read-only and extended by composition, not edited.
- The schema editor is a first-class part of Tenon. Definitions, abstract flags, composition, fields, enums, defaults, and events are authored there. The bundle namespace is editable; changing it rewrites this bundle's own qualified IDs.
- The engine aligns to the schema. The schema is the shared data contract for editor UI, validation, and engine registration.
- Definitions are data-only. Behavior is implemented by the engine class.
- Field defaults resolve as: **composed definition default → composing definition override → instance value**. A field without a default is required.
- Each inherited field has one origin definition. Two different origins with the same field name are a schema error; a definition may override an inherited default only with the same field type.
- Abstract definitions are hidden from the palette, cannot be scene roots, and have no engine class.
- A concrete definition may be composed into another definition from the same bundle, builtin `basic3d`, or a declared import. Only its fields, defaults, and events contribute; it remains instantiable, and its engine class is not inherited.
- Transforms are not part of the schema. Every entity instance has one (see [Transforms](#transforms)).
- At runtime, composition is flattened into one flat property list. The engine never sees definitions, imports, or composition.

## Default scene

A new empty scene pins the current builtin schema and starts with one `basic3d:node` root:

```json
{
  "id": "scene_empty",
  "requires": ["basic3d@1.0.0"],
  "root": "root",
  "entities": [{ "id": "root", "type": "basic3d:node" }],
  "promotes": {},
  "slots": {}
}
```

## How an entity is created

1. Define or select a concrete definition in the schema editor.
2. Add fields directly or compose abstract and concrete definitions. Set defaults, enums, documentation, and editor hints.
3. Declare any events the definition can emit, or inherit them through composition.
4. Open a scene or level and choose a concrete definition from the entity palette.
5. Place the entity in the viewport. Tenon creates an entity instance with a stable local ID, a default display name, and an identity transform.
6. The inspector shows the definition's effective fields. Values start from defaults; the instance stores only property overrides.
7. Optionally parent the entity to another entity, or attach it to a scene instance's slot.
8. Save the scene document. No per-definition editor code is required; the format editors are generic.
9. At build/runtime, the `type` ID (the `classname` equivalent) selects an engine class. It is identity, not a property, and is never part of the flattened property list. The runtime keeps the entity hierarchy, composes transforms through it, and gives the engine the composed transform and flat property list.

## How a scene is created

1. Create a new scene document and choose the root entity's concrete definition. The root is an entity, not a scene instance, and cannot be abstract.
2. Add child entities and parent them into a hierarchy.
3. Promote direct child fields and events to the scene root. Promotions define the scene's public surface.
4. Declare slots: named child transforms where hosts may attach entities.
5. Save the scene. It can now be instanced in another scene or level.
6. To use it, add a scene instance node, point it at the scene document, place it with a transform, and override root fields or promoted properties.
7. Attach host-owned entities to slots when the scene needs external content.
8. A scene instance is atomic from the outside: its internal entities are read-only from the host scene. Host-owned content attaches only through declared slots.
9. Validation checks scene requirements, promotions, slots, references, and hierarchy.

## Public surface and scene composition

A scene's public surface is:

- the root entity's effective fields, including composed fields;
- the root entity's effective events, including composed events;
- fields promoted from direct children;
- events promoted from direct children;
- declared slots.

Compatibility is structural. If the promoted fields and events exist with the right types, the scene can be composed.

Promotions reach **direct children only**. No deep paths. Each composition layer promotes what it wants to expose.

Promoted names are public API. A scene should treat renaming or removing a promoted field or event as a breaking change.

## Entity references

- Entity IDs are stable and local to the scene document.
- Display names are labels only; references never resolve by name.
- When a scene is instanced, internal IDs are remapped into instance scope.
- Internal references point to entities within the same scene.
- A promoted property may be an **input entity ref**: the host passes a reference into the scene, and the scene forwards it to an internal entity.
- A scene does not expose internal entities outward. Hosts never receive references to scene internals.

## Hierarchy and boundaries

- A scene may contain an arbitrary-depth tree of entities and scene instances.
- Every entity has one parent or is the root. Cycles are invalid.
- Hierarchy expresses parent-child transforms, not ownership. Use references for gameplay links.
- A scene instance is one node in the host tree. Its internal tree is private.
- The only way to attach content across a scene boundary is a declared slot.
- Attachments are owned by the host scene, even though they are spatially parented to a slot inside the instance.
- At build time, a slot attachment becomes a concrete parent link in the resolved hierarchy; the slot name itself is authoring metadata.
- Scene instances may contain other scene instances; their boundaries remain atomic.

```text
Level
└─ train_1                    scene instance, atomic from outside
   ├─ body                    internal, read-only from the level
   ├─ wheels                  internal, read-only from the level
   └─ slot: button_0          declared attachment point
      └─ button_1             host-owned entity attached to the slot
```

## Transforms

Every entity instance has a transform: position, rotation, and scale. It is built-in
placement data, not a schema field or definition, and it is stored outside `props`.

- An omitted transform or omitted component defaults to identity.
- The viewport and the scene Inspector panel edit transforms directly; the schema
  editor does not.
- Hierarchy composes transforms from parent to child. A scene instance's transform
  places the referenced scene; the scene root stays relative to the instance.
- Building does not flatten the transform hierarchy. Scene boundaries and slot names
  resolve into concrete parent links, so moving an elevator still moves an attached
  button at runtime (TD-23).
- Transforms are never promoted. A host positions a scene instance, not its internal
  entities. Slots expose a named child transform for attachment, and an attached
  entity's transform is relative to the slot.
- Every entity has a transform, including non-visual and data-only entities.

## Events

Events are named outputs. They are conceptually clear and keep internals private.

- A definition declares the events it can emit. Composed definitions contribute their event declarations.
- A payload is optional and typed using the same field types as properties.
- The engine class implements what the event means, when it fires, and how the payload is produced.
- A scene promotes direct child events to its root.
- The host or engine binds promoted events by name.
- Payload fields are values only. Do not expose internal entity references; host-scoped references or sentinels are allowed when needed.

A button inside a train can stay internal. The train promotes `buttonPressed`; the level reacts. The level never sees the button entity.

## Generators

Generators are parameterized asset sources.

- A generator definition declares a parameter schema and a script or graph entry point.
- A generator instance stores parameter values and a seed.
- The editor runs generators to produce preview meshes.
- The authoring document stores the generator reference, parameters, seed, and version/hash. It does not store the generated mesh.
- At build time, the generator is baked to a static mesh for the runtime.
- A generator produces an **asset**, not runtime entities. It becomes a baked mesh.
- Interactive parts are separate entities. A house generator can produce the shell and door opening; the door is a separate runtime entity with its own behavior.
- Generator parameters use the same field types and defaults as schema fields.

## Imported meshes

An imported mesh file such as `.glb` is an **asset**, not an entity. The file lives
under `assets/` and is available to `assetRef` fields; it does not create scene
nodes. An `assetRef` stores either a workspace-absolute path (`/assets/foo.glb`) or
a path relative to the containing scene (`../assets/foo.glb`).

The Exo shell owns the workspace. The user adds the file to `assets/` in the
workspace folder; the editor browses and selects it. The Tenon plugin never copies
an external file and never receives a file handle.

To place one:

1. Use a mesh definition (for example `basic3d:mesh`) that exposes an `assetRef` field.
2. Place an instance and pick the asset through the shell picker or asset browser.
3. Position it with the entity transform.

Multiple entities may reference one asset. A glb's internal nodes and transforms are
asset data, not entities; split out parts that need their own behavior into separate
assets and entities. Tenon does not author the mesh, UVs, or materials.

## Authoring and runtime

Tenon has two distinct outputs:

- **Authoring documents** — editable JSON. Source of truth. Entities, scenes, schema references, generator parameters, promotions, and bake settings.
- **Runtime bake** — generated build output. Baked meshes, lightmaps, resolved entity instances, local transforms and parent links, flat properties, and event bindings as needed. No generators, editor metadata, or authoring data.

The editor edits authoring documents and saves them through the Exo shell. Build and playtest run outside the editor frame: the Tenon CLI/CI writes the bake, and the playtest runner loads it. The plugin never writes build output. The runtime never runs generators or bakes lightmaps. The build resolves scene composition boundaries, not the entity transform hierarchy; the runtime keeps the resolved parent links so dynamic parent movement propagates to children.

Lightmaps, navmeshes, collision meshes, LODs, and occlusion data are bake artifacts. Their settings live in authoring; their results live in the runtime build.

## Editor host and format editors

Tenon runs as one Exo editor plugin. The Exo shell owns the workspace, file tree,
tabs, breadcrumbs, Save/Save All, dirty indicators, external-change notices,
consent, and theme. Tenon owns the document area inside each editor frame. It
never reads, writes, or lists `exo.json` or `/.exo/**`, and it never receives a
filesystem handle.

The plugin contributes one visible frame editor per authoring format:

| Editor | Opens | Main surface |
|---|---|---|
| **Project** | `project.json` | Import map, resolved schema versions, project-wide validation, build readiness |
| **Schema** | `schemas/*.schema.json` | Definition tree, composition, fields, enums, defaults, events, read-only builtins |
| **Scene** | `scenes/*.scene.json`, `levels/*.scene.json` | Hierarchy, 3D viewport, entity/scene/asset library, shell Inspector/Inspection panels, promotions, slots |
| **Generator** | `generators/*/generator.json` | Parameter form, seed, preview, bake settings |

A level is a scene document used as the top-level world, so it opens in the scene
editor with level-only controls. There is no separate level format and no level
field in the document; the `levels/` path selects level mode.

One project-level Tenon panel is the creation hub. It lists schema bundles and
scene/level documents and hosts **New Schema** and **New Scene**. The panel is also
the target of the `tenon.new-schema` and `tenon.new-scene` commands, so the same
actions are available from the Exo command palette. A live command invocation lets
the panel create the file through the shell-owned dialog and open it in its format
editor. The hub is not a document editor and has no dirty state.

The scene editor also contributes two document-scoped shell panels: a secondary
Inspector and a bottom Inspection panel. They follow the active scene/level editor and
exchange snapshots and commands with it; the editor remains the only document owner.

The editors are per format, not per definition. Adding a concrete definition is
a schema edit; it does not add a page, a glob, or editor code. The schema editor is
M1; the project and scene/level editors are M2, and the generator editor follows.

### Scene and level editor

- 3D viewport with selection, transform gizmos, grid, and snapping.
- Scene hierarchy panel.
- Schema-generated property Inspector shell panel.
- Entity palette showing concrete definitions only.
- Asset browser for meshes in `assets/`.
- Scene instance inspector for root and promoted overrides.
- Promotion and slot editors in the Inspection panel's Public surface tab.
- Validation and debug expansion in the Inspection bottom panel.
- 2D orthographic views are a later addition.

A scene instance is atomic in the editor: its internals are read-only from the
host scene, and host content attaches only through declared slots.

### Schema editor

- Editable bundle identity: `id`, `namespace`, and `version`.
- Definition tree grouped by namespace, with abstract and concrete definitions.
- Imported schema packages shown read-only; import add/remove in the sidebar.
- Forms for composition, fields, enums, defaults, events, and documentation;
  editor hints are a later schema feature.
- Composition picker that spans own, builtin, and imported definitions, prevents
  cycles, and shows effective fields and events.
- Read-only view of the builtin `basic3d` bundle shipped with the plugin.
- Schema validation for imports, cross-bundle composition, enums, and defaults with
  actionable errors.
- No behavior, engine class, or script authoring.

The schema editor UI and its M1 scope are specified in [Schema editor UI](schema-editor-ui.md).

### Project editor

- Import map from namespaces to builtin, project-relative, or HTTPS locations.
- Resolved schema versions and content hashes.
- Project-wide validation across schemas, scenes, generators, and assets.
- Build readiness and the exact build command. Builds and playtests run outside
  the editor frame.

### Generator editor

- Parameter form generated from the generator parameter schema.
- Seed, preview, and bake settings.
- Generator script entry opens in a code editor; Tenon references it but does not
  author generator code.

### Frame rules

- Each open document gets its own frame, buffer, selection, and undo history.
- The shell owns Save, Save All, dirty state, and conflict notices. A Tenon frame
  reports dirty honestly and returns content only through its save handler.
- External changes never silently replace a dirty buffer.
- A read-only workspace opens the editor read-only; Save and dirty state are
  unavailable.
- References open through the shell's open-file action; a frame does not reach
  into another frame.
- Frames use the Exo theme tokens and support dark, light, and high contrast.
- Frames do not recreate shell chrome, and every page stays inside the plugin
  root.

The editor is not a modeling tool. Geometry comes from imported meshes and parametric generators. UV, material, and behavior authoring live outside Tenon.

## Example scene document

```json
{
  "id": "scene_door",
  "requires": ["basic3d@1.0.0", "gameA@1.0.0"],
  "root": "root",
  "entities": [
    { "id": "root", "type": "basic3d:node" },
    {
      "id": "hinge",
      "type": "gameA:hinge",
      "parent": "root",
      "transform": { "position": [0, 0.5, 0] },
      "props": { "open": 0 }
    },
    {
      "id": "handle_anchor",
      "type": "basic3d:node",
      "parent": "root"
    }
  ],
  "promotes": {
    "openAmount": { "entity": "hinge", "field": "open" },
    "onOpened": { "entity": "hinge", "event": "opened" }
  },
  "slots": {
    "handle_0": { "entity": "handle_anchor" }
  }
}
```

A scene instance uses `scene` instead of `type`:

```json
{
  "id": "door_1",
  "scene": "/scenes/door.scene.json",
  "transform": { "position": [3, 0, 0] },
  "props": { "openAmount": 0.5 }
}
```

Scene and `assetRef` references are either workspace-absolute (`/scenes/…`,
`/assets/…`) or relative to the containing scene (`../assets/…`). The scene editor
writes the workspace-absolute form when picking from the scene or asset list and
resolves both forms when loading.

The root and `handle_anchor` omit transforms, so they use identity transforms. The scene
instance transform places the whole door scene.

## Workflow summary

```text
open project in Exo → define/import schemas → create scene/entities → compose scenes → validate → build (CLI/CI) → playtest
```

Authoring happens in the Tenon format editors inside Exo. The build and playtest
runner stay outside the plugin. The editor stays generic; the schema defines the
vocabulary, the engine implements it, and the data composes it.

# Technical Decisions

This document records the implementation-shaping decisions for Tenon. The guiding rule is simplicity: one entity model, one scene model, one schema contract, one editor plugin, and one build step.

## TD-01 — Scope and separation

Tenon is a browser-based 3D entity and scene editor, designed as an Exo editor
plugin (TD-26).

- The editor is data-only. It defines, places, composes, and validates authoring data.
- Engine classes implement behavior and interpret concrete definitions at runtime.
- Geometry comes from imported meshes and parametric generators.
- Tenon does not author geometry, UVs, materials, or behavior.
- Authoring is engine-agnostic. The runtime build may be engine-specific.
- Build and playtest run outside the editor frame; the plugin never writes build output.

## TD-02 — Pipeline stages

| Stage | Purpose | Output |
|---|---|---|
| **Design time** | Author schema, scenes, entities, generator parameters, bake settings | Editable authoring JSON |
| **Build time** | Validate, resolve composition, run generators, bake assets | Runtime build |
| **Runtime** | Load, instantiate entities, apply properties, emit events, simulate, render | Running experience |

Design-time previews may invoke build steps, but preview results remain artifacts. They are never the source of truth.

Design-time UI runs in the Tenon Exo plugin. Build time runs in the Tenon CLI/CI,
not in the plugin frame; the plugin never writes build output (TD-26).

| Resource | Design time | Build time | Runtime |
|---|---|---|---|
| Schema / definitions | Author definitions, abstract flags, composition, fields, enums, defaults, events | Validate; flatten definition composition; generate validators | Engine class registry uses concrete type IDs |
| Scene composition | Place entities and scene instances; promote fields/events; declare slots | Resolve scene instances; validate refs/slots; remap IDs; resolve slot attachments | Instantiate entities and hierarchy; no scene composition |
| Placement / transforms | Position, rotate, scale; parent; attach to slots | Resolve hierarchy; keep local transforms and parent links; cache initial world transforms | Spawn in hierarchy; propagate dynamic transforms to children |
| Property values | Author defaults and overrides | Resolve effective flat property list | Apply on spawn; mutate through gameplay |
| Events | Declare events on definitions; promote child events | Preserve declarations; resolve bindings | Emit/dispatch |
| Parametric geometry | Set generator, parameters, seed; preview | Run generator; bake mesh | Load baked mesh |
| Imported meshes | Browse and reference an existing asset; place | Optimize; compress; generate LODs | Load and render |
| Materials / textures | Assign materials; set parameters | Compress textures; cook materials | Upload, bind, sample |
| Lightmaps | Place lights; set bake settings; choose UV channel | Bake GI; build atlas; generate lightmap UVs | Sample lightmaps |
| Light / reflection probes | Place probes; set settings | Bake probe data | Interpolate and sample |
| Navmesh | Set agent/bake settings; mark walkable areas | Voxelize and bake | Pathfinding queries |
| Collision meshes | Author simple shapes/settings | Generate, merge, validate | Physics queries and simulation |
| Physics bodies / joints | Configure bodies and joints | Validate and convert | Simulate |
| Skinning | Rig, weights, bind pose | Optimize and compress bone data | Animate; compute skin matrices |
| Animation clips | Author/import; add events; set root motion | Compress and optimize | Sample, blend, play |
| LODs | Set thresholds and settings | Generate decimated meshes | Select LOD |
| Occlusion / culling | Set bake settings; mark occluders | Bake occlusion data | Cull |
| Shaders | Author shader/graph | Compile and permute variants | Create pipeline |
| Audio | Place and configure | Compress and stream | Play |
| Level streaming | Partition and layout | Pack chunks | Stream, load, unload |
| Localization | Author strings | Compile lookup tables | Select string |
| Input mappings | Author bindings | Validate and package | Poll and bind |
| Save data | Define schema | — | Read and write |
| Particle / VFX | Author systems | Optimize/bake | Simulate and render |
| Destruction | Author settings | Pre-fracture and bake pieces | Simulate |

## TD-03 — Project layout

A project is a directory and the Exo workspace root. One Exo workspace is one Tenon project. Local file references are relative; schema imports may also resolve builtin or remote bundles.

```text
project/                 # Exo workspace root = Tenon project root
├─ exo.json              # Exo shell config (optional); Tenon never reads or writes it
├─ .exo/                 # Exo shell metadata (optional)
├─ project.json          # Tenon project manifest
├─ schemas/
│  ├─ gameA.schema.json
│  └─ shared.schema.json
├─ scenes/
│  └─ door.scene.json
├─ levels/
│  └─ level01.scene.json
├─ generators/
│  └─ floorRing/
│     ├─ generator.json
│     └─ generator.mjs
├─ assets/
└─ build/
   └─ level01/
      ├─ manifest.json
      ├─ entities.json
      ├─ meshes.bin
      └─ lightmaps/
```

`project.json` maps namespaces to schema locations:

```json
{
  "imports": {
    "gameA": "schemas/gameA.schema.json",
    "shared": "https://schemas.example.com/shared@2.0.0.schema.json"
  }
}
```

`project.json` is Tenon's manifest. `exo.json` and `.exo/**` are Exo-owned: Tenon
never reads, writes, or lists them, and no Tenon format references them. The
Tenon plugin is installed through the Exo settings surface, not by editing a
Tenon file.

A schema bundle's own `imports` map declares the package versions it depends on;
`project.json` remains the project-level map from namespace to location (TD-29).
`basic3d` is builtin and needs no import entry. Project schemas are checked in;
builtin and remote schemas resolve through the import map (TD-25). A level is a scene
document used as the top-level world; `scenes/` and `levels/` share the same document
format.

## TD-04 — Schema bundles

A schema bundle is a versioned, namespaced JSON document.

```json
{
  "id": "com.example.gameA",
  "version": "1.0.0",
  "namespace": "gameA",
  "imports": {
    "shared": "1.0.0"
  },
  "enums": {},
  "definitions": {}
}
```

- The schema editor is a first-class part of Tenon and one of the plugin's file editors (TD-26).
- Project schema bundles are checked into the project. Builtin bundles ship with the Tenon plugin and engine; remote bundles resolve through the project import map (TD-25).
- `basic3d` is the builtin default. Its reference schema is [basic3d.schema.json](basic3d.schema.json).
- Definition IDs are qualified: `basic3d:mesh`, `gameA:button`. Abstract and concrete definitions share the same ID scheme.
- A concrete definition's ID is its runtime type ID.
- A schema bundle may import other schema packages by namespace and exact version (TD-29).
- Scenes declare the exact bundle versions they require: `"requires": ["basic3d@1.0.0"]`.
- A project resolves one version per namespace. Composition is valid when the project provides all required bundles.
- The engine aligns to the schema. The schema is the shared contract for editor UI, validation, and engine registration.
- Definitions are flat after composition. A definition may compose abstract or concrete definitions from its own, builtin, or imported bundles (TD-24, TD-29).
- Transforms are a fixed built-in contract, not schema fields or definitions (TD-20).
- Events are declared on definitions. Composed definitions contribute their event declarations.

Supported field types: `string`, `int`, `float`, `bool`, `enum`, `color`, `vec2`, `vec3`, `entityRef`, `assetRef`, `array<T>`, `flags`, `nullable`. An `enum` field names a bundle enum with its `enum` key (TD-28). A field may reference an imported enum as `namespace:Enum`. The M1 schema editor authors the scalar/vector/enum/reference subset; collection and nullable types are preserved but deferred (TD-27).

## TD-05 — Entity definitions

A definition is a reusable, namespaced schema entry. It has fields, defaults, and optional
events, and may compose other definitions.

```json
{
  "definitions": {
    "gameA:renderable": {
      "abstract": true,
      "fields": {
        "visible": { "type": "bool", "default": true },
        "castShadows": { "type": "bool", "default": true }
      }
    },
    "gameA:damageable": {
      "abstract": true,
      "fields": {
        "health": { "type": "float", "default": 100 }
      },
      "events": {
        "damaged": {
          "payload": { "amount": { "type": "float" } }
        }
      }
    },
    "gameA:button": {
      "compose": ["gameA:renderable", "gameA:damageable"],
      "fields": {
        "label": { "type": "string", "default": "Press" },
        "enabled": { "type": "bool", "default": true }
      },
      "events": {
        "pressed": {}
      }
    },
    "gameA:elevatorButton": {
      "compose": ["gameA:button"],
      "fields": {
        "label": { "type": "string", "default": "Call Elevator" }
      }
    }
  }
}
```

- Every definition has a qualified ID.
- `abstract: true` marks a non-instantiable base. Abstract definitions are hidden from the entity palette, cannot be scene roots, and have no engine class.
- A definition without `abstract` is concrete. Concrete definitions are instantiable, and each maps to one engine class.
- Any definition may compose abstract or concrete definitions from the same bundle, the builtin schema, or a declared schema import. Composition includes fields, defaults, and event declarations only; it never includes engine classes, behavior, or instantiability (TD-24, TD-29).
- A concrete definition used as a component contributes fields, defaults, and events; it remains independently instantiable. Its engine class is not inherited. Imported definitions stay read-only.
- Composition remains a DAG across bundle boundaries; a package cannot compose its way back into a dependent bundle.
- A field may omit `default`; it is then required on the instance.
- Definitions are data-only. Behavior is implemented by the engine class selected by a concrete definition's ID.
- Transform is not a definition or field; every instance has a built-in transform (TD-20).
- Abstract and concrete definitions share namespaces, versions, defaults, enums, and field types.

## TD-06 — Concrete definitions and instances

A concrete definition is an instantiable archetype. It may compose abstract and concrete definitions (TD-05). An entity instance references one concrete definition and stores its identity, placement, and overrides; the example uses `gameA:elevatorButton` from TD-05:

```json
{
  "id": "button_1",
  "type": "gameA:elevatorButton",
  "name": "Call Button",
  "transform": {
    "position": [0, 1, 0],
    "rotation": [0, 0, 0],
    "scale": [1, 1, 1]
  },
  "props": {
    "label": "Call"
  }
}
```

- `id` is a stable local identifier. It is never a display name.
- `name` is a label for the editor only.
- `transform` is built-in placement data. Omitted components default to identity (TD-20).
- `type` references a concrete definition. An abstract definition ID is invalid here.
- `props` contains instance overrides; defaults resolve through composition and then the instance (TD-24).
- Composition is flattened before build; the runtime receives one flat property list and one concrete type ID.
- A concrete definition's ID maps to exactly one engine class. Composed definitions do not contribute engine classes or behavior (TD-24).
- A scene instance's `props` may override the scene root's effective fields and its promoted fields.
- Entity instances may have `parent` and, when the parent is a scene instance, `slot`.

## TD-07 — Scenes, hierarchy, and storage

A scene document is an entity tree:

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
    }
  ],
  "promotes": {},
  "slots": {}
}
```

- Entities are stored as a flat list with `parent` references. The editor renders the tree.
- A scene has one root entity. The root is an entity with a concrete definition, not a scene instance. Every other entity has exactly one parent. Cycles are invalid.
- Hierarchy expresses parent-child transforms. It is not an ownership or gameplay link.
- A scene may contain arbitrary-depth hierarchy internally.
- A scene instance node uses `scene` instead of `type`. It supports `id`, `name`, `scene`, `parent`, `slot`, `transform`, and `props`:

```json
{
  "id": "door_1",
  "scene": "scenes/door.scene.json",
  "transform": { "position": [3, 0, 0] },
  "props": { "openAmount": 0.5 }
}
```

- A scene instance's transform places the referenced scene. The scene root's transform remains relative to the instance.
- At build time, scene-instance boundaries and slot names are resolved into concrete parent links. The runtime entity tree keeps those parent links and local transforms (TD-23).
- A scene instance is atomic from the outside. Its internal entities are read-only from the host.
- Host entities may attach only to declared slots.
- Attachments are owned by the host scene, even though they are spatially parented inside the instance.
- Scene instances may contain other scene instances; their boundaries remain atomic.

## TD-08 — Promotions and entity references

A scene's public surface is:

- the root entity's effective fields, including composed fields;
- the root entity's effective events, including composed events;
- direct child fields promoted to the root;
- direct child events promoted to the root;
- declared slots.

```json
{
  "promotes": {
    "openAmount": { "entity": "hinge", "field": "open" },
    "onOpened": { "entity": "hinge", "event": "opened" }
  }
}
```

- Promotions reach direct children only. No deep paths.
- Each composition layer promotes what it wants to expose.
- Compatibility is structural: matching promoted names and types are enough.
- Promoted names are public API. Renaming or removing one is a breaking change.
- Entity IDs are local and stable. Names are display labels only.
- Internal references point to entities within the same scene.
- A promoted property may be an input entity ref: the host passes a reference into the scene.
- Scenes do not expose internal entities outward. Hosts never receive references to scene internals.
- When a scene is instanced, internal IDs are remapped into instance scope.

## TD-09 — Events

Events are named outputs.

- A definition declares the events it can emit. Composed definitions contribute their event declarations.
- A payload is optional and typed with the same field types as properties.
- The engine class implements emission semantics and payload production.
- A scene promotes direct child events to its root.
- The host or engine binds promoted events by name.
- Payload fields are values only. Do not expose internal entity references; host-scoped references or sentinels are allowed when needed.
- Events are declared at design time, preserved at build time, and emitted at runtime.

```json
{
  "events": {
    "damaged": {
      "payload": {
        "amount": { "type": "float" },
        "source": { "type": "entityRef", "scope": "host" }
      }
    }
  }
}
```

Payload-less events are the default. Add a payload only when an engine-defined event contract needs one.

## TD-10 — Slots

A slot is a named child transform exposed by a scene for external attachment.

```json
{
  "slots": {
    "button_0": { "entity": "button_anchor" }
  }
}
```

A host attaches an entity by referencing the scene instance and slot:

```json
{
  "id": "button_1",
  "type": "gameA:button",
  "parent": "train_1",
  "slot": "button_0"
}
```

- Slots are the only cross-boundary attachment mechanism.
- Slot names are public API.
- Removing or renaming a slot breaks attachments and fails validation.
- Attachments are host-owned entities.
- Scene internals remain private and read-only from the host. Host-owned content attaches only through declared slots.
- At build time, an attachment becomes a concrete parent link beneath the resolved slot anchor; the slot name may not survive into the runtime (TD-23).

## TD-11 — Generators

A generator is a parameterized asset source.

```json
{
  "id": "floorRing",
  "entry": "generator.mjs",
  "params": {
    "radius": { "type": "float", "default": 4 },
    "segments": { "type": "int", "default": 64 }
  }
}
```

An entity references a generator instance:

```json
{
  "id": "floor_1",
  "type": "gameA:generatedFloor",
  "props": {
    "generator": "generators/floorRing/generator.json",
    "params": { "radius": 6, "segments": 96 },
    "seed": 1234
  }
}
```

- Generator definitions declare parameters and a script or graph entry point.
- Generator instances carry parameter values and a seed.
- Generator parameters use the same field types and defaults as schema fields.
- The editor runs generators to produce preview meshes.
- Authoring stores the generator reference, parameters, seed, and version/hash. It does not store the generated mesh.
- Build time runs the generator and bakes a static mesh.
- Runtime loads the baked mesh. It never runs generators.
- A generator produces an asset, not runtime entities.
- Interactive parts are separate entities. A house generator can produce the shell and door opening; the door is a separate runtime entity with its own behavior.
- Editor preview caches are disposable and never source data.

## TD-12 — Authoring format

Authoring data is JSON. Local files use relative paths; schema imports may also resolve builtin or remote locations.

- Project manifest: `project.json`.
- Project schema bundles: `schemas/*.schema.json`; bundles declare package imports and the project import map resolves their locations (TD-25, TD-29).
- Scene documents: `scenes/*.scene.json`, `levels/*.scene.json`.
- Generator definitions: `generators/<name>/generator.json` plus script/graph files.
- Assets: `assets/`, referenced from entity `assetRef` fields by relative path.
- Entity transforms live on the entity instance outside `props`; omitted components default to identity.
- No authoring file contains baked meshes, lightmaps, or generated geometry.
- IDs are stable and local. Names are display labels.
- A level is a scene document used as the top-level world.
- Every authoring file is opened and saved through its format editor in the Exo shell. The plugin holds no separate copy and writes no other file.
- `exo.json` and `.exo/**` are Exo-owned workspace data, not Tenon authoring data.

## TD-13 — Runtime format

The runtime build is a separate, engine-specific output. A runtime entity has a reserved
`type` discriminator plus a flat property map:

```json
{
  "id": "button_1",
  "type": "gameA:button",
  "transform": { "position": [0, 1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
  "parent": "root",
  "props": { "label": "Start", "enabled": true, "visible": true, "castShadows": true }
}
```

```text
build/level01/
├─ manifest.json
├─ entities.json
├─ meshes.bin
└─ lightmaps/
```

- The build resolves scene instances into concrete runtime entities.
- The entity list is flat storage, not a flat transform hierarchy. Each entity keeps its local transform and parent link; the runtime composes them.
- `transform` is local to the entity's parent. It is not pre-flattened into a world transform.
- Runtime entities contain concrete type IDs, flat property lists, local transforms, parent relationships, and promoted event names.
- `props` is flat: it contains schema field values with definition composition already resolved. `type`, `transform`, and `parent` are envelope fields, not props.
- Scene-instance boundaries and slot names are resolved away; the concrete parent links they produced remain.
- Host/engine code binds events by name.
- Baked meshes, lightmaps, and other artifacts are referenced from the manifest.
- The runtime does not contain generators, authoring metadata, or editor-only data.
- The runtime does not need the scene composition model (scene instances, promotions, slots). It does need the resolved entity transform hierarchy.
- The runtime engine registry maps concrete type IDs to engine classes.
- The initial runtime format is JSON plus binary buffers and texture files. It can evolve per engine target.
- The build is one-way. Runtime data is not edited or round-tripped back into authoring data.

## TD-14 — Bake artifacts

These are build outputs, not authoring entities:

- baked meshes from generators;
- lightmaps and lightmap UVs;
- navmeshes;
- collision meshes;
- LODs;
- occlusion/culling data;
- pre-fractured destruction pieces;
- compressed textures and audio.

Authoring stores the settings that produce them. The runtime stores the results.

## TD-15 — Editor stack

The editor UI is one Exo plugin (TD-26). Each format editor is a separate frame.
The schema and project editors are DOM-only React frames. The scene editor adds
the 3D stack; the generator editor may reuse it for preview:

- TypeScript and React for every frame.
- three.js for immediate representation in the scene editor and generator preview.
- `@react-three/fiber` and `@react-three/drei` for the viewport.
- `three-mesh-bvh` when picking on complex meshes needs acceleration; the M2 baseline does not require it.
- Per-document editor state and a command-oriented history hook. `zustand` can be introduced when cross-component viewport state warrants a shared store; M2 keeps document state in the frame.
- Command pattern for per-document undo/redo.
- Schema-generated inspector panel (TD-31).
- 3D viewport first; orthographic 2D views later.
- The entity document is independent of the three.js scene graph. three.js is a projection, not the document.

Each open document is its own frame. There is no shared mutable store across
tabs; workspace reads go through the Exo plugin SDK, and saves go through the
shell's save handler. The scene inspector and inspection panels follow the active
editor through serialized snapshots and commands (TD-31).

Drei provides the viewport baseline: `TransformControls`, `GizmoHelper`, `Grid`, `Outlines`, `Select`, `useCursor`, `Html`, `Line`, and `OrthographicCamera`.

Tenon is not a modeling tool. It does not author geometry, UVs, or materials.

## TD-16 — Validation

Validation has three scopes: per-document in each format editor, project-wide in
the project editor, and build-time in the Tenon CLI/CI. The scopes share one rule
set; the build adds engine registration and artifact checks. It checks:

- schema structure and field types;
- schema imports are declared, resolvable, and match the required namespace and version;
- definition composition targets, cycles, and field/event collisions, including across imported bundles;
- referenced imported enums exist and match their bundle version;
- inherited default overrides preserve the field type and do not conflict across paths;
- abstract definitions are not instantiated or used as scene roots;
- schema locations resolve and match the required namespace and version;
- required fields and defaults;
- duplicate entity IDs;
- missing or invalid entity references;
- missing or invalid asset references;
- hierarchy cycles and multiple parents;
- entity transforms;
- missing scene documents;
- schema requirements for scene instances;
- scene instance props only set public fields;
- input entity refs resolve in the host scope;
- promotion targets and event declarations;
- slot existence and attachment validity;
- generator references and parameter values;
- engine registration for every concrete type ID used by the build;
- build-time artifact generation.

Errors block the build. Warnings are surfaced in the validation panel. A shell
save is never refused because of validation errors: an authoring document may be
saved while incomplete so work is not lost, and the errors remain visible.

## TD-17 — IDs and names

- Entity IDs are stable, local, and machine-readable.
- Display names are for humans and are never used for reference resolution.
- Internal references resolve by ID within the scene.
- Instancing remaps internal IDs into instance scope.
- Promoted input refs resolve in the host scope.
- Scenes do not expose internal entity references outward.

## TD-18 — Runtime contract

- One concrete definition maps to one engine class.
- The engine class is selected by the entity's qualified concrete `type` ID from the engine registry. Composed definitions do not contribute classes or behavior.
- The runtime composes entity local transforms through the hierarchy and passes the engine the flat property list.
- Type is identity, not a property; it is never part of the flat property list (TD-22).
- The engine implements property semantics, events, and behavior.
- The build resolves scene composition boundaries; the runtime sees concrete entities and their parent/transform hierarchy, not scenes.
- The runtime does not run generators or bake assets.
- The runtime format is engine-specific; authoring remains engine-agnostic.

## TD-19 — Scope boundaries

Tenon authors:

- schemas and entity definitions, including abstract definitions and composition;
- entity placement and properties;
- scene composition, promotions, events, and slots;
- generator parameters;
- bake settings.

Tenon does not author:

- meshes, UVs, or materials;
- behavior scripts;
- engine runtime code;
- baked lightmaps, navmeshes, or collision results.

Those belong to imported assets, generators, engine classes, or the build pipeline. The authoring UI is one Exo plugin; the build pipeline runs outside its frames (TD-26).

## TD-20 — Entity transforms

Every entity instance has a transform. It is built-in placement data, not a schema field
or definition.

```json
{
  "transform": {
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "scale": [1, 1, 1]
  }
}
```

- Omitted transform or omitted components default to identity.
- Transform is stored outside `props` and does not participate in definition or instance default resolution.
- Every entity has a transform, including non-visual and data-only entities.
- Hierarchy composes parent transforms. A scene instance's transform places the referenced scene; the scene root's transform remains relative to the instance.
- Transform is never promoted and is not part of a scene's public field surface. Hosts place scene instances; they cannot edit internal transforms.
- Slots expose child transforms for attachment. An attached host entity is transformed relative to the slot.
- The build resolves scene boundaries and slot attachments but keeps local transforms and parent links. It may cache initial world transforms; the runtime updates children when a parent moves (TD-23).

## TD-21 — Imported mesh assets

An imported mesh file (for example `.glb`) is an asset, not an entity or scene node.

- The file lives under `assets/`; adding it is a workspace action, not a plugin write. It does not create entities. The Exo shell owns the file; the plugin browses and reads it and never copies an external file.
- A mesh definition exposes an `assetRef` field for the mesh. Placing an instance and setting that field is what puts the mesh in a scene.
- The entity transform places the asset as a whole; glb node transforms remain internal to the asset. Multiple entities may reference the same asset.
- A glb's internal node hierarchy and transforms are asset data, not Tenon entities. If parts need separate behavior, split them into separate assets and entities; procedural geometry comes from generators.
- Tenon does not author the mesh, its UVs, or its materials. Those remain in the asset; the build cooks them.
- Build time optimizes, compresses, and generates LODs as configured; runtime loads the cooked mesh.

## TD-22 — Runtime entity identity

The runtime entity's `type` field is its discriminator — the equivalent of a TrenchBroom
`classname`. It is the qualified ID of a concrete definition, fixed at authoring time.

```json
{
  "id": "button_1",
  "type": "gameA:button",
  "transform": { "position": [0, 1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
  "parent": "root",
  "props": { "label": "Start", "enabled": true, "visible": true, "castShadows": true }
}
```

- `type` is a reserved envelope field, not a key inside `props`. It cannot be overridden by instance props or promotions.
- Abstract definition IDs never appear in instances, scene roots, or runtime builds.
- `props` is the flat map of schema field values; definition composition is already resolved.
- The engine registry maps the exact qualified concrete type ID to exactly one engine class. Class names and display names are not used for lookup.
- Scene instancing remaps entity IDs, not type IDs. Resolved scene entities keep their authored concrete types.
- A build must reject a concrete type ID with no engine registration for the target runtime.

## TD-23 — Runtime transform hierarchy

The runtime build is a flat **entity list**, not a flat transform hierarchy. Scene
resolution removes scene-instance boundaries and slot names; it must not discard parent
links or local transforms.

- Authoring stores local transforms and parent links.
- Build resolves scene instances into concrete entities, remaps IDs, and turns slot attachments into concrete parent links beneath the resolved slot anchor.
- A scene instance's transform is composed into the resolved root's local transform; internal entities keep their relative transforms.
- Runtime entities keep local transforms and parent links. The runtime composes them at load and again whenever a parent changes.
- Baked world transforms may be cached for static entities; they are not authoritative when an ancestor moves.
- A moved elevator propagates its transform to an attached button because the button remains a descendant of the elevator in the resolved hierarchy, even though the slot name no longer exists.
- Scene-instance atomicity, host ownership, promotions, and slot names are authoring/composition concepts. They may be discarded after resolution; the concrete entity hierarchy is part of the runtime contract.
- Engine code moves entities through the runtime hierarchy; it does not re-run scene composition.

## TD-24 — Definition composition and engine classes

Definition composition is a schema/build-time flattening step. It is separate from scene
composition and from engine behavior.

- Any definition may list abstract or concrete definitions in `compose`.
- Composition contributes fields, field metadata/defaults, and event declarations. It does not contribute engine classes, behavior, display names, `abstract` status, or palette visibility.
- A concrete definition remains instantiable when used as a component. Its own ID still maps to its own engine class.
- A composing concrete definition maps to its own engine class by its own ID. The classes of composed definitions are irrelevant in that composition; behavior reuse belongs in engine code.
- An abstract definition remains abstract and non-instantiable even if it composes a concrete definition.
- The composition graph is a DAG. Cycles are invalid. A definition reachable through multiple paths is flattened once.
- A field has one origin definition. Two distinct origin fields with the same name in one flattened composition are a schema error.
- A definition may redeclare an inherited field only to override its default; the field type must match, and the override is not a second origin.
- If one field reaches a definition through multiple paths with different effective defaults, it is a schema error; identical defaults collapse cleanly.
- Event names must be unique across the flattened graph. Duplicate event declarations are schema errors; an inherited event cannot be redefined.
- Defaults resolve through the composition chain, then the instance value.
- Abstract definitions never appear in instances, scene roots, runtime builds, or the engine registry.
- The build flattens each concrete definition into one field list and event set; the runtime sees one concrete type ID.

For example, `gameA:elevatorButton` may compose the concrete `gameA:button`. It inherits
the button's fields and events, but `gameA:elevatorButton` uses the engine class registered
for its own ID. The class registered for `gameA:button` is not inherited.

## TD-25 — Builtin schemas and schema resolution

Schema identity is separate from schema location. Identity is `namespace@version`; the
project import map resolves a namespace to a builtin, project-relative, or remote
location.

- `basic3d` is a builtin schema shipped with both the Tenon plugin and the engine. Its reference schema is [basic3d.schema.json](basic3d.schema.json).
- The plugin packages the supported builtin bundle versions as static assets. They are not workspace files and are never written into the project; the schema editor opens them read-only.
- The core set is `basic3d:renderable`, `basic3d:light`, `basic3d:node`, `basic3d:mesh`, `basic3d:camera`, `basic3d:directionalLight`, `basic3d:pointLight`, and `basic3d:spotLight`. Additions such as generated meshes, audio, and collision shapes/areas ship as later versions.
- `basic3d` is versioned and immutable. Projects pin an exact version; the plugin keeps old builtin versions resolvable.
- A new empty scene requires the current `basic3d@<version>` and starts with one `basic3d:node` root.
- `basic3d` is read-only in the schema editor. Projects extend it by composing its definitions in project schemas; they do not edit it.
- Builds record the schema versions and hashes they used.
- A schema bundle's `imports` map pins the exact versions of the packages it references (TD-29). The project import map supplies their locations.
- The schema editor resolves imports from the project map first, then from matching `schemas/*.schema.json` files as an authoring convenience. The build resolves only through the project import map.
- Imported bundles are read-only in the schema editor. Their definitions may be composed, and their enums may be referenced as `namespace:Enum`.
- Builtin namespaces resolve without a project import entry. A project import entry may select another supported builtin version, but cannot replace a builtin namespace with project or remote content. Schema `imports` never list `basic3d`; it is always available.
- Location schemes are `builtin:basic3d@1.0.0`, project-relative paths, and `https://` URLs. Project-relative paths are the portable default for local schemas.
- `file://` is a CLI-only local convenience, if supported at all. Do not check absolute file URLs into a project; the browser plugin cannot resolve them, and they break portability.
- Remote schema URLs must resolve to the expected namespace/version, should be pinned by content hash, and must allow CORS from the plugin origin. The editor may resolve an HTTPS import when the browser allows it; the build still resolves through the project map. Remote bundles are untrusted. Content-hash pinning and caching are resolution hardening, not authoring data.
- A URL is a location, not an identity. Moving or replacing a URL must not change definition IDs or scene `requires`.
- Missing, mismatched, or unresolvable schema locations fail validation and block the build.

## TD-26 — Exo editor plugin and format editors

The Tenon editor is one Exo editor plugin, not a standalone web application. The
Exo shell owns the workspace and document lifecycle; Tenon contributes one
visible editor per authoring format.

One Exo workspace is one Tenon project rooted at the workspace root. `project.json`
is Tenon's manifest. `exo.json` and `.exo/**` are Exo-owned; Tenon never reads,
writes, or lists them (TD-03).

The plugin is one identity, not one plugin per format: the format editors share
schema resolution, validation, and UI code, and the user approves one origin,
permission set, and consent. The manifest uses a stable reverse-domain id (for
example `com.tenon.editor`), one display name, and one version. The plugin
declares these file editors:

| Glob | Entry | Label | Editor |
|---|---|---|---|
| `project.json` | `editors/project.html` | Tenon Project | Project |
| `schemas/*.schema.json` | `editors/schema.html` | Tenon Schema | Schema |
| `scenes/*.scene.json` | `editors/scene.html` | Tenon Scene | Scene |
| `levels/*.scene.json` | `editors/scene.html` | Tenon Level | Scene in level mode |
| `generators/*/generator.json` | `editors/generator.html` | Tenon Generator | Generator |

The controller is `plugin.html`; every entry stays inside the plugin root.

The plugin also contributes one project-level panel, two scene panels, and two commands:

| Contribution | Id | Purpose |
|---|---|---|
| Panel | `tenon.project` | Project hub: schema/scene list and creation actions |
| Panel | `tenon.scene.inspector` | Document-scoped scene/level inspector; secondary panel |
| Panel | `tenon.scene.inspection` | Document-scoped validation, public surface, and debug expansion; bottom panel |
| Command | `tenon.new-schema` | **New Schema** in the command palette; targets the project hub |
| Command | `tenon.new-scene` | **New Scene** in the command palette; targets the project hub |

- Every file editor uses `rendering: "frame"`. The default hidden rendering is for
  the controller and headless transforms, not for these visual editors.
- The entries use a positive priority so a generic JSON editor does not win by
  default; the shell's Open With still allows another editor.
- A level is a scene document used as the top-level world, so it reuses the scene
  editor and adds level-only controls. There is no separate level format.
- The controller page registers the declared file editors, the project panel, the scene
  inspector/inspection panels, and the `tenon.new-schema`/`tenon.new-scene` commands, then
  is removed. Each open document gets its own handler frame with its own buffer, selection,
  undo/redo stack, and validation state. Frames do not share mutable state; the scene
  panels follow the active editor and exchange serialized snapshots and commands (TD-31).
- Format editors are per format, never per definition. Adding a concrete
  definition changes schema data only; it adds no page, glob, or editor code.
- The shell owns the tab strip, breadcrumbs, Save/Save All, dirty indicators,
  external-change notices, consent, and theme. A Tenon frame owns only its
  document surface and must not recreate shell chrome.
- The project hub is the only project-level shell panel and is a primary panel. It is
  not document-scoped: it lists schema bundles and hosts the New Schema action. It is not
  a document editor and has no dirty state. The scene inspector and inspection panels are
  document-scoped shell panels that follow the active scene/level editor (TD-31); the
  hierarchy and palette stay inside the scene frame, and the schema and project editors
  keep their own tools in their frames.
- All workspace access goes through the plugin SDK. Tenon reads with `readFile`,
  `requestFiles`, and `listDirectory`; it reports dirty with `setDirty`; a
  plugin-originated edit writes only the open document through `onSaveRequest`.
  New files come from user-invoked shell actions, never background writes. It never
  receives a file handle and never writes another document.
- Cross-file refactors are out of scope. A rename or move is saved in the open
  document only; other documents are validated and reported as broken, never
  rewritten in the background.
- An external change never silently replaces a dirty buffer. The frame reloads
  only when clean; otherwise it shows the conflict and leaves the buffer intact.
- A save conflict leaves the buffer and tab dirty; the frame does not retry or
  overwrite another writer.
- A shell save is never refused because of validation errors; incomplete
  authoring data can be saved, and errors remain visible (TD-16).
- A read-only workspace opens the format editors read-only and disables creation
  actions; dirty state and Save are unavailable rather than failing on write.
- The manifest requests the least permissions that cover the formats:
  `workspace:read` and `workspace:write` for editing, `workspace:list` for the
  project hub, project resolution, and asset browsers, and `events:subscribe` for
  live theme changes and the scene panel bridge. No permission is requested for an
  unused capability.
- The manifest declares the minimum Exo shell range that supports every
  contribution and permission it uses. Consent covers the origin, plugin root,
  permissions, and editor globs; adding a glob re-prompts.
- New authoring documents are created only through shell-owned dialogs; the plugin
  never writes them directly.
- New files are created by panel/command actions, never background writes. The shell
  reveals the panel, delivers the command, and treats the live invocation as user
  activation, so the panel may call `requestNewFile` even without owning DOM focus. The
  panel then calls `openFile`. The panel's New Schema and New Scene buttons use the same
  request path.
- This requires Exo 0.8.0 or newer for command-scoped user activation. The manifest
  declares that minimum range; the command still obeys permission, write, size,
  rate, and shell-dialog checks.
- The scene inspector and inspection panels require Exo 0.10.0 or newer for the bottom
  panel location, `activeEditor`/`editor/active`, and SDK 1.10.0. The manifest declares
  `>=0.10.0`, so an older shell fails closed with `incompatible-engine` before parsing
  the bottom location.
- Builtin `basic3d` bundles are packaged with the plugin, not written into the
  workspace (TD-25). The schema editor exposes them read-only; the engine ships
  the same versions.
- The plugin is a static site on HTTPS outside the shell origin; GitHub Pages is
  the reference host. It runs in the shell's sandboxed iframe and has no parent DOM
  access. Every page stays inside the plugin root.
- Cross-origin hosting keeps the plugin's own storage for cached schemas and
  preferences. A same-origin deployment runs in an opaque origin with no storage;
  the editor still works, but remote schema caching degrades.
- Exo v1 has no multi-file build-output surface. The plugin edits and validates
  authoring data; the Tenon CLI/CI produces the runtime build. The project editor
  reports build readiness and the exact command. The plugin does not write build
  artifacts; build-time generator runs and baking happen in the CLI/CI.
  Design-time generator previews remain artifacts and never source data (TD-02,
  TD-11).
- Tenon follows the shell theme with the SDK token sheet and `followTheme`; every
  surface supports dark and light and maps high contrast.
- If the shell lacks a capability (directory listing, file picker, theme events),
  the editor degrades explicitly: manual path entry, read-only browsing, or
  initial-theme-only. It never assumes an absent capability.

## TD-27 — Schema editor first

The schema editor is the first editor milestone. It proves the schema contract and
the Exo command/panel boundary before any 3D or scene work. The UI concept lives
in [schema-editor-ui.md](schema-editor-ui.md).

- The schema editor is a DOM-only frame; it does not load three.js or scene code
  (TD-15).
- At M1, the plugin contributes the `tenon.project` panel and the
  `tenon.new-schema`/`tenon.new-scene` commands (TD-26); M2 adds the scene
  inspector/inspection panels (TD-31).
- M1 uses one open schema bundle plus builtin `basic3d` and its declared schema
  imports as the unit of work. The M2 project editor provides import-map editing and
  project-wide resolution, and the scene editor reads the same resolved packages.
- The bundle header edits `id`, `namespace`, and `version`. Changing the namespace
  rewrites this bundle's definition IDs and local qualified references; it never
  rewrites another file (TD-29).
- Definition editing is the primary surface: definitions, abstract/concrete,
  composition, fields, enums, defaults, events, and payloads. Imported definitions
  are read-only; cross-bundle composition uses the same chips and effective view.
  Scene instances, entity placement, and runtime binding are absent.
- M1 edits scalar, vector, enum, and reference field types. `array<T>`, `flags`,
  and `nullable` are preserved but deferred.
- The editor always exposes an effective view with origin badges; composition is
  not hidden behind a form.
- Routine edits are inline; modals are reserved for destructive or ambiguous
  operations.
- Validation is live and jumpable; errors do not block Save.
- The editor renders from the schema contract. Adding a definition or field adds
  no page, glob, or editor code.
- The MVP must be usable end to end without hand-editing JSON; the acceptance
  walkthrough is in the UI concept.

## TD-28 — Enum declarations and field values

An enum is bundle-local, ordered, and data-only. A field of type `enum` names the
enum and defaults to one of its values.

```json
{
  "enums": {
    "ButtonStyle": {
      "values": ["primary", "secondary", "danger"]
    }
  },
  "definitions": {
    "gameA:button": {
      "fields": {
        "style": { "type": "enum", "enum": "ButtonStyle", "default": "primary" }
      }
    }
  }
}
```

- Enum names are local to the bundle and unique.
- Values are ordered strings; each value is unique within its enum.
- A field in the open bundle must name a local enum unqualified, or an imported
  enum as `namespace:Enum`. The `enum` key is invalid on other field types.
- Values declared in an imported bundle keep their local unqualified enum reference;
  it resolves in that bundle's namespace, not in the consumer's bundle.
- A default must be one of the referenced enum's values. An omitted default makes
  the field required.
- Composition carries the field and its enum reference; it does not merge enum
  declarations. Imported enums stay owned by their bundle.
- Enums are data-only; engine classes interpret the value. Tenon does not add
  engine values, numeric IDs, or behavior.
- Renaming an enum or value updates references in the open bundle. Other files are
  never rewritten; they surface validation errors.
- The schema editor may preserve enum syntax it does not yet edit, but it never
  drops it silently.

## TD-29 — Schema packages and namespace edits

A schema can depend on other schema bundles as packages. Identity stays
`namespace@version`; the dependency is declared in the bundle, and the location
comes from the project import map (TD-03, TD-25).

```json
{
  "id": "com.example.gameA",
  "version": "1.0.0",
  "namespace": "gameA",
  "imports": {
    "shared": "1.0.0"
  },
  "definitions": {
    "gameA:button": {
      "compose": ["shared:tintable"],
      "fields": {
        "label": { "type": "string", "default": "Press" },
        "tone": { "type": "enum", "enum": "shared:Tone", "default": "warm" }
      }
    }
  }
}
```

- `imports` maps a namespace to one exact version. Version ranges are not part of
  the format; a project resolves one version per namespace.
- `basic3d` is implicit and is not listed in `imports`. A bundle cannot import its
  own namespace or replace a builtin namespace with project content.
- Imported definitions keep their qualified IDs. `compose` may target own, builtin,
  or imported definitions; composition still contributes only fields, defaults, and
  events and never engine classes, behavior, or instantiability (TD-24).
- Imported definitions are read-only in the schema editor. Browsing, composing, and
  effective field/event views work exactly as for builtin definitions.
- An imported enum is referenced as `namespace:Enum`. A field inherited from an
  imported definition keeps its unqualified enum reference and resolves it in that
  definition's origin bundle (TD-28).
- The composition graph is a DAG across package boundaries. Cycles and field/event
  collisions are schema errors.
- Missing, mismatched, undeclared, or unresolvable imports are schema errors and
  block the build. A declared import that resolves to the wrong namespace or version
  is an error, not a silent fallback.
- The editor resolves imports from the project import map and may also discover
  matching schema files under `schemas/` while authoring. The project import map is
  authoritative for the build.
- Changing a bundle's namespace rewrites its own definition IDs, its `compose`
  references to those definitions, and its qualified enum references in the open
  document. It preserves imports and references to other namespaces. No other file
  is rewritten; dependent documents surface validation errors.
- Renaming a namespace or package version is a breaking change for consumers.
  Authors update `imports` and qualified references deliberately in each document.
- The project import map editor is part of the project editor (M2). A workspace can
  also map imports in `project.json` by hand; the schema editor still resolves adjacent
  `schemas/*.schema.json` packages for local authoring.

## TD-30 — Scene editor transforms and debug expansion

The M2 scene editor projects the scene document into three.js. The document remains the
source of truth; the renderer never owns authoring data.

- Entity rotations are Euler XYZ angles in **degrees** in authoring JSON. The viewport
  converts to radians only for rendering.
- The viewport edits the selected entity's local transform. A scene instance transform
  places the referenced scene; internal transforms stay private.
- Scene instance internals are rendered read-only. Host entities attach only through
  declared slots, and the host's hierarchy shows the attachment under the instance.
- The debug expansion resolves scene instances, promotions, and slot attachments into a
  flat, runtime-shaped entity list for inspection. It is computed in memory, is never
  saved, and is not the runtime build.
- The project editor's content hashes are display/integrity hints. The build pipeline
  remains authoritative for cooking and output.

## TD-31 — Editor-bound scene panels

The scene editor keeps the document in its handler frame. The right Inspector and the
bottom Inspection panel are Exo shell panels, not iframes inside the scene editor.

- `tenon.scene.inspector` is a secondary panel; `tenon.scene.inspection` is a bottom
  panel. Both are singleton plugin views that follow the active Tenon scene/level editor.
- The panels receive `activeEditor` and `editor/active` from Exo and request a snapshot
  over `local/tenon.scene`. They do not own a document, save path, dirty state, or undo
  stack.
- The editor publishes serialized snapshots and applies typed panel commands through the
  same reducer as its own controls. Undo, dirty state, conflict handling, and Save stay in
  the editor frame.
- Panels load the workspace read-only for schema, asset, scene, and validation context.
  The editor snapshot is the document source; local events are at-most-once, so a panel
  requests a fresh snapshot on mount and whenever the active editor changes.
- The scene frame keeps the hierarchy, palette/assets, viewport, toolbar, and save
  notices. The project hub remains the only project-level panel. A panel shows an empty
  state when no Tenon scene/level editor is active, including when the active editor is a
  project or schema editor.
- A panel never writes a workspace file. A panel edit is a command to the active editor,
  which remains the only writer. This requires Exo 0.10.0+ and SDK 1.10.0.

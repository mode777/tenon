# Technical Decisions

This document records the implementation-shaping decisions for Tenon. The guiding rule is simplicity: one entity model, one scene model, one schema contract, and one build step.

## TD-01 — Scope and separation

Tenon is a browser-based 3D entity and scene editor.

- The editor is data-only. It defines, places, composes, validates, and triggers builds.
- Engine classes implement behavior and interpret entity types at runtime.
- Geometry comes from imported meshes and parametric generators.
- Tenon does not author geometry, UVs, materials, or behavior.
- Authoring is engine-agnostic. The runtime build may be engine-specific.

## TD-02 — Pipeline stages

| Stage | Purpose | Output |
|---|---|---|
| **Design time** | Author schema, scenes, entities, generator parameters, bake settings | Editable authoring JSON |
| **Build time** | Validate, resolve composition, run generators, bake assets | Runtime build |
| **Runtime** | Load, instantiate entities, apply properties, emit events, simulate, render | Running experience |

Design-time previews may invoke build steps, but preview results remain artifacts. They are never the source of truth.

| Resource | Design time | Build time | Runtime |
|---|---|---|---|
| Schema / entity types | Author types, groups, fields, enums, defaults, events | Validate; generate types/validators | Engine class registry uses type IDs |
| Scene composition | Place entities and scene instances; promote fields/events; declare slots | Resolve scene instances; validate refs/slots; flatten IDs and transforms | Instantiate entities; no scene composition |
| Placement / transforms | Position, rotate, scale; parent; attach to slots | Bake local/world transforms; resolve hierarchy | Spawn at baked transforms; update dynamic transforms |
| Property values | Author defaults and overrides | Resolve effective flat property list | Apply on spawn; mutate through gameplay |
| Events | Declare event types; promote child events | Preserve declarations; resolve bindings | Emit/dispatch |
| Parametric geometry | Set generator, parameters, seed; preview | Run generator; bake mesh | Load baked mesh |
| Imported meshes | Reference and place | Import; optimize; compress; generate LODs | Load and render |
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

A project is a directory with relative paths.

```text
project/
├─ project.json
├─ schemas/
│  ├─ basic3d.schema.json
│  └─ gameA.schema.json
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

`project.json` maps namespaces to schema files:

```json
{
  "imports": {
    "basic3d": "schemas/basic3d.schema.json",
    "gameA": "schemas/gameA.schema.json"
  }
}
```

Schema files are checked in and referenced directly. A level is a scene document used as the top-level world; `scenes/` and `levels/` share the same document format.

## TD-04 — Schema bundles

A schema bundle is a versioned, namespaced JSON document.

```json
{
  "id": "com.tenon.basic3d",
  "version": "1.0.0",
  "namespace": "basic3d",
  "enums": {},
  "groups": {},
  "types": {}
}
```

- The schema editor is a first-class part of Tenon.
- Schema bundles are checked into the project.
- Entity type IDs are qualified: `basic3d:light`, `gameA:boss`.
- Scenes declare the exact bundle versions they require: `"requires": ["basic3d@1.0.0"]`.
- A project resolves one version per namespace. Composition is valid when the project provides all required bundles.
- The engine aligns to the schema. The schema is the shared contract for editor UI, validation, and engine registration.
- Types are flat. Property groups are the only mechanism for composing fields.
- Events are declared on entity types, not on property groups or instances.

Supported field types: `string`, `int`, `float`, `bool`, `enum`, `color`, `vec2`, `vec3`, `entityRef`, `assetRef`, `array<T>`, `flags`, `nullable`.

## TD-05 — Property groups

A property group is a reusable set of fields with defaults.

```json
{
  "groups": {
    "basic3d:transform": {
      "fields": {
        "position": { "type": "vec3", "default": [0, 0, 0] },
        "rotation": { "type": "vec3", "default": [0, 0, 0] },
        "scale": { "type": "vec3", "default": [1, 1, 1] }
      }
    }
  },
  "types": {
    "basic3d:light": {
      "groups": ["basic3d:transform"],
      "fields": {
        "color": { "type": "color", "default": [1, 1, 1] },
        "intensity": { "type": "float", "default": 1 }
      }
    }
  }
}
```

- Groups contain fields only. They have no behavior, events, or methods.
- An entity type includes zero or more groups. It may also declare its own fields.
- Defaults resolve as: **group default → entity type override → instance value**.
- Field names must be unique across a type's composed groups. A collision is a schema error.
- An entity type has a fixed set of groups. Instances cannot add or remove groups.
- Groups are an authoring/build concept. The runtime receives one flat property list.

## TD-06 — Entity types and instances

An entity type is a fixed archetype:

```json
{
  "types": {
    "gameA:button": {
      "groups": ["basic3d:transform"],
      "fields": {
        "label": { "type": "string", "default": "Press" },
        "enabled": { "type": "bool", "default": true }
      },
      "events": {
        "pressed": {}
      }
    }
  }
}
```

An entity instance stores only its identity and overrides:

```json
{
  "id": "button_1",
  "type": "gameA:button",
  "name": "Start Button",
  "props": {
    "label": "Start"
  }
}
```

- `id` is a stable local identifier. It is never a display name.
- `name` is a label for the editor only.
- `props` contains instance overrides; defaults are resolved from schema and type.
- A scene instance's `props` may override the scene root's own fields and its promoted fields.
- Entity instances may have `parent` and, when the parent is a scene instance, `slot`.
- At build/runtime, the type ID maps to one engine class. The engine gets the resolved flat property list.

## TD-07 — Scenes, hierarchy, and storage

A scene document is an entity tree:

```json
{
  "id": "scene_door",
  "requires": ["basic3d@1.0.0"],
  "root": "root",
  "entities": [
    { "id": "root", "type": "basic3d:group" },
    { "id": "hinge", "type": "basic3d:hinge", "parent": "root", "props": { "open": 0 } }
  ],
  "promotes": {},
  "slots": {}
}
```

- Entities are stored as a flat list with `parent` references. The editor renders the tree.
- A scene has one root entity. The root is an entity, not a scene instance. Every other entity has exactly one parent. Cycles are invalid.
- Hierarchy expresses parent-child transforms. It is not an ownership or gameplay link.
- A scene may contain arbitrary-depth hierarchy internally.
- A scene instance node uses `scene` instead of `type`. It supports `id`, `name`, `scene`, `parent`, `slot`, and `props`:

```json
{
  "id": "door_1",
  "scene": "scenes/door.scene.json",
  "props": { "openAmount": 0.5 }
}
```

- A scene instance is atomic from the outside. Its internal entities are read-only from the host.
- Host entities may attach only to declared slots.
- Attachments are owned by the host scene, even though they are spatially parented inside the instance.
- Scene instances may contain other scene instances; their boundaries remain atomic.

## TD-08 — Promotions and entity references

A scene's public surface is:

- the root entity's own fields;
- the root entity's own events;
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

- An entity type declares the events it can emit.
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
  "type": "basic3d:generatedMesh",
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

Authoring data is JSON, split into separate files with relative paths.

- Project manifest: `project.json`.
- Schema bundles: `schemas/*.schema.json`.
- Scene documents: `scenes/*.scene.json`, `levels/*.scene.json`.
- Generator definitions: `generators/<name>/generator.json` plus script/graph files.
- Assets: `assets/`.
- No authoring file contains baked meshes, lightmaps, or generated geometry.
- IDs are stable and local. Names are display labels.
- A level is a scene document used as the top-level world.

## TD-13 — Runtime format

The runtime build is a separate, engine-specific output.

```text
build/level01/
├─ manifest.json
├─ entities.json
├─ meshes.bin
└─ lightmaps/
```

- The build resolves scene instances into concrete runtime entities.
- Runtime entities contain type IDs, flat property lists, transforms, parent relationships, and promoted event names.
- Host/engine code binds events by name.
- Baked meshes, lightmaps, and other artifacts are referenced from the manifest.
- The runtime does not contain generators, authoring metadata, or editor-only data.
- The runtime does not need the scene composition model. Scenes are an authoring concept.
- The runtime engine registry maps type IDs to engine classes.
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

- Browser-based, TypeScript, React.
- three.js for immediate representation.
- `@react-three/fiber` and `@react-three/drei` for the viewport.
- `three-mesh-bvh` for picking on complex meshes.
- `zustand` for editor state.
- Command pattern for undo/redo.
- Schema-generated inspector.
- 3D viewport first; orthographic 2D views later.
- The entity document is independent of the three.js scene graph. three.js is a projection, not the document.

Drei provides the viewport baseline: `TransformControls`, `GizmoHelper`, `Grid`, `Outlines`, `Select`, `useCursor`, `Html`, `Line`, and `OrthographicCamera`.

Tenon is not a modeling tool. It does not author geometry, UVs, or materials.

## TD-16 — Validation

Validation runs before save and before build. It checks:

- schema structure and field types;
- required fields and defaults;
- duplicate entity IDs;
- missing or invalid entity references;
- hierarchy cycles and multiple parents;
- missing scene documents;
- schema requirements for scene instances;
- scene instance props only set public fields;
- input entity refs resolve in the host scope;
- promotion targets and event declarations;
- slot existence and attachment validity;
- generator references and parameter values;
- build-time artifact generation.

Errors block the build. Warnings are surfaced in the validation panel.

## TD-17 — IDs and names

- Entity IDs are stable, local, and machine-readable.
- Display names are for humans and are never used for reference resolution.
- Internal references resolve by ID within the scene.
- Instancing remaps internal IDs into instance scope.
- Promoted input refs resolve in the host scope.
- Scenes do not expose internal entity references outward.

## TD-18 — Runtime contract

- One entity type maps to one engine class.
- The engine receives a flat property list.
- The engine implements property semantics, events, and behavior.
- The build resolves composition; the runtime sees entities, not scenes.
- The runtime does not run generators or bake assets.
- The runtime format is engine-specific; authoring remains engine-agnostic.

## TD-19 — Scope boundaries

Tenon authors:

- schemas and entity types;
- entity placement and properties;
- scene composition, promotions, events, and slots;
- generator parameters;
- bake settings.

Tenon does not author:

- meshes, UVs, or materials;
- behavior scripts;
- engine runtime code;
- baked lightmaps, navmeshes, or collision results.

Those belong to imported assets, generators, engine classes, or the build pipeline.

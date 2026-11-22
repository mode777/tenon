# Tenon Editor Concept

Tenon is a browser-based 3D editor for building entity-based scenes. It is schema-driven and data-only: the editor defines and places entities, scenes compose them, and the engine interprets entity types at runtime.

A **level** is simply a scene document used as the top-level world.

## Core model

| Concept | Definition |
|---|---|
| **Schema bundle** | A versioned, namespaced JSON file containing enums, property groups, and entity types. Checked into the project. |
| **Property group** | A reusable, data-only set of fields with defaults. No behavior. |
| **Entity type** | A fixed archetype: its own fields plus included property groups, plus optional event declarations. Maps to one engine class. |
| **Entity instance** | A placed entity with a stable local ID, display name, type, property values, and optional parent/slot. |
| **Scene** | A saved entity tree with one root entity. Reusable and instanced. |
| **Scene instance** | A node that references a scene document and supplies overrides for its promoted properties. Atomic from the outside. |
| **Promotion** | An alias from a direct child field or event to the scene root. Defines public API. |
| **Slot** | A named transform exposed by a scene where a host may attach an entity. |
| **Event** | A named output with an optional typed payload. Declared by an entity type, emitted by the engine class. |
| **Generator** | A parameterized asset source. Runs in the editor/build; bakes to a static mesh. |

Entity types are flat. Property groups are the only mechanism for composing fields. An entity type has a fixed set of groups; instances cannot add or remove groups.

## Schema

- Schema bundles are checked into the project and referenced by relative path.
- Each bundle declares a namespace and a version.
- The project manifest maps namespaces to schema files.
- The schema editor is a first-class part of Tenon. Types, fields, enums, defaults, and events are authored there.
- The engine aligns to the schema. The schema is the shared data contract for editor UI, validation, and engine registration.
- Property groups are data-only. Behavior is implemented by the engine class.
- Field defaults resolve as: **group default → entity type override → instance value**.
- Field names are unique across an entity type's composed groups. A collision is a schema error.
- At runtime, all groups are flattened into one flat property list. The engine never sees groups.

## How an entity is created

1. Define or select an entity type in the schema editor.
2. Add fields directly to the type or include property groups. Set defaults, enums, documentation, and editor hints.
3. Declare any events the type can emit.
4. Open a scene or level and choose the type from the entity palette.
5. Place the entity in the viewport. Tenon creates an entity instance with a stable local ID and a default display name.
6. The inspector shows the type's effective fields. Values start from defaults; the instance stores only overrides.
7. Optionally parent the entity to another entity, or attach it to a scene instance's slot.
8. Save the scene document. No editor plugin or per-type editor code is required.
9. At build/runtime, the type ID maps to an engine class. The engine receives the flattened property list and applies it.

## How a scene is created

1. Create a new scene document and choose the root entity's type. The root is an entity, not a scene instance.
2. Add child entities and parent them into a hierarchy.
3. Promote direct child fields and events to the scene root. Promotions define the scene's public surface.
4. Declare slots: named child transforms where hosts may attach entities.
5. Save the scene. It can now be instanced in another scene or level.
6. To use it, add a scene instance node, point it at the scene document, and override root fields or promoted properties.
7. Attach host-owned entities to slots when the scene needs external content.
8. A scene instance is atomic from the outside: its internal entities are read-only from the host scene. Host-owned content attaches only through declared slots.
9. Validation checks scene requirements, promotions, slots, references, and hierarchy.

## Public surface and composition

A scene's public surface is:

- the root entity's own fields;
- the root entity's own events;
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
- Scene instances may contain other scene instances; their boundaries remain atomic.

```text
Level
└─ train_1                    scene instance, atomic from outside
   ├─ body                    internal, read-only from the level
   ├─ wheels                  internal, read-only from the level
   └─ slot: button_0          declared attachment point
      └─ button_1             host-owned entity attached to the slot
```

## Events

Events are named outputs. They are conceptually clear and keep internals private.

- An entity type declares the events it can emit.
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

## Authoring and runtime

Tenon has two distinct outputs:

- **Authoring documents** — editable JSON. Source of truth. Entities, scenes, schema references, generator parameters, promotions, and bake settings.
- **Runtime bake** — generated build output. Baked meshes, lightmaps, resolved entity instances, flat properties, and event bindings as needed. No generators, editor metadata, or authoring data.

The editor edits authoring documents. Playtest loads the bake. The runtime never runs generators or bakes lightmaps.

Lightmaps, navmeshes, collision meshes, LODs, and occlusion data are bake artifacts. Their settings live in authoring; their results live in the runtime build.

## Editor UI

- 3D viewport with selection, transform gizmos, grid, and snapping.
- Scene hierarchy panel.
- Schema editor for types, property groups, fields, enums, defaults, and events.
- Schema-generated property inspector.
- Entity palette.
- Scene and asset browsers.
- Generator browser with parameter editing and preview.
- Validation panel.
- Build and playtest controls.
- 2D orthographic views are a later addition.

The editor is not a modeling tool. Geometry comes from imported meshes and parametric generators. UV, material, and behavior authoring live outside Tenon.

## Example scene document

```json
{
  "id": "scene_door",
  "requires": ["basic3d@1.0.0"],
  "root": "root",
  "entities": [
    { "id": "root", "type": "basic3d:group" },
    {
      "id": "hinge",
      "type": "basic3d:hinge",
      "parent": "root",
      "props": { "open": 0 }
    },
    {
      "id": "handle_anchor",
      "type": "basic3d:group",
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
  "scene": "scenes/door.scene.json",
  "props": { "openAmount": 0.5 }
}
```

## Workflow summary

```text
define schema → create scene/entities → compose scenes → validate → bake → playtest
```

The editor stays generic. The schema defines the vocabulary. The engine implements the vocabulary. The data composes it.

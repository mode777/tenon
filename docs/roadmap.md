# Roadmap

Tenon is built as a sequence of demoable MVPs. Each milestone must produce something that can be evaluated, not just infrastructure.

Rules for every milestone:

- There is a concrete demo.
- Acceptance criteria are observable.
- The data model does not take a shortcut that would be thrown away.
- Anything not needed for the demo is out of scope.

## Milestone overview

| Milestone | Outcome | Demo |
|---|---|---|
| **M0** | Data foundation | Validate a hand-written project |
| **M1** | First editor | Create a type, place an entity, edit properties, save/reload |
| **M2** | Scenes and composition | Instance a scene, promote a field, attach an entity to a slot |
| **M3** | Events | Internal button emits an event; host reacts |
| **M4** | Generators and bake | Parameterized mesh previews, bakes, and loads at runtime |
| **M5** | Lightmap integration | Baked lightmap loads from the runtime build |
| **M6** | 1.0 evaluation | End-to-end authoring and playtest without editor code |

---

## M0 — Data foundation

**Goal:** prove the data model before building UI.

**Build**

- Project manifest and relative-path resolution.
- Schema bundle format: namespaces, versions, enums, property groups, entity types, fields, events.
- Entity instance format.
- Scene document format: flat entity list, root, parent IDs, promotions, slots.
- Validation: schema, types, defaults, duplicate IDs, references, cycles, slots.
- A headless loader and validator.
- A hand-written sample project.

**Demo**

```text
tenon validate examples/basic
```

The sample loads, resolves defaults, and reports errors for deliberately broken references.

**Done when**

- A schema, scene, and entity instances can be parsed and validated without an editor.
- Defaults resolve as group → type → instance.
- Broken references, duplicate IDs, and hierarchy cycles fail with clear errors.

**Not in this milestone:** UI, viewport, generator execution, runtime build.

---

## M1 — First editor

**Goal:** create and place entities through the editor.

**Build**

- Browser editor shell.
- Minimal schema editor: create property groups, entity types, fields, enums, and defaults.
- 3D viewport with three.js, React Three Fiber, and drei.
- Entity palette.
- Place, select, move, rotate, and scale entities.
- Schema-generated inspector.
- Save and reload scene documents.
- Undo/redo with a command stack.
- Validation panel.

**Demo**

1. Create a new entity type in the schema editor.
2. Add a field and a default.
3. Place two instances in the viewport.
4. Override a property on one instance.
5. Save, reload, and confirm the result.

**Done when**

- Creating a new type requires no editor code.
- Entities can be placed, transformed, edited, duplicated, deleted, saved, and reloaded.
- The inspector is generated from the schema.
- Validation catches missing types, bad values, and duplicate IDs.
- An in-editor debug spawn can instantiate the scene and print the flat property list.

**Not in this milestone:** scene instancing, promotions, slots, events, generators, lightmap bake.

---

## M2 — Scenes and composition

**Goal:** make reusable scenes with a clear boundary.

**Build**

- Save any entity tree as a scene document.
- Scene instance node: `scene` reference plus root and promoted property overrides.
- Atomic scene instances: internal entities are read-only from the host.
- Direct-child promotions for fields.
- Slots: named transforms exposed by a scene.
- Host attachment to slots.
- Input entity refs.
- Hierarchy validation: one parent, no cycles, valid slot.
- Scene requirements: schema namespaces and versions.

**Demo**

1. Build a train scene with body, wheels, and a `button_0` slot.
2. Instance the train in a level.
3. Attach a separate button entity to `button_0`.
4. Move the train; the button moves with it.
5. Promote a train property and override it on the instance.

**Done when**

- A scene can be instanced without exposing its internals.
- Promotions reach direct children only.
- Host entities attach only through declared slots.
- Removing a slot or promotion breaks validation with a clear error.
- A debug expansion resolves the scene instance into concrete entities.

**Not in this milestone:** events, generators, lightmap bake.

---

## M3 — Events

**Goal:** let scenes communicate without exposing internals.

**Build**

- Event declarations on entity types.
- Optional typed payloads.
- Direct-child event promotions.
- Host/engine binding by name.
- Debug event log in the editor.
- A small in-editor runtime harness that binds a promoted event.

**Demo**

1. Keep a button internal to the train scene.
2. Promote `onButtonPressed` to the train root.
3. Bind the event in the level runtime.
4. Press the button; a door opens.

**Done when**

- Events are declared by entity types, not instances.
- Scenes promote only direct child events.
- The host binds promoted events by name.
- Payload-less events work end to end.
- A typed payload event works end to end.
- Events are bound by name without authoring scripting.

**Not in this milestone:** generators, lightmap bake.

---

## M4 — Generators and runtime bake

**Goal:** make parametric assets and a real runtime build.

**Build**

- Generator definition and instance format.
- Generator parameter editor and preview.
- A simple script generator with parameters and seed.
- Build command/UI: resolve scenes, run generators, bake meshes.
- Runtime format: manifest, entities, mesh buffers, lightmap placeholders.
- Minimal runtime viewer that loads a build.
- Build validation and clear errors.

**Demo**

1. Add a parametric floor-ring generator.
2. Change radius and segments; preview updates.
3. Add a house generator that produces a shell and door opening.
4. Place a separate door entity in the opening.
5. Build the level.
6. Load the runtime build in the viewer.
7. Confirm the generator does not run at runtime and the door remains interactive.

**Done when**

- Authoring stores generator parameters, not generated geometry.
- Build output contains baked meshes and resolved entities.
- Runtime loads the build without generator scripts.
- Scene instances no longer exist at runtime; they are resolved entities.
- Changing a generator parameter and rebuilding produces a new runtime result.

**Not in this milestone:** lightmap baking.

---

## M5 — Lightmap integration

**Goal:** prove lightmaps are a build artifact, not a scene entity.

**Build**

- Authoring-level lightmap bake settings.
- Build pipeline hook for an external lightmapper.
- Runtime lightmap data: atlas, per-mesh UVs, assignments.
- Editor preview of the last bake.
- Validation for missing or stale bake data.

**Demo**

1. Place lights and static geometry in a level.
2. Set lightmap bake settings.
3. Run the bake.
4. Build and load the runtime level.
5. Confirm the lightmap appears at runtime and the authoring document remains unchanged.

**Done when**

- Lightmap settings live in authoring.
- Lightmap textures and UVs live only in the build.
- The runtime loads lightmaps without editor code.
- Lightmap data is a build artifact, not a scene entity.
- Rebuilding regenerates the artifact.

**Not in this milestone:** additional bake artifacts beyond the lightmap integration point.

---

## M6 — 1.0 evaluation

**Goal:** prove the whole concept is usable by someone who did not build it.

**Build**

- Onboarding and sample project.
- Polished validation and error recovery.
- Performance pass for entity-heavy scenes.
- Documentation for schema authoring, scene composition, events, generators, and build.
- A small sample world that exercises the full model.

**Evaluation demo**

A new user must be able to:

1. Create a schema with a few entity types.
2. Place and edit entities in a level.
3. Create a reusable scene.
4. Instance it and override a promoted field.
5. Attach an entity to a slot.
6. Promote and bind an event.
7. Add a parametric generator.
8. Bake and playtest.

**Done when**

- The full workflow can be completed without editing editor source code or hand-editing JSON.
- The sample world demonstrates schema, entities, scenes, promotions, slots, events, generators, and bake.
- Validation errors are actionable.
- The runtime build loads without the editor or generator tooling.
- The concept is understandable from the docs and the sample.

---

## Evaluation gates

After every milestone, ask:

- Can the demo be completed without hand-editing data?
- Does the result teach us something about the concept, not just the implementation?
- Did we add a concept that is not in the core model?
- Is the authoring/runtime boundary still clean?
- Can a new entity type be added without editor code?
- Can a scene be reused without exposing its internals?
- Does the runtime avoid generators, editor metadata, and authoring data?

A milestone is not done if the only proof is internal code or tests. There must be a user-visible demo.

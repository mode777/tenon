# Roadmap

Tenon is built as a sequence of demoable MVPs. Each milestone must produce something that can be evaluated, not just infrastructure.

Rules for every milestone:

- There is a concrete demo.
- Acceptance criteria are observable.
- Usability is part of the demo, not deferred to a polish pass.
- The data model does not take a shortcut that would be thrown away.
- Anything not needed for the demo is out of scope.

## Milestone overview

| Milestone | Outcome | Demo |
|---|---|---|
| **M0** | Data foundation | Validate a hand-written project |
| **M1** | Schema editor | Create, compose, and validate a schema, save/reload in Exo |
| **M2** | Scene editor and scene composition | Instance a scene, promote a field, attach an entity to a slot |
| **M3** | Events | Internal button emits an event; host reacts |
| **M4** | Generators and bake | Parameterized mesh previews, bakes, and loads at runtime |
| **M5** | Lightmap integration | Baked lightmap loads from the runtime build |
| **M6** | 1.0 evaluation | End-to-end authoring and playtest without editor code |

---

## M0 — Data foundation

**Goal:** prove the data model before building UI.

**Build**

- Project manifest and schema location resolution.
- Schema bundle format: namespaces, versions, enums, entity definitions, abstract flags, composition, fields, events.
- Schema identity and resolution: `namespace@version`, builtin, project-relative, and HTTPS locations; no local copy of `basic3d`.
- Default empty scene: current `basic3d@<version>` with a `basic3d:node` root.
- Entity instance format, including the built-in transform and concrete definition references.
- Scene document format: flat entity list, root, parent IDs, transforms, promotions, slots.
- Validation: schema resolution, composition cycles/collisions, abstract instantiation, defaults, duplicate IDs, references, cycles, transforms, slots.
- A headless loader and validator.
- A hand-written sample project.

**Demo**

```text
tenon validate examples/basic
```

The sample loads, resolves defaults, and reports errors for deliberately broken references.

**Done when**

- A schema, scene, and entity instances can be parsed and validated without an editor.
- A new scene resolves builtin `basic3d` and defaults to a `basic3d:node` root without a local schema copy.
- Defaults resolve through definition composition, then the instance; omitted transforms resolve to identity.
- Abstract definitions cannot be instantiated; composition cycles, field/event collisions, broken references, duplicate IDs, and hierarchy cycles fail with clear errors.

**Not in this milestone:** UI, viewport, generator execution, runtime build.

---

## M1 — Schema editor

**Goal:** author, compose, validate, and save schemas inside Exo without hand-editing JSON. Usability is the acceptance bar, not a later polish pass.

**Build**

- Tenon Exo plugin scaffold: manifest, controller, project hub panel, and schema editor frame.
- `tenon.schema` new-file template, exposed by the shell as **New Schema** in the command palette and New File menu.
- Project hub panel: schema list and a New Schema action.
- Open existing schema bundles from the project hub or the Exo file tree.
- Schema editor frame, designed for usability (see [Schema editor UI](schema-editor-ui.md)):
  - bundle header for `id`, `namespace`, and `version`;
  - definition sidebar with abstract/concrete groups, search, create, rename, and delete;
  - definition detail with abstract toggle, documentation, and composition chips;
  - field table with type-aware inline editors, defaults, required state, and origin badges;
  - field type support for `string`, `int`, `float`, `bool`, `enum`, `color`, `vec2`, `vec3`, `assetRef`, and `entityRef`; `array<T>`, `flags`, and `nullable` are preserved but deferred;
  - enum editor with ordered values;
  - event declarations with typed payload fields;
  - effective fields/events view with origin badges;
  - read-only builtin `basic3d` bundle;
  - validation drawer with jump-to-issue;
  - undo/redo per document.
- Shell integration: dirty, save, save conflict, external change, read-only workspace, and theme behavior.
- Schema validation: structure, IDs, abstract/concrete rules, composition cycles/collisions, defaults, enum references, and event payloads.
- The M1 editor uses the open bundle plus builtin `basic3d`; project import editing and remote bundle UI arrive with M2.

**Demo**

1. Open the M0 sample project in the Exo shell and enable the Tenon plugin.
2. Run **New Schema** from the command palette; name it `gameA.schema.json`.
3. Open the new schema from the explorer.
4. Set namespace `gameA` and version `1.0.0`.
5. Create abstract `gameA:renderable` with `visible` and `castShadows`.
6. Create abstract `gameA:damageable` with `health` and a `damaged` event with an `amount` payload.
7. Create enum `ButtonStyle` with `primary` and `secondary`.
8. Create concrete `gameA:button` composing both, with `label`, `enabled`, a `style` enum field, and a `pressed` event.
9. Create `gameA:elevatorButton` composing `gameA:button` and override the `label` default.
10. Inspect `gameA:button` effective fields/events and their origins.
11. Introduce a cyclic composition or a duplicate field, confirm validation points at the field, then fix it.
12. Save, close and reopen the workspace, and confirm the schema reloads with the same result.

**Done when**

- New Schema is available from the command palette and New File menu through the shell template, and as a create-and-open action in the project hub.
- The schema editor round-trips the schema format without data loss.
- Definitions, abstract flags, composition, fields, enums, defaults, and event payloads are editable.
- Effective fields and events match composition and default rules.
- Validation catches composition cycles, field/event collisions, duplicate IDs, invalid defaults, missing enums, abstract/concrete errors, and payload errors.
- Builtin `basic3d` is read-only and available without a workspace copy.
- Shell save/reload, dirty, conflict, read-only, and theme behavior work.
- Adding a definition or field requires no editor code and no modal for the common path.
- A definition with several fields can be authored entirely with keyboard and inline controls.
- The MVP acceptance walkthrough in [Schema editor UI](schema-editor-ui.md) passes without hand-edited JSON.
- The schema editor frame does not load the 3D viewport or scene code.

**Not in this milestone:** scene/level editing, 3D viewport, entity placement, scene composition, runtime events, generators, build/bake, lightmaps, project import editor, remote schema UI, editor hints, cross-file refactors.

---

## M2 — Scene editor and scene composition

**Goal:** create, place, and compose reusable scenes with a clear boundary.

**Build**

- Project manifest and import resolution for scene schemas.
- Minimal project editor: import map, resolved schema versions, and project-wide validation.
- New Scene action on the project hub.
- Scene editor frame for `scenes/*.scene.json` and `levels/*.scene.json`.
- 3D viewport with three.js, React Three Fiber, and drei.
- Scene hierarchy, schema-generated inspector, entity palette (concrete definitions only), and asset browser.
- Place, select, move, rotate, scale, duplicate, and delete entities.
- Save and reload scene documents through the shell; undo/redo per document.
- Level mode: the same scene editor with level-only controls.
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

- Scene entities can be placed, transformed, edited, duplicated, deleted, saved, and reloaded.
- The inspector is generated from the schema; the palette shows concrete definitions only.
- A glb in `assets/` can be selected and placed as a mesh instance.
- Every entity has a transform; omitted transforms are identity.
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

- Use event declarations and composed payloads authored in the schema editor.
- Direct-child event promotions.
- Host/engine binding by name.
- Debug event log in the scene editor.
- A small in-editor runtime harness that binds a promoted event.

**Demo**

1. Keep a button internal to the train scene.
2. Promote `onButtonPressed` to the train root.
3. Bind the event in the level runtime.
4. Press the button; a door opens.

**Done when**

- Events are declared by definitions, not instances.
- Composed definitions contribute event declarations to the concrete definition.
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
- Generator editor: parameter form, seed, and preview.
- New Generator action on the project hub.
- A simple script generator with parameters and seed.
- Build command (CLI/CI): resolve scene composition, run generators, bake meshes.
- Project editor shows build readiness and the exact command; the plugin does not write build artifacts.
- Runtime format: manifest, entities with local transforms and parent links, mesh buffers, lightmap placeholders.
- Minimal runtime viewer that loads a build.
- Build validation and clear errors.

**Demo**

1. Create a generator from the project hub, then add a parametric floor-ring generator.
2. Change radius and segments; preview updates.
3. Add a house generator that produces a shell and door opening.
4. Place a separate door entity in the opening.
5. Build the level with the project build command.
6. Load the runtime build in the viewer.
7. Confirm the generator does not run at runtime and the door remains interactive.

**Done when**

- Authoring stores generator parameters, not generated geometry.
- Build output contains baked meshes and resolved entities.
- The build runs outside the Exo plugin; the plugin itself writes no build artifacts.
- Runtime loads the build without generator scripts.
- Scene instances no longer exist at runtime; they are resolved entities.
- The resolved entity tree keeps parent links and local transforms; moving a parent moves its children.
- Slot attachments survive as concrete parent links, so an attached entity moves with its host.
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

- Exo plugin onboarding and sample project.
- Usability pass on the schema editor: keyboard flow, search, and validation recovery.
- Complete schema field type coverage, including `array<T>`, `flags`, and `nullable`.
- Polished validation and error recovery.
- Performance pass for entity-heavy scenes.
- Documentation for schema authoring, schema resolution, scene composition, events, generators, build, and the Exo host boundary.
- A small sample world that exercises the full model.

**Evaluation demo**

A new user must be able to:

1. Install the Tenon plugin in the Exo shell and open the sample workspace.
2. Create a schema with the New Schema action, using abstract and concrete definitions and composition.
3. Place and edit entities in a level.
4. Create a reusable scene.
5. Instance it and override a promoted field.
6. Attach an entity to a slot.
7. Promote and bind an event.
8. Add a parametric generator.
9. Bake and playtest.

**Done when**

- The full workflow can be completed without editing editor source code or hand-editing JSON.
- The sample world demonstrates schema, entities, scenes, promotions, slots, events, generators, and bake.
- Schema authoring is fast: new definition, field, default, and composition need no modal or hand-edited JSON.
- Validation errors are actionable.
- The runtime build loads without the editor or generator tooling.
- The Exo boundary holds: the shell owns workspace, tabs, saves, dirty state, and theme; Tenon owns the format editors.
- The concept is understandable from the docs and the sample.

---

## Evaluation gates

After every milestone, ask:

- Can the demo be completed without hand-editing data?
- Does the result teach us something about the concept, not just the implementation?
- Did we add a concept that is not in the core model?
- Is the authoring/runtime boundary still clean?
- Is the Exo boundary clean: no `exo.json` or `.exo/**` access, and no plugin-originated write outside the open document?
- Can a schema be authored and validated in the schema editor without hand-editing JSON?
- Is the common schema path fast: new definition → add field → set default → compose?
- Does the editor show the effective fields/events and explain composition errors in place?
- Can a new concrete definition be added, including composition, without editor code or a new format editor?
- Can a scene be reused without exposing its internals?
- Does the runtime avoid generators, editor metadata, and authoring data?

A milestone is not done if the only proof is internal code or tests. There must be a user-visible demo.

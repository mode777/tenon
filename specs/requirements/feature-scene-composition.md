# Feature: Scene composition

Scenes compose through atomic instances, direct-child promotions, and slots. The public
surface is the only API a host scene may use; instance internals stay private.

## Requirements

- `COMP-INSTANCE` — Scene instances reference scene documents.
  A scene instance shall use a `scene` reference instead of a `type`, carry its own transform,
  and allow overrides only for the referenced scene root's effective fields and the scene's
  promoted fields.
  Why: reusable scenes need a stable, placeable boundary.
  Fit: a train instance can be placed and its `power` promotion overridden in the level.
  Evidence: `plugin/src/core/scene.ts` (`SceneEntity.scene`, `sceneSurface`),
  `examples/m2-workspace/levels/level01.scene.json`, TD-07, TD-08.

- `COMP-ATOMIC` — Instance internals are private.
  A scene instance shall be atomic from the host: its internal entities shall be read-only,
  and host content shall attach only through declared slots.
  Why: encapsulation prevents hosts from depending on internal structure.
  Fit: the level hierarchy shows the train instance as one node; internal train entities are
  not editable from the level.
  Evidence: `plugin/src/core/scene.ts`, `plugin/src/scene/panels/InspectorPanel.tsx`,
  `docs/editor-concept.md`.

- `COMP-PROMOTIONS` — Promotions expose direct children.
  A scene shall promote fields and events from **direct children only** to its root; promoted
  names shall be treated as public API.
  Why: each composition layer should expose only what it intends to support, without deep
  paths.
  Fit: promoting `engine.power` makes `power` available on the instance; a grandchild field
  cannot be promoted directly.
  Evidence: `plugin/src/core/scene.ts` (`sceneSurface`, `addPromotion`),
  `plugin/src/scene/panels/InspectionPanel.tsx`, TD-08.

- `COMP-SLOTS` — Slots expose attachment transforms.
  A scene shall declare named slots pointing at child transforms; a host entity shall attach
  with `parent` plus `slot`, and an attachment to an undeclared slot shall be invalid.
  Why: slots are the only supported cross-boundary attachment point.
  Fit: the level button attaches to `button_0`; removing the slot produces a validation error.
  Evidence: `plugin/src/core/scene.ts` (`addSlot`, `slotNamesForInstance`, `validateScene`),
  `examples/m2-workspace/scenes/train.scene.json`, TD-10.

- `COMP-SURFACE` — Public surface is explicit.
  A scene's public surface shall consist of the root's effective fields and events, fields
  and events promoted from direct children, and declared slots; compatibility shall be
  structural.
  Why: hosts and nested scenes need a predictable contract without seeing internals.
  Fit: the Inspection panel's Public surface tab lists root, promoted, and slot entries.
  Evidence: `plugin/src/core/scene.ts` (`sceneSurface`),
  `plugin/src/scene/panels/InspectionPanel.tsx`, `docs/editor-concept.md`.

- `COMP-OVERRIDES` — Only public values are overridable.
  Instance `props` shall override only the referenced root's effective fields and the
  scene's promoted fields; attempts to set internal entities or fields shall be invalid.
  Why: overrides are part of the composition API, not a back door into the instance.
  Fit: `power` overrides the promoted field; an internal-only field is not offered and is
  rejected.
  Evidence: `plugin/src/core/scene.ts` (`validateScene`),
  `plugin/src/scene/panels/InspectorPanel.tsx`, TD-08.

- `COMP-VALIDATION` — Broken composition is visible.
  The editor shall report a missing scene, instance cycle, wrong promotion target, undeclared
  slot, removed slot/promotion, or invalid attachment as a validation error with
  jump-to-entity.
  Why: composition errors are cross-document and must be actionable.
  Fit: removing `button_0` or the `power` promotion marks the level with a jumpable error.
  Evidence: `plugin/src/core/scene.ts` (`validateScene`, `expandScene`),
  `docs/scene-editor-ui.md`.

- `COMP-INPUT-REF` — Promoted input entity refs stay host-scoped.
  A promoted property may be an input entity reference that the host supplies and the scene
  forwards to an internal entity; internal references shall not be exposed outward.
  Why: hosts need to connect gameplay links without receiving references to scene internals.
  Fit: a promoted `entityRef` resolves in the host scope; an internal reference is not
  returned to the host.
  Evidence: `plugin/src/core/scene.ts` (`schema` field types, `sceneSurface`),
  `docs/editor-concept.md`, TD-08, TD-17.

## Sources

- `plugin/src/core/scene.ts`
- `plugin/src/scene/panels/InspectionPanel.tsx`
- `plugin/src/scene/panels/InspectorPanel.tsx`
- `examples/m2-workspace/scenes/train.scene.json`
- `examples/m2-workspace/levels/level01.scene.json`
- `docs/editor-concept.md`
- `docs/scene-editor-ui.md`
- `docs/technical-decisions.md` TD-07, TD-08, TD-10, TD-17, TD-23

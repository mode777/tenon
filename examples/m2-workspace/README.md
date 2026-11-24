# M2 demo workspace

A complete Tenon M2 project: schemas, a reusable train scene, a level that instances
it, and a GLB mesh asset. Requires Exo shell **0.10.0+** for the scene panels.

```text
m2-workspace/
├─ exo.json
├─ project.json
├─ assets/
│  └─ cube.glb
├─ levels/
│  └─ level01.scene.json
├─ scenes/
│  └─ train.scene.json
└─ schemas/
   ├─ gameA.schema.json
   └─ shared.schema.json
```

## Open it

1. Open this folder as the workspace in the [Exo shell](https://mode777.github.io/exo-editor/)
   and approve the Tenon plugin consent prompt.
2. Open `project.json` in the **Tenon Project** editor. Confirm the import map and
   that the project reports no validation errors.
3. Open `scenes/train.scene.json`. The viewport shows the body, wheels, and the
   button mount. Select **Engine** to see the promoted `power` field.
4. Open `levels/level01.scene.json`. The train is a scene instance; the button is
   attached to its `button_0` slot.
5. Move the train. The attached button moves with it.
6. Select the train instance, override the promoted `power` field in the **Inspector**
   panel, and inspect the **Public surface** and **Debug expansion** tabs in the
   **Inspection** bottom panel.

## What it demonstrates

- `project.json` maps `gameA` and `shared` to project-relative schema locations.
- `gameA` imports `shared@1.0.0`, composes `shared:tintable`, and uses
  `shared:Tone` through its composed definition.
- `scenes/train.scene.json` has a `gameA:train` root, mesh children, an `engine`
  entity whose `power` field is promoted to the scene root, and a `button_0` slot.
- `levels/level01.scene.json` instances the train, overrides `power`, and attaches
  a `gameA:button` entity through the slot.
- `assets/cube.glb` is a real glTF binary used by the body and wheel mesh instances.
- Scene and asset references use workspace-absolute paths (`/scenes/…`, `/assets/…`);
  scene-relative paths (`../assets/…`) are equally valid and resolved against the
  containing scene.

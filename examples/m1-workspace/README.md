# M1 demo workspace

Open this folder in the deployed Exo shell:

<https://mode777.github.io/exo-editor/>

`exo.json` points at the deployed Tenon plugin. Approve the consent prompt, then
open `schemas/gameA.schema.json` with the Tenon Schema editor.

`gameA` imports the `shared` schema package. Open `schemas/gameA.schema.json`
with the Tenon Schema editor and expand **Imports** in the sidebar to browse the
read-only `shared:tintable` definition.

Try:

1. Select `gameA:button` and inspect the effective fields and their origins,
   including `tint` and `tone` from `shared:tintable`.
2. Change the `label` default and save with Ctrl/Cmd+S.
3. Add a field or an enum value.
4. Run **New Schema** from the command palette, or use **New Schema** in the
   Tenon panel, to create another bundle.
5. Cause a composition cycle and use the validation drawer to jump to it.
6. Change the namespace in the bundle header and confirm the bundle's definition
   IDs are rewritten while `shared:tintable` stays imported.
7. Create another schema bundle, then import it from the sidebar and compose one
   of its definitions.

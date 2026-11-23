# M1 demo workspace

Open this folder in the deployed Exo shell:

<https://mode777.github.io/exo-editor/>

`exo.json` points at the deployed Tenon plugin. Approve the consent prompt, then
open `schemas/gameA.schema.json` with the Tenon Schema editor.

Try:

1. Select `gameA:button` and inspect the effective fields and their origins.
2. Change the `label` default and save with Ctrl/Cmd+S.
3. Add a field or an enum value.
4. Run **New Schema** from the command palette, or use **New Schema** in the
   Tenon panel, to create another bundle.
5. Cause a composition cycle and use the validation drawer to jump to it.

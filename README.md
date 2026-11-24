# Tenon

**Compose worlds from entities.**

Tenon is a browser-based, schema-driven 3D entity and scene editor. It keeps authoring data separate from engine-specific runtime builds.

The authoring pipeline defines entities, composes them into reusable scenes, and produces a baked runtime world. Game behavior lives in engine classes; the editor stays generic and data-only.

The editor is designed as one Exo editor plugin. The plugin contributes a separate visual editor for each authoring format — project, schema, scene/level, and generator — while the Exo shell owns the workspace, tabs, dirty state, saves, consent, and theme.

The first editor milestone is the schema editor. It contributes a Tenon project hub panel and a **New Schema** command to the Exo command palette, then authors definitions, composition, fields, enums, and events in a dedicated frame. Schemas can import other schema bundles as versioned packages and compose their definitions.

## Live editor

- Exo shell: <https://mode777.github.io/exo-editor/>
- Tenon plugin manifest: <https://mode777.github.io/tenon/exo-manifest.json>
- M1 demo workspace: [`examples/m1-workspace`](examples/m1-workspace/README.md)
- Requires Exo shell **0.8.0+** for command-scoped file creation.

Open the demo workspace folder in the Exo shell, approve the Tenon consent prompt, and open `schemas/gameA.schema.json`.

## Local development

```bash
npm install
npm run dev          # plugin dev server on http://localhost:5175
npm test             # schema model, editor, and project hub tests
npm run typecheck
npm run build        # production plugin in plugin/dist
```

Point a workspace's `exo.json` at `http://localhost:5175/exo-manifest.json` while the dev server is running. The deployed plugin is built from `plugin/` and served at `/tenon/` by GitHub Pages.

## Documents

- [Editor concept](docs/editor-concept.md) — how Tenon works, the format editors, and how entities and scenes are created.
- [Schema editor UI](docs/schema-editor-ui.md) — the M1 schema editor layout, interactions, and MVP scope.
- [Technical decisions](docs/technical-decisions.md) — the data model, formats, pipeline, editor stack, and Exo plugin boundary.
- [Roadmap](docs/roadmap.md) — MVP-driven milestones with demos and acceptance criteria.
- [basic3d schema reference](docs/basic3d.schema.json) — the builtin core schema shipped with the Tenon plugin and engine.

## Agent skill

- [Create Exo plugin](.agents/skills/create-exo-plugin/SKILL.md) — vendored skill for building, testing, and hosting the editor plugin.

## Status

M1 is implemented: the Tenon Exo plugin, project hub, New Schema command, and the schema editor with definitions, schema package imports, cross-bundle composition, editable namespace, fields, enums, events, effective views, validation, undo/redo, and shell save/conflict handling. The design docs remain the source of truth for the later scene, event, generator, and lightmap milestones.

## Repository layout

```text
tenon/
├─ .agents/
│  └─ skills/
│     └─ create-exo-plugin/
│        └─ SKILL.md
├─ .github/
│  └─ workflows/
│     └─ deploy.yml
├─ AGENTS.md
├─ README.md
├─ package.json
├─ package-lock.json
├─ examples/
│  └─ m1-workspace/
├─ sdk/                    # vendored @exo/plugin-sdk
├─ plugin/                 # Tenon Exo plugin
│  ├─ public/exo-manifest.json
│  ├─ src/controller.ts
│  ├─ src/core/
│  ├─ src/project/
│  ├─ src/schema/
│  ├─ plugin.html
│  ├─ editor.html
│  └─ views/project.html
└─ docs/
   ├─ editor-concept.md
   ├─ schema-editor-ui.md
   ├─ technical-decisions.md
   ├─ roadmap.md
   └─ basic3d.schema.json
```

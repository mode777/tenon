# Tenon

**Compose worlds from entities.**

Tenon is a browser-based, schema-driven 3D entity and scene editor. It keeps authoring data separate from engine-specific runtime builds.

The authoring pipeline defines entities, composes them into reusable scenes, and produces a baked runtime world. Game behavior lives in engine classes; the editor stays generic and data-only.

The editor is designed as one Exo editor plugin. The plugin contributes a separate visual editor for each authoring format — project, schema, scene/level, and generator — while the Exo shell owns the workspace, tabs, dirty state, saves, consent, and theme.

M1 implements the schema editor: a Tenon project hub panel, the **New Schema** command, and a dedicated frame for definitions, composition, fields, enums, events, imports, and validation.

M2 implements the project and scene editors: the `project.json` import map and project-wide validation, the **New Scene** action, and a three.js scene/level editor with entity placement, transforms, shell-hosted Inspector and Inspection panels, scene instances, promotions, slots, and runtime expansion.

## Live editor

- Exo shell: <https://mode777.github.io/exo-editor/>
- Tenon plugin manifest: <https://mode777.github.io/tenon/exo-manifest.json>
- M1 schema workspace: [`examples/m1-workspace`](examples/m1-workspace/README.md)
- M2 scene workspace: [`examples/m2-workspace`](examples/m2-workspace/README.md)
- Requires Exo shell **0.10.0+** for the scene Inspector/Inspection panels, active-editor context, and command-scoped file creation.

Open either demo workspace folder in the Exo shell, approve the Tenon consent prompt, and open `project.json`, a schema, or a scene/level document.

## Local development

```bash
npm install
npm run dev          # plugin dev server on http://localhost:5175
npm test             # schema, project, scene, panel, and bridge tests
npm run typecheck
npm run build        # production plugin in plugin/dist
```

Point a workspace's `exo.json` at `http://localhost:5175/exo-manifest.json` while the dev server is running. The deployed plugin is built from `plugin/` and served at `/tenon/` by GitHub Pages.

## Documents

- [Editor concept](docs/editor-concept.md) — how Tenon works, the format editors, and how entities and scenes are created.
- [Schema editor UI](docs/schema-editor-ui.md) — the M1 schema editor layout, interactions, and MVP scope.
- [Project and scene editors](docs/scene-editor-ui.md) — the M2 project import map, scene/level editor, shell Inspector/Inspection panels, promotions, slots, and debug expansion.
- [Technical decisions](docs/technical-decisions.md) — the data model, formats, pipeline, editor stack, and Exo plugin boundary.
- [Roadmap](docs/roadmap.md) — MVP-driven milestones with demos and acceptance criteria.
- [basic3d schema reference](docs/basic3d.schema.json) — the builtin core schema shipped with the Tenon plugin and engine.

## Agent skill

- [Create Exo plugin](.agents/skills/create-exo-plugin/SKILL.md) — vendored skill for building, testing, and hosting the editor plugin.

## Status

M1 and M2 are implemented. The plugin ships a project hub, New Schema and New Scene commands, the schema editor, the project import-map editor with project-wide validation, and the scene/level editor with a three.js viewport, hierarchy, shell-hosted Inspector and Inspection panels, palette, asset browser, scene instances, direct-child field promotions, slots, attachments, undo/redo, and save/conflict handling. The scene panels follow the active editor through Exo 0.10.0's active-editor context and a plugin-local snapshot/command bridge. The design docs remain the source of truth for the later events, generators, lightmap, and runtime-build milestones.

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
│  ├─ m1-workspace/
│  └─ m2-workspace/
├─ sdk/                    # vendored @exo/plugin-sdk
├─ plugin/                 # Tenon Exo plugin
│  ├─ public/exo-manifest.json
│  ├─ src/controller.ts
│  ├─ src/core/
│  ├─ src/project/         # project hub panel
│  ├─ src/project-editor/  # project.json editor
│  ├─ src/schema/          # schema editor
│  ├─ src/scene/           # scene/level editor, viewport, and panel bridge
│  ├─ src/scene/panels/    # Inspector/Inspection view frames
│  ├─ editors/
│  │  ├─ project.html
│  │  ├─ schema.html
│  │  └─ scene.html
│  ├─ plugin.html
│  └─ views/
│     ├─ project.html
│     ├─ inspector.html
│     └─ inspection.html
└─ docs/
   ├─ editor-concept.md
   ├─ schema-editor-ui.md
   ├─ scene-editor-ui.md
   ├─ technical-decisions.md
   ├─ roadmap.md
   └─ basic3d.schema.json
```

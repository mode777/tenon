# AGENTS.md

## What this repo is

Tenon is a browser-based, schema-driven 3D entity and scene editor. The repo contains
the implemented M1 and M2 Tenon Exo plugin (`plugin/`), its vendored SDK (`sdk/`), demo
workspaces (`examples/m1-workspace/`, `examples/m2-workspace/`), and the design docs.
Event, generator, lightmap, and runtime-build milestones remain design-only.

The plugin, manifest, project hub, schema editor, project editor, scene/level editor,
and example workspaces exist. Future roadmap formats (`generators/`, `build/`, generator
scripts, generator editor) are still planned; do not create them just to "verify" a doc.

## Where things live

- `README.md` — pitch, live URLs, development commands, document index, status.
- `plugin/` — implemented Tenon Exo plugin: manifest, controller, project hub, schema editor, project editor, scene/level editor.
- `sdk/` — vendored `@exo/plugin-sdk`; keep unmodified against upstream.
- `examples/m1-workspace/` — live M1 demo workspace with sample schemas.
- `examples/m2-workspace/` — live M2 demo workspace with schemas, a train scene, a level, and a GLB asset.
- `.github/workflows/deploy.yml` — GitHub Pages deployment for the plugin.
- `docs/editor-concept.md` — conceptual model and authoring workflow.
- `docs/schema-editor-ui.md` — schema editor layout, interactions, and M1 scope.
- `docs/scene-editor-ui.md` — project editor, scene/level editor, composition, promotions, slots, and M2 scope.
- `docs/technical-decisions.md` — formats and pipeline, decisions `TD-01`…`TD-30`.
- `docs/roadmap.md` — milestones `M0`–`M6`, each with a demo and acceptance criteria.
- `docs/basic3d.schema.json` — reference for the builtin `basic3d` schema.
- `.agents/skills/create-exo-plugin/SKILL.md` — vendored Exo plugin authoring skill.

## Editing docs

- Core rules are intentionally repeated across `editor-concept.md`,
  `technical-decisions.md`, and `roadmap.md`. When changing one, grep for the rule and
  update every copy; the docs must not drift. This includes the Exo host boundary and
  the per-format editor split. Keep `schema-editor-ui.md` consistent with the M1 scope.
- Keep `TD-NN` and `M#` identifiers stable. Append new decisions with the next TD
  number; never renumber existing ones.
- Keep README's document index/status consistent with any doc change.
- Preserve roadmap discipline: sequential milestones, one concrete user-visible demo
  each, and the "Not in this milestone" exclusions. Don't describe future-milestone
  behavior as current or add features beyond the milestone being designed.

## Working on the plugin

- `plugin/` is the source; `plugin/dist/` is generated. `sdk/` is vendored and must stay
  unmodified so it can be diffed against upstream.
- Use the Exo plugin SDK for every handshake, envelope, file read, save, command, and
  theme change. Never hand-write `postMessage` frames.
- Before shipping: `npm test`, `npm run typecheck`, and `npm run build`.
- The format editors must not read or write `exo.json` or `.exo/**`, and must not write
  another workspace file. Saves go through `onSaveRequest`; new files go through the
  New Schema/New Scene commands and shell-owned `requestNewFile` dialog.

## Git workflow

- Always commit and push completed work without waiting for a separate request.
- Use a concise imperative commit message and push to the current branch (`main` unless
  the task says otherwise).
- After pushing, verify the GitHub Actions run and the deployed result when the change
  affects the hosted plugin. Report the commit, push, and deployment status.
- Never commit secrets, credentials, or generated build output.

## Model invariants (do not contradict)

- Authoring is engine-agnostic JSON; the runtime build is engine-specific and one-way.
  Runtime contains no generators, editor metadata, scene instances, or authoring data.
- Every entity has a built-in transform (position/rotation/scale) stored outside
  `props`; omitted transforms are identity. Transforms are never promoted; a scene
  instance transform places the referenced scene.
- Runtime is a flat entity list, but **not** a flat transform hierarchy. Scene
  resolution removes scene-instance boundaries and slot names while keeping concrete
  parent links and local transforms, so moving a parent moves its children. World
  transforms computed at build time are only caches; parent changes must propagate.
- There are no property groups. Schema bundles use one `definitions` map; instances
  still reference a single concrete `type` ID. Composition is on definitions, not
  instances. A definition may compose abstract or concrete definitions at schema/build
  time. Composition contributes fields, defaults, and events only — never engine classes,
  behavior, instantiability, abstract status, or palette visibility. Abstract
  definitions are hidden, non-instantiable, and have no class; concrete definitions are
  instantiable and map to one engine class.
- Defaults resolve through definition composition, then the instance. Runtime gets one
  flat property map; the engine never sees definitions or composition.
- Schema identity is `namespace@version`; a bundle declares its dependencies as
  exact `imports`, and project imports map namespaces to locations. Imported
  definitions are read-only and compose like builtin definitions; their enums are
  referenced as `namespace:Enum`. `basic3d` is builtin, implicit, immutable, and
  read-only; new scenes default to `basic3d@<current>` with a `basic3d:node` root.
  Locations may be `builtin:`, project-relative, or HTTPS; never absolute
  `file://` URLs in projects.
- Changing a bundle namespace rewrites that bundle's own definition IDs and local
  qualified references only. Cross-file refactors are never performed in the
  background; dependent documents surface validation errors.
- Mesh files are assets under `assets/`, referenced by `assetRef` fields. Adding one
  does not create entities; an instance of a mesh definition places one.
- Scene instances are atomic: internals are read-only from the host, and host content
  attaches only through declared slots. Promotions and slots reach **direct children
  only**; promoted field/event/slot names are public API (renames are breaking).
- Runtime `type` is a reserved qualified concrete definition ID (the `classname`
  equivalent), never a prop; abstract definition IDs never reach the runtime. The
  engine registry maps the exact ID to exactly one class. Scenes require
  `namespace@version`, IDs are stable and local, and display names never resolve
  references.
- Adding a concrete definition, including composition, must not require editor code or
  a new format editor. A level is just a scene document used as the top-level world.

## Editor host invariants (do not contradict)

- The Tenon editor is one Exo editor plugin. The Exo shell owns the workspace, tabs,
  dirty state, saves, consent, and theme. Tenon owns one frame editor per authoring
  format: project, schema, scene/level, and generator.
- `project.json` is Tenon's manifest. `exo.json` and `.exo/**` are shell-owned; Tenon
  never reads, writes, or lists them.
- Format editors are per format, never per definition. Adding a definition changes
  schema data and adds no page, glob, or editor code.
- The project hub panel (`tenon.project`) is the only project-level shell panel. It hosts
  the New Schema and New Scene actions and is the target of the `tenon.new-schema` and
  `tenon.new-scene` commands. Per-document tools stay in editor frames; the scene
  Inspector and Inspection panels are document-scoped.
- New Schema and New Scene require Exo 0.8.0+ command-scoped user activation; the panel
  may call `requestNewFile` during its live command invocation without owning DOM focus.
- The schema and project editors are DOM-only frames. The scene editor is M2 and adds
  the three.js viewport; the generator editor is still later.
- Each open document is its own frame with its own buffer, selection, undo/redo, and
  validation. Frames do not share mutable state.
- The plugin writes only the open document through the shell save handler; new files
  come from user-invoked shell actions, and build and playtest run outside the plugin.

## Nanospec docs

Read [Project](specs/project.md), [Tech stack](specs/tech-stack.md), and
[Memory](specs/memory.md) first; read other specs only when relevant. Baseline specs are
updated only through `nsx-init`, `nsx-explore`, and `nsx-sync`; `nsx-retro` may update
`memory.md` only.

- [Project](specs/project.md)
- [Tech stack](specs/tech-stack.md)
- [Memory](specs/memory.md)
- [Requirements](specs/requirements/)
- [System architecture](specs/architecture/system.md)
- [Module architecture](specs/architecture/)
- [Active changes](changes/)
- [Archived changes](changes/archive/)

This file takes precedence over nanospec skill rules. In particular, the repository's commit,
push, and deployment workflow in this file governs when a nanospec skill says otherwise.

# System architecture

Tenon is one Exo editor plugin plus a pure authoring core. The shell owns the workspace and
document lifecycle; the plugin owns format-specific editor frames and validation. Engine
runtime and build tooling stay outside the plugin.

## Context

| Neighbour | Direction | Data / protocol |
|---|---|---|
| Technical designer | in/out | Browser UI: open documents, edit, save, inspect validation |
| Exo shell | both | Sandboxed iframe protocol through `@exo/plugin-sdk`; workspace read/list/write, tabs, dirty state, save, consent, theme, panels, commands |
| Workspace | in | JSON authoring documents under the workspace root plus `assets/**`; `project.json` is the Tenon manifest |
| GitHub Pages | out | Static plugin bundle from `plugin/dist`; manifest and frame pages |
| Tenon CLI/CI and engine | out | Consume authoring JSON; produce and run the engine-specific runtime build. Not implemented in this repository's plugin. |

## Constraints

- The plugin runs in a sandboxed iframe with no parent DOM access. Every host interaction uses
  the SDK; `postMessage` is never hand-written. (`../AGENTS.md`, TD-26)
- One Exo workspace is one Tenon project. `exo.json` and `.exo/**` are shell-owned and are
  never read, written, or listed by Tenon. (`../AGENTS.md`)
- The plugin edits and validates authoring JSON only. It never writes runtime build output.
  (`../AGENTS.md`, TD-19)
- Authoring data is engine-agnostic; concrete definition IDs map to engine classes only in
  the runtime build. (`../docs/technical-decisions.md` TD-01, TD-18)
- The manifest declares `engines.exo: ">=0.11.0"` and requests only `workspace:read`,
  `workspace:write`, `workspace:list`, and `events:subscribe`.
  (`../plugin/public/exo-manifest.json`)
- Shell menu and palette undo/redo require Exo 0.13.0+ and SDK 1.11.0; the frame controls and
  shortcuts keep 0.11.0+ usable. (`../sdk/`, TD-32)
- Format editors are per format, never per definition. (`../AGENTS.md`)
- Validation is live in each frame and project-wide in the project editor. Errors never block
  Save. (`../docs/technical-decisions.md` TD-16)
- The plugin is a static site on GitHub Pages; it has no server-side component.
  (`../.github/workflows/deploy.yml`)

## Building blocks

| Module | Responsibility | Depends on | Code / spec |
|---|---|---|---|
| Exo shell (external) | Workspace, tabs, dirty state, save execution, consent, theme, panel layout, file dialogs, commands | — | Exo contract; `plugin/public/exo-manifest.json` |
| Controller | Register file editors, panels, and commands; complete registration | SDK, manifest | `plugin/src/controller.ts` |
| Core model | Parse and serialize schema/project/scene JSON; resolve imports; compose definitions; validate; derive scene surfaces and debug expansion; load workspace; shared per-document history | SDK types only at the workspace edge | `plugin/src/core/`, [core model](core-model.md) |
| Project hub | List schemas/scenes/levels; New Schema and New Scene actions; open project settings | SDK view client, core templates | `plugin/src/project/` |
| Project editor | Edit `project.json` import map; project-wide schema/scene validation; build readiness | Core project/schema/scene | `plugin/src/project-editor/` |
| Schema editor | Author one schema bundle: identity, imports, definitions, composition, fields, enums, events, effective view, validation | Core schema | `plugin/src/schema/` |
| Scene/level editor | Author one scene or level: three.js viewport, transforms, scene instances, promotions, slots, debug expansion | Core scene, three.js/R3F | `plugin/src/scene/` |
| Scene panels | Hierarchy & Assets (primary), Inspector (secondary), and Inspection (bottom) shell panels; follow the active scene editor; request snapshots, send commands/intents | SDK view client, shared core, local topic | `plugin/src/scene/panels/`, [plugin surfaces](plugin-surfaces.md) |
| Vendored SDK | Protocol client, handshake, editor/view clients, theme | Upstream `@exo/plugin-sdk` | `sdk/` |
| Examples | M1 and M2 runnable workspaces and a GLB asset | Plugin release | `examples/` |
| CI/deploy | Install, test, build, and deploy `plugin/dist` to GitHub Pages | npm, Vite, GitHub Pages | `.github/workflows/deploy.yml` |

## Data flow

1. The Exo shell opens a matching file and mounts the declared frame editor.
2. The frame connects with `connectBrowserPlugin()`, reads the open document through the SDK,
   and parses it with the core model.
3. The editor holds the document in the shared frame-local `useDocumentHistory`, whose entries
   include the document and selection. It derives validation, effective definitions/surfaces,
   and library data from the document plus the read-only workspace.
4. When the shell requests Save, the frame returns only that document's serialized content.
   The shell performs the write and reports the result, including conflicts.
5. Scene/level editors publish serialized snapshots on `local/tenon.scene` and apply typed
   panel commands/intents through the same reducer and history as their own controls. The
   hierarchy panel also forwards focus/keyboard intents and a workspace-refresh intent. The
   editor remains the only writer; panels never save or mutate files.
6. Build and playtest run outside the plugin. The project editor reports readiness and the
   planned `tenon build` command but does not write artifacts.

## Other concerns

- **Per-document isolation.** Each open document has its own frame, buffer, selection,
  history, and validation. No mutable state is shared between frames. History entries capture
  the document and selection; shell undo/redo intents apply to the active writable frame,
  while the shell keeps no history or undo availability.
- **Panel consistency.** The Hierarchy & Assets, Inspector, and Inspection panels receive
  `activeEditor`/`editor/active`, request a fresh snapshot on mount and when the active editor
  changes, and tolerate at-most-once local events. A panel shows an empty state when no Tenon
  scene/level editor is active. The hierarchy panel is a primary companion; the primary
  sidebar shows one view at a time. (`../docs/technical-decisions.md` TD-31)
- **Validation scopes.** Format editors validate the open document; the project editor
  validates the whole project; the external build adds engine registration and artifact
  checks. (`../docs/technical-decisions.md` TD-16)
- **Capability degradation.** Missing optional shell capabilities produce an explicit
  fallback rather than an assumption: manual path entry, read-only browsing, or
  initial-theme-only. (`../docs/technical-decisions.md` TD-26)
- **Doc drift risk.** Core rules are repeated across `AGENTS.md`, `README.md`, and the design
  docs; changes must update every copy. No mismatches are known at baseline.
- **Browser support.** Tenon inherits the Exo shell's browser matrix; desktop Chromium is the
  supported plugin-host target, Firefox and Safari plugin-host support are unverified, and
  mobile is out of scope. The scene viewport adds a WebGL requirement. See
  [Tech stack](../tech-stack.md#browser-support).

## Decisions

| Decision | Why | Source |
|---|---|---|
| Authoring is engine-agnostic JSON; runtime is engine-specific and one-way | Keeps the editor generic and the engine contract explicit | TD-01, TD-02 |
| One Exo workspace is one Tenon project; `project.json` is the manifest | Matches the shell's workspace model and keeps schema locations portable | TD-03, TD-26 |
| Schema identity is `namespace@version`; imports pin exact versions | Stable references and reproducible resolution | TD-04, TD-25, TD-29 |
| Definitions are flat after composition; composition contributes only fields/defaults/events | Avoid runtime inheritance and engine-class leakage | TD-24 |
| Scenes are entity trees; scene instances are atomic and attach only through slots | Clear composition boundary and safe reuse | TD-07, TD-08, TD-10 |
| Every entity has a built-in transform outside `props` | Placement is not schema data; parent transforms compose | TD-20, TD-23 |
| The plugin is one Exo plugin with per-format frame editors | One consent and shared schema/validation/UI | TD-26, TD-27 |
| Scene Hierarchy & Assets/Inspector/Inspection are shell panels with a local snapshot/command bridge | Keeps panels shell-owned and the editor the only writer | TD-31 |
| Hierarchy & Assets is a primary scene panel; the project hub remains the only project-level primary panel | Gives the tree/library a shell-owned home without consuming viewport width; one primary view is visible at a time | TD-31 |
| Undo/redo is plugin-owned shared snapshot history; Exo sends id-less intents | Keeps history with the buffer and lets every format editor share one behavior | TD-32 |
| Validation is live; Save is never refused for validation errors | Prevents data loss during incomplete authoring | TD-16 |

## Module architecture

- [Core model](core-model.md) — schema, project, scene, workspace, validation, and history.
- [Plugin surfaces](plugin-surfaces.md) — controller, format frames, panels, and the editor
  bridge.

## Evidence

- `../AGENTS.md` — invariants and host boundary.
- `../docs/technical-decisions.md` — decision record.
- `../plugin/public/exo-manifest.json` — contributions and permissions.
- `../plugin/src/` — implementation.
- `../.github/workflows/deploy.yml` — delivery.

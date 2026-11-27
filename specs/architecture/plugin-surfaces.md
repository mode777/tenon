# Module: Plugin surfaces

Purpose: the Exo-facing registration, format frames, shell panels, and scene panel bridge.
| Code: `plugin/src/controller.ts`, `plugin/src/*/`, `plugin/public/exo-manifest.json`

## Responsibilities

- Register the manifest-declared file editors, panels, and commands with the Exo shell.
- Mount one frame per open document with format-specific UI, local state, and undo/redo.
- Read the open document through the SDK; report dirty; answer shell save requests; handle
  save conflicts, external changes, read-only workspaces, and theme changes.
- Host the project hub panel, which lists project documents and invokes the shell file
  creation dialog for New Schema and New Scene.
- Run the scene Inspector and Inspection panels as singleton view frames that follow the
  active scene/level editor and exchange snapshots/commands over `local/tenon.scene`.
- Degrade explicitly when an optional shell capability is absent.

## Interface

- **Manifest contributions:** `project.json`, `schemas/*.schema.json`,
  `scenes/*.scene.json`, and `levels/*.scene.json` file editors; `tenon.project` primary
  panel; `tenon.scene.inspector` secondary panel; `tenon.scene.inspection` bottom panel;
  `tenon.new-schema` and `tenon.new-scene` commands. (`plugin/public/exo-manifest.json`)
- **Controller:** `registration.register(...)`, `registerPanel(...)`, `registerCommand(...)`,
  then `complete()`. Scene panels register conditionally when the shell supports the bottom
  panel. (`plugin/src/controller.ts`)
- **Editor frame:** `connectBrowserPlugin()` in editor mode; `readFile`, `setDirty`,
  `onSaveRequest`, `onSaveResult`, `onFileChanged`, `onDispose`, `requestSave`,
  `followTheme`. (`plugin/src/*/main.tsx`, `plugin/src/*Editor.tsx`)
- **Panel frame:** `connectBrowserPlugin()` in view mode; `view.activeEditor`,
  `editor/active`, `subscribeLocal`/`publishLocal`, `readFile`/`listDirectory`,
  `requestPanel`. (`plugin/src/scene/panels/`)
- **Scene bridge:** `ScenePanelSnapshot` carries `revision`, `path`, `doc`, `selection`,
  `canWrite`, and `levelMode`. `SceneCommand` carries typed document edits. Messages are
  validated and targeted by editor instance ID. (`plugin/src/scene/scene-panel-protocol.ts`)

## Relevant details

- **Per-format frames.** The project, schema, and scene/level editors are separate HTML
  frames. The schema and project editors are DOM-only; the scene editor adds three.js. The
  generator editor is planned, not implemented. (`plugin/editors/`, `plugin/public/exo-manifest.json`)
- **Shell ownership.** The frame does not recreate tabs, breadcrumbs, Save, dirty indicators,
  consent, or theme. It owns only its document surface. (`../AGENTS.md`, TD-26)
- **Save path.** `onSaveRequest` returns the open document's serialized text; the shell
  writes it. A save result updates the saved baseline; a conflict leaves the buffer and tab
  dirty. The frame never receives a file handle. (`plugin/src/*Editor.tsx`, TD-26)
- **New files.** The project hub calls `requestNewFile` during a live command invocation,
  then `openFile`. The shell owns the dialog, path, and write. (`plugin/src/project/main.tsx`)
- **Panel lifecycle.** Scene panels are singleton view frames. The shell reveals them when
  the scene/level editor is active and hides them when another surface is active; the shell
  owns companion visibility. (`plugin/public/exo-manifest.json`, TD-31)
- **Panel bridge.** The editor publishes serialized snapshots and `editor-online`; panels
  request snapshots by editor instance ID and send commands with request IDs. The editor
  applies commands through the same reducer as its own controls, so undo, dirty state,
  conflict handling, and Save stay in the editor. (`plugin/src/scene/useScenePanelBridge.ts`,
  `plugin/src/scene/panels/useScenePanel.ts`)
- **At-most-once local events.** Panels request a fresh snapshot on mount and when the active
  editor changes; they never assume every intermediate snapshot arrived. A panel shows an
  empty state when no Tenon scene/level editor is active. (TD-31)
- **Capability degradation.** Missing directory listing means manual path entry or read-only
  browsing; missing file picker disables Open…; missing file creation disables New
  Schema/Scene; missing theme events leaves the initial theme applied. (`plugin/src/`,
  TD-26)
- **Project hub scope.** The hub is the only project-level shell panel. Scene panels are
  document-scoped and follow the active scene/level editor. (`../AGENTS.md`, TD-31)

## Dependencies

- **Uses:** Exo plugin SDK, browser DOM, React, three.js/R3F for the scene viewport, and the
  core model.
- **Used by:** the Exo shell; no other Tenon module.

## Decisions

| Decision | Why | Source |
|---|---|---|
| One plugin with per-format frame editors | One consent, shared schema/validation, format-specific UI | TD-26, TD-27 |
| Shell owns workspace, save, dirty, consent, and theme | Keeps the plugin untrusted and avoids duplicate chrome | TD-26 |
| Scene Inspector/Inspection are shell panels, not frame iframes | Frees viewport space and lets panels follow the active editor | TD-31 |
| Panel edits are commands to the editor | The editor remains the only writer and owns undo/conflict state | TD-31 |
| Primary panel for the project hub; secondary/bottom for scene panels | Matches project-level vs document-level scope and Exo panel locations | TD-26, TD-31 |

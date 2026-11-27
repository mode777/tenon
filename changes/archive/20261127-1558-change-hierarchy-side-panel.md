# Change: hierarchy-side-panel

Status: synced
Created: 2026-11-27

## 1. Proposal

Move the scene editor's left hierarchy/assets pane out of the scene frame and into a
dedicated Exo primary panel, `tenon.scene.hierarchy`, shown in the activity bar and
auto-revealed as a companion of the active scene/level editor. The panel contains both the
host hierarchy and the Entities/Scenes/Assets library. The scene frame keeps the viewport,
toolbar, and save/conflict notices.

This is the change discussed after the Exo API review: Exo 0.11.0+ supports one primary
companion per file editor, the shell auto-reveals it while the scene/level handler is active,
and the existing `local/tenon.scene` snapshot/command bridge already carries the document,
selection, `canWrite`, and level mode the panel needs. No new Exo permission, protocol, or
consent prompt is required.

The review findings are already fixed in `1d28a4e`: the docs and specs align on Exo
0.11.0+, and browser support is documented.

## 2. Goals & Non-Goals

- **Goals:**
  - Give the hierarchy/library a shell-owned left panel without duplicating shell chrome.
  - Keep the panel synchronized with the active scene/level editor and preserve the current
    click, placement, selection, and keyboard behavior.
  - Keep the scene editor as the only document writer and leave undo, dirty state, save, and
    conflict handling in the editor frame.
  - Reduce viewport crowding in the scene frame.
- **Non-goals:**
  - Per-document panel instances; the panel is a singleton that follows the active editor.
  - A second always-visible left column; the primary sidebar shows one view at a time.
  - Cross-frame drag/drop, cross-frame focus routing, or shell-native tree/badge/context-menu
    contributions.
  - Separate activity-bar panels for hierarchy and assets; they share one panel.
  - Remote schema/asset browser changes or build/bake work.

## 3. Added / Changed / Removed Requirements

### Added

- `SCENE-HIERARCHY-PANEL` — Hierarchy and library live in a shell panel.
  The scene/level workspace shall expose the host hierarchy and the entity/scene/asset library
  in the singleton `tenon.scene.hierarchy` primary shell panel, auto-revealed as a companion
  of the active scene/level editor and following the active editor instance.
  Acceptance: opening a scene/level reveals the panel; switching to a project/schema editor
  hides it; switching between scene tabs updates it; opening it with no scene shows an empty
  state.

- `SCENE-PANEL-COMMANDS` — Panel edits are editor commands.
  The hierarchy panel shall send typed commands for selection and for adding entities, scene
  instances, and assets to the active scene/level editor; the editor shall apply them through
  its existing reducer and history and remain the only writer.
  Acceptance: adding from the panel marks the document dirty, selects the new entity, and is
  undoable; a read-only workspace disables placement.

- `SCENE-PANEL-SHORTCUTS` — Keyboard behavior survives the move.
  While the hierarchy panel has focus, `Delete`/`Backspace`, `Ctrl/Cmd+D`, `Escape`,
  `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`/`Ctrl+Y`, `Ctrl/Cmd+S`, and `W`/`E`/`R` shall perform the
  same actions as when the scene frame has focus, except while a text input, select, or
  contenteditable element has focus.
  Acceptance: the panel-focused shortcuts edit/undo/save/switch mode through the active
  editor and do not fire while searching or typing.

- `SCENE-PANEL-REFRESH` — One refresh updates both views.
  When the user refreshes the hierarchy panel, the panel shall reload its workspace view and
  the active editor shall reload its schema/asset context so validation and placement use the
  same workspace state.
  Acceptance: adding a schema or asset outside the editor and refreshing updates the palette,
  asset list, and scene validation without reopening the document.

### Changed

- `HOST-PANELS` — Shell panels follow the active editor.
  New: The plugin shall contribute `tenon.project` as a primary panel,
  `tenon.scene.hierarchy` as a primary panel, `tenon.scene.inspector` as a secondary panel, and
  `tenon.scene.inspection` as a bottom panel; scene and level editors shall bind all three
  scene panels as companions.
  Previously: The plugin shall contribute `tenon.project` as a primary panel,
  `tenon.scene.inspector` as a secondary panel, and `tenon.scene.inspection` as a bottom
  panel; scene and level editors shall bind the scene panels as companions.

### Removed

- None.

## 4. Architecture Changes

- **Manifest and controller:** add `tenon.scene.hierarchy` (`location: "primary"`, title
  `Hierarchy & Assets`, icon `list-tree`, entry `views/hierarchy.html`); add it to the
  `companionPanels` of both scene and level file editors; register it in the controller.
- **New view frame:** add `views/hierarchy.html`, a panel boot, the hierarchy panel component,
  and panel CSS. The panel uses `ViewClient`, `useScenePanel`, and its own read-only
  `loadWorkspace(view)` for palette/asset/validation context.
- **Scene bridge:** extend `SceneCommand` with `add-entity`, `add-scene-instance`, and
  `add-asset`; add a typed panel-intent channel for `undo`, `redo`, `save`, `set-mode`, and
  `refresh-workspace` so keyboard actions and refresh can reach the editor without making the
  panel a writer. Reuse the existing `local/tenon.scene` topic and targeted command results.
- **Scene editor:** remove the in-frame left pane and its library-only state; keep the
  workspace/context needed for scene validation and commands; add a toolbar action to reveal
  the hierarchy panel; pass undo/redo/save/mode/refresh callbacks to the bridge.
- **Docs:** update TD-26's contribution table, TD-31's layout rule, `docs/scene-editor-ui.md`,
  the M2 roadmap wording, `AGENTS.md`'s "per-document tools stay in editor frames" invariant,
  and README status/layout. Baseline specs are updated by `nsx-sync`, not by this apply step.
- **Delivery:** bump the plugin version to `0.5.0`; keep Exo `>=0.11.0`; no permission or
  consent-fingerprint change.

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| The primary companion takes over the left sidebar when a scene becomes active, competing with Explorer or the project hub | Accept as shell behavior; document that only one primary view is visible; add a toolbar reveal action and an empty state |
| Moving the pane out of the editor frame regresses keyboard behavior | Implement the panel shortcut bridge in this change; test Delete/duplicate/escape/undo/redo/save/mode with the panel focused |
| Panel and editor workspace copies drift after an external schema/asset change | Add the refresh intent so one refresh reloads both; test with an externally added asset |
| The scene/level editors already bind two companions; a primary panel reaches the three-companion maximum | Keep hierarchy and library in one primary panel; do not add a fourth companion |
| Singleton panel state (search, expanded nodes) leaks across scene tabs | Key or reset panel-local state on active editor path changes; test switching scenes |
| Local events are at-most-once and the panel may mount before the editor bridge is ready | Reuse the existing snapshot-request, `editor-online`, and timeout behavior; test a panel-first mount |
| Cross-frame drag/drop or focus cannot be added | Explicitly out of scope; keep placement click-driven and document the limitation |

## 6. Acceptance Criteria & Validation

- [x] AC1 `HOST-PANELS`: The manifest declares `tenon.scene.hierarchy` as a primary panel and
  both scene/level entries bind it as a companion; the controller registers it. Validate:
  manifest/controller tests and opening a scene.
- [x] AC2 `SCENE-HIERARCHY-PANEL`: The panel shows the host hierarchy and
  Entities/Scenes/Assets library; scene-instance internals stay hidden; opening a project or
  schema editor hides it; no active scene shows an empty state. Validate: panel and scene
  tests plus the M2 demo.
- [x] AC3 `SCENE-PANEL-COMMANDS`: Selection, add entity, add scene instance, and add asset
  work from the panel; edits are dirty and undoable; read-only disables placement; the editor
  remains the only writer. Validate: command/reducer tests and interaction tests.
- [x] AC4 `SCENE-PANEL-SHORTCUTS`: With the panel focused, Delete/duplicate/escape/undo/redo/
  save/W/E/R behave as in the scene frame; search input suppresses them. Validate: keyboard
  interaction tests and manual check.
- [x] AC5 `SCENE-PANEL-REFRESH`: Refreshing after an external schema or asset change updates
  the panel and the editor validation context. Validate: refresh integration test and manual
  check.
- [x] AC6 Layout: The scene frame no longer renders the left pane; viewport, toolbar, and
  save/conflict notices remain; the toolbar reveal action opens the panel. Validate: scene
  editor tests and the M2 demo.
- [x] AC7 Docs: TD-26, TD-31, scene-editor-ui, roadmap, AGENTS, and README describe the new
  layout and the one-primary-view constraint. Baseline specs stay unchanged until
  `nsx-sync`. Validate: doc/link checks.
- [x] AC8 Quality gate: `npm test`, `npm run typecheck`, and `npm run build` pass; the GitHub
  Pages deploy succeeds. Validate: local commands and the CI run.

## 7. Questions & Decisions

- [x] Q1: Should this change provide full panel-focus shortcut parity or only
  Delete/Duplicate/Escape? → Full parity. Why: the current pane lives in the editor frame, so
  moving it out without forwarding shortcuts would regress keyboard behavior.
- [x] Q2: Is `tenon.scene.hierarchy` / **Hierarchy & Assets** / `list-tree` the right panel
  identity? → Yes. Why: one panel holds both the tree and the library because the primary
  sidebar shows one view at a time.
- [x] Q3: Should Refresh reload both the panel and the editor context? → Both. Why: validation
  and placement must not drift after an external schema/asset change.
- [x] Q4: Bump the plugin manifest/package version from `0.4.0` to `0.5.0`? → Yes. Why: this
  is a user-visible feature and does not change the consent fingerprint.

## 8. Implementation Plan

- [x] T1 Add `tenon.scene.hierarchy` to the manifest, scene/level companions, and controller;
  add the manifest test. Files: `plugin/public/exo-manifest.json`,
  `plugin/src/controller.ts`, `plugin/src/manifest.test.ts`. Verify: `npm test`.
- [x] T2 Add the hierarchy view page, boot, panel component, and Vite input. Files:
  `plugin/views/hierarchy.html`, `plugin/src/scene/panels/hierarchy-main.tsx`,
  `HierarchyPanel.tsx`, `panel-roots.tsx`, `vite.config.ts`, panel CSS. Verify: panel mounts.
- [x] T3 Extend the scene panel snapshot/command layer with add-entity, add-scene-instance,
  and add-asset; reuse the existing selection/command path. Files:
  `plugin/src/scene/scene-panel-protocol.ts`, `plugin/src/scene/scene-commands.ts`,
  `plugin/src/scene/useScenePanelBridge.ts`, tests. Verify: `npm test`.
- [x] T4 Add panel intents for undo, redo, save, set-mode, and refresh-workspace; wire
  editor callbacks in `SceneEditor` and `useScenePanelBridge`. Verify: bridge/editor tests.
- [x] T5 Build the hierarchy tree and library in the panel, using the snapshot plus
  read-only workspace context; add search, tabs, refresh, empty, and read-only states. Verify:
  panel tests.
- [x] T6 Add panel-focus keyboard handling and suppress shortcuts in text inputs; verify
  Delete/duplicate/escape/undo/redo/save/W/E/R. Verify: interaction tests.
- [x] T7 Remove the scene frame's left pane and library-only state; add the Hierarchy toolbar
  action; keep viewport/toolbar/save notices and the editor workspace context. Verify: scene
  editor tests and the M2 demo.
- [x] T8 Update TD-26, TD-31, scene-editor-ui, roadmap, AGENTS, and README; do not edit
  baseline specs during apply. Verify: doc diff, link checks, and `git diff --check`.
- [x] T9 Bump the plugin version to `0.5.0`; run `npm test`, `npm run typecheck`,
  `npm run build`; deploy and verify the M1/M2 demo workspaces. Files:
  `plugin/package.json`, `plugin/public/exo-manifest.json`. Verify: CI and deployed shell.

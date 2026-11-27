# Feature: Exo host integration

Tenon runs as one Exo plugin and leaves workspace, document lifecycle, consent, and theme to
the shell. The shell is the only writer; Tenon supplies format editors and validation.

## Requirements

- `HOST-SINGLE-PLUGIN` — One plugin identity.
  The Tenon editor shall ship as one Exo editor plugin with one manifest identity, one
  consent surface, and one shared implementation.
  Why: users approve one origin and permission set; all formats share schema resolution,
  validation, and UI code.
  Fit: one manifest `id`; the controller registers every format from one frame.
  Evidence: `plugin/public/exo-manifest.json`, `plugin/src/controller.ts`, TD-26.

- `HOST-FORMAT-EDITORS` — One frame editor per format.
  The plugin shall contribute a separate frame editor for `project.json`,
  `schemas/*.schema.json`, `scenes/*.scene.json`, and `levels/*.scene.json`; levels shall use
  the scene editor.
  Why: each format has a distinct authoring surface, while the format editor stays generic
  across definitions.
  Fit: opening a matching file mounts the declared frame and no per-definition editor.
  Evidence: `plugin/public/exo-manifest.json`.

- `HOST-PANELS` — Shell panels follow the active editor.
  The plugin shall contribute `tenon.project` as a primary panel, `tenon.scene.hierarchy` as
  a primary panel, `tenon.scene.inspector` as a secondary panel, and
  `tenon.scene.inspection` as a bottom panel; scene and level editors shall bind all three
  scene panels as companions.
  Why: the project hub is project-level; scene panels are document-scoped and should not
  consume viewport space.
  Fit: the hub and Hierarchy & Assets appear in the activity bar; the scene panels follow the
  active scene/level editor and show an empty state otherwise. The primary sidebar shows one
  view at a time.
  Evidence: `plugin/public/exo-manifest.json`, `plugin/src/controller.ts`,
  `plugin/src/manifest.test.ts`, TD-31.

- `HOST-SHELL-OWNERSHIP` — The shell owns the document lifecycle.
  The plugin shall leave workspace selection, tabs, dirty state, save execution, consent, and
  theme to the Exo shell.
  Why: the shell is the trusted boundary; the plugin runs in a sandboxed iframe.
  Fit: the frame renders only its document surface and reports dirty through the SDK.
  Evidence: `AGENTS.md`, TD-26.

- `HOST-RESERVED-FILES` — Shell files stay private.
  The plugin shall not read, write, or list `exo.json` or `.exo/**`.
  Why: these are shell-owned workspace metadata; reading them would violate the host
  boundary.
  Fit: workspace reads target authoring documents, schema packages, scenes, and assets only.
  Evidence: `AGENTS.md`, TD-03, TD-26.

- `HOST-OPEN-DOCUMENT-WRITE` — Only the open document is writable.
  When the shell requests a save, the editor shall return only the open document's serialized
  content through the SDK save handler and shall not write another workspace file.
  Why: prevents background rewrites and cross-file surprises.
  Fit: `onSaveRequest` returns the current buffer; no other file path is opened for writing.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/scene/SceneEditor.tsx`, TD-26.

- `HOST-PERMISSIONS` — Least permissions.
  The manifest shall request only `workspace:read`, `workspace:write`, `workspace:list`, and
  `events:subscribe`.
  Why: every permission is shown at consent and can prompt existing users when widened.
  Fit: the manifest contains exactly those permissions.
  Evidence: `plugin/public/exo-manifest.json`.

- `HOST-READONLY` — Read-only workspaces stay usable.
  When the workspace is read-only or lacks `workspace:write`, the editors shall open
  read-only and disable creation and save actions.
  Why: an approved reader should still inspect and validate the project.
  Fit: creation banners/buttons are disabled; editing controls are read-only.
  Evidence: `plugin/src/project/main.tsx`, `plugin/src/schema/SchemaEditor.tsx`,
  `plugin/src/scene/SceneEditor.tsx`, TD-26.

- `HOST-CONFLICT` — Never silently replace a dirty buffer.
  When an external change conflicts with a dirty buffer, the editor shall retain the buffer,
  show the conflict, and avoid silently replacing the content.
  Why: a save conflict must not lose unsaved authoring work.
  Fit: the frame shows a conflict notice and reload requires an explicit action.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`,
  `plugin/src/schema/SchemaEditor.tsx`, `plugin/src/scene/SceneEditor.tsx`, TD-26.

- `HOST-DEGRADE` — Missing capabilities degrade explicitly.
  If an optional shell capability is unavailable, the editor shall expose a documented
  fallback such as manual path entry, read-only browsing, or initial-theme-only, instead of
  assuming the capability exists.
  Why: the plugin must work across supported Exo shells without hidden failures.
  Fit: the project hub and editors disable or explain the unavailable action.
  Evidence: `plugin/src/project/main.tsx`, `plugin/src/core/workspace.ts`, TD-26.

- `HOST-THEME` — Follow the shell theme.
  The editor and panel frames shall follow the shell's dark, light, and high-contrast theme.
  Why: Tenon surfaces live inside the shell and must remain legible and consistent.
  Fit: frames import the SDK token sheet and call `followTheme`; controls use `--exo-*`
  tokens.
  Evidence: `plugin/src/*/main.tsx`, `sdk/src/theme.ts`, `sdk/src/theme.css`, TD-26.

- `HOST-INCOMPLETE-SAVE` — Validation never blocks Save.
  The shell save action shall remain available when the open document has validation errors.
  Why: incomplete authoring data must be saveable so work is not lost.
  Fit: Save succeeds while the validation drawer still reports errors; errors remain after
  reload.
  Evidence: `docs/technical-decisions.md` TD-16, `docs/schema-editor-ui.md`,
  `docs/scene-editor-ui.md`.

## Sources

- `plugin/public/exo-manifest.json`
- `plugin/src/controller.ts`
- `plugin/src/project/`, `plugin/src/project-editor/`, `plugin/src/schema/`,
  `plugin/src/scene/`, `plugin/src/scene/panels/`
- `AGENTS.md`
- `docs/technical-decisions.md` TD-03, TD-16, TD-26, TD-27, TD-31

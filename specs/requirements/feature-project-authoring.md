# Feature: Project authoring

The project hub and project editor make one workspace a Tenon project: `project.json` maps
schema namespaces to locations, and the editor resolves and validates the whole project.

## Requirements

- `PROJECT-MANIFEST` — `project.json` is the project manifest.
  The Tenon project shall use the workspace-root `project.json` as its manifest, mapping
  schema namespaces to builtin, project-relative, or HTTPS locations.
  Why: schema identity is separate from location, and the project needs one portable
  resolution map.
  Fit: changing an import location changes resolution without changing definition IDs.
  Evidence: `plugin/src/core/project.ts`, `docs/technical-decisions.md` TD-03, TD-25.

- `PROJECT-HUB` — The hub lists project documents.
  The Tenon project hub shall list schema bundles, scenes, and levels in the workspace and
  provide actions to open the project, open an existing document, and start a new schema or
  scene.
  Why: the hub is the project-level entry point inside the Exo activity bar.
  Fit: counts and rows reflect `/schemas`, `/scenes`, and `/levels`; actions open the
  corresponding shell documents.
  Evidence: `plugin/src/project/main.tsx`, `plugin/public/exo-manifest.json`.

- `PROJECT-NEW-FILES` — Creation uses the shell dialog.
  When the user invokes New Schema or New Scene, the project hub shall call the shell-owned
  `requestNewFile` dialog with a format template, then open the created document.
  Why: the plugin never writes new files directly; the shell owns path selection and write.
  Fit: the command and the hub button both create and open a document through the same path.
  Evidence: `plugin/src/project/main.tsx`, `plugin/src/controller.ts`, TD-26.

- `PROJECT-IMPORT-MAP` — The import map is editable.
  The project editor shall add, change, and remove namespace-to-location imports and map a
  discovered schema in one action.
  Why: schema locations are a project concern and must be editable without hand-editing JSON.
  Fit: edits update `project.json` and the resolved schema table immediately.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`.

- `PROJECT-RESOLUTION` — Resolved schemas are visible.
  The project editor shall show every resolved schema with its namespace, version, source
  (builtin/local/remote), content hash, and location, plus schemas found in the workspace but
  not mapped.
  Why: authors need to see which bundle and version the project actually uses.
  Fit: the table shows mapped and unmapped rows with status.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`, `plugin/src/core/project.ts`.

- `PROJECT-VALIDATE` — Validate the whole project.
  The project editor shall resolve each bundle's declared imports and validate every schema
  and scene in the project, reporting errors and warnings with source locations.
  Why: per-document validation cannot catch cross-file breakage.
  Fit: the readiness indicator and validation list reflect all schemas and scenes.
  Evidence: `plugin/src/core/project.ts` (`analyzeProject`), `plugin/src/project-editor/ProjectEditor.tsx`,
  `docs/technical-decisions.md` TD-16.

- `PROJECT-BUILD-READINESS` — Report readiness without building.
  The project editor shall report whether the project resolves and, when a level exists,
  the planned `tenon build <level>` command; it shall not write build output.
  Why: build and playtest run outside the plugin; the editor only communicates readiness.
  Fit: a ready/blocked indicator and command are shown; no artifact is written.
  Evidence: `plugin/src/core/project.ts` (`projectBuildCommand`),
  `plugin/src/project-editor/ProjectEditor.tsx`, TD-26.

- `PROJECT-NAVIGATE` — Jump to an issue's source.
  When the user selects a project validation issue, the editor shall open the source document
  for that issue.
  Why: cross-file errors must be actionable without searching the workspace.
  Fit: selecting an issue with a source path opens that document.
  Evidence: `plugin/src/project-editor/ProjectEditor.tsx`.

- `PROJECT-ROUNDTRIP` — Save and reload without drift.
  The project editor shall save `project.json` through the shell save handler and reload it
  without losing the import map; dirty, conflict, read-only, and theme behavior shall follow
  the shell contract.
  Why: `project.json` is source data and must round-trip predictably.
  Fit: save, close, reopen, and confirm the same imports and validation result.
  Evidence: `plugin/src/core/project.ts`, `plugin/src/project-editor/ProjectEditor.tsx`,
  `docs/scene-editor-ui.md`.

## Sources

- `plugin/src/project/main.tsx`
- `plugin/src/project-editor/ProjectEditor.tsx`
- `plugin/src/core/project.ts`
- `plugin/public/exo-manifest.json`
- `docs/technical-decisions.md` TD-03, TD-16, TD-25, TD-26
- `docs/scene-editor-ui.md`

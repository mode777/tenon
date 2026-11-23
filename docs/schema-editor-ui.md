# Schema Editor UI Concept

Status: design proposal for M1. No implementation yet.

The schema editor is Tenon's first editor surface. It is where the vocabulary is
authored; the scene editor consumes that vocabulary later. Usability is the
primary constraint: an author should be able to create, compose, and validate a
schema without hand-editing JSON or learning a second data model.

## Why the schema editor first

- It proves the schema contract before any 3D or scene work.
- It proves the Exo plugin boundary with the smallest useful surface.
- It delivers immediate value: definitions, fields, defaults, enums, events, and
  composition become editable data.
- The scene editor then starts from a real schema instead of a hard-coded demo.

The first milestone edits one schema bundle plus the builtin `basic3d` bundle.
Project import editing and remote bundle UI arrive with M2.

## Design principles

1. **One screen, no wizard.** The whole bundle is visible: definitions, the
   selected definition, and the selected field. Routine edits never leave the
   screen.
2. **Inline before modal.** Creating a definition, adding a field, changing a
   type, and setting a default happen inline. Modals are reserved for
   destructive or ambiguous actions.
3. **Show the effective result.** Composition is the hard part of Tenon. The
   editor always offers a flattened effective view with origin badges, not just
   the raw definition.
4. **Type-aware controls.** The default editor for a field follows its type.
   Only relevant controls appear.
5. **Errors are part of the editor.** Validation is live, visible, and
   navigable. Errors do not block Save, but they are never hidden.
6. **Keyboard-first.** Common actions have single-key shortcuts and full focus
   navigation. The mouse is never required.
7. **Definitions, not instances.** The schema editor edits definitions only.
   A palette preview shows what the definitions will become for placement.
8. **Exo owns the chrome.** Tabs, breadcrumbs, Save, dirty state, conflict
   notices, consent, and theme stay in the shell. The schema frame owns only the
   document surface.
9. **No per-definition UI code.** A new definition or field renders from the
   schema contract. Adding one never adds a page or a control.
10. **Never lose data.** Unknown or future JSON is preserved on save or surfaced
    as an explicit unsupported-field error; the editor never silently drops data.

## What we borrow from LDTK

[LDTK](https://ldtk.io/) is a useful reference for definition-heavy editing, not
for its data model.

| LDTK pattern | Tenon use |
|---|---|
| Definitions are edited separately from placed instances | The schema editor edits definitions; a palette preview shows the placement result |
| A dense main side panel lists definitions and enums | The left sidebar holds definitions, enums, search, and builtin bundles |
| Fields are typed data with type-specific editors | The field table uses type pills, type-aware defaults, and a contextual inspector |
| Enums are first-class project data | Enums are created and edited in the same sidebar as definitions |
| Fast keyboard flow and a shortcut cheat sheet | Single-key actions and a `?` overlay |
| Direct manipulation, few nested settings pages | Inline add/rename, chips for composition, no wizard |
| A clear separation between authoring and the game data | The effective view states exactly what the runtime will receive |

The goal is LDTK's density and speed, with Tenon's composition and schema rules.

## Shell integration

### Project hub panel

The plugin contributes one project-level panel, `tenon.project`, titled
**Tenon**. It is the project entry point and creation hub.

- Primary activity-bar panel.
- Lists schema bundles under `schemas/`.
- Hosts the **New Schema** action; disabled in a read-only workspace.
- Later milestones add scenes, levels, generators, and assets to the same hub.

The project hub is not document-scoped. Per-document hierarchy, inspector,
palette, and validation stay inside the editor frames.

### New Schema action

The plugin contributes a manifest new-file template, `tenon.schema`, labelled
**Schema**. Exo exposes it as **New Schema** in the command palette and under
**New File → Tenon → Schema**. The project hub also has a **New Schema** button.

There are two creation paths because Exo requires a visible, focused plugin frame
for `requestNewFile`:

1. **Shell template.** Choose **New Schema** from the command palette or
   **New File → Tenon → Schema**. The shell opens its Save As dialog and writes
   the template without a plugin frame. The new file is not auto-opened; open it
   from the explorer.
2. **Project hub.** Open the Tenon panel and press **New Schema**. The panel is
   focused, calls `requestNewFile`, then `openFile`; the schema editor opens.

Exo has no panel-target command that can create a file from the command palette:
the panel is revealed but does not own DOM focus, so `requestNewFile` is denied.
The manifest template is the shell-native creation path; the hub button is the
create-and-open path.

Both paths use the same minimal template:

```json
{
  "id": "com.example.game",
  "version": "1.0.0",
  "namespace": "game",
  "enums": {},
  "definitions": {}
}
```

The shell owns the name/location dialog and the write. The plugin never writes
the file itself and never edits `project.json`. M1 treats the schema bundle as
standalone; project import status and editing arrive with M2.

If the shell lacks `requestNewFile` or `openFile` support, the hub disables its
button and explains which shell capability is missing. The manifest template
appears only on shells that support new-file templates.

## Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ gameA@1.0.0    [Fields] [Events] [Effective]                     3 defs · 1⚠ │
├───────────────┬──────────────────────────────────────────┬───────────────────┤
│ Search…       │ gameA:button            [Concrete ▾]     │ Field: label      │
│ + Definition  │ Compose: renderable × damageable ×  [+]  │ Type   string     │
│               │                                          │ Default  "Press"  │
│ ABSTRACT (2)  │ Fields (5)                      + Field   │ Doc      …        │
│  renderable 2 │ label      string   "Press"      ⋮       │                   │
│  damageable 1 │ enabled    bool     true         ⋮       │                   │
│ CONCRETE (2)  │ style      enum     ButtonStyle  ⋮       │ Origin: own       │
│  button     5 │ ─ inherited ─────────────────────────    │                   │
│  elevator…  6 │ visible    bool     true   renderable   │                   │
│               │ castShadows bool    true   renderable   │                   │
│ Enums (1)     │                                          │                   │
│  ButtonStyle  │ Events (2)                      + Event   │                   │
│               │ pressed    —                             │                   │
│ Builtin       │ damaged    amount: float                 │                   │
│  basic3d   8  │                                          │                   │
├───────────────┴──────────────────────────────────────────┴───────────────────┤
│ 0 errors · 1 warning   Field "label" is also contributed by gameA:labelable  │
└──────────────────────────────────────────────────────────────────────────────┘
```

The layout is three panes plus a validation status bar:

- **Left sidebar** — search, definitions, enums, builtin.
- **Center** — the selected definition, its fields and events, and the
  effective view.
- **Right inspector** — the selected field, event, enum, or definition details.
- **Bottom status bar** — validation counts; opens the validation drawer.

On narrow frames the right inspector collapses into an inline detail row. On
very narrow frames the sidebar collapses to icons. The center pane never
scrolls horizontally for the common case.

## Left sidebar

### Search

- One search field filters definitions and fields.
- Matching a field name shows its containing definition.
- Results are grouped; arrow keys move through results; Enter opens.
- Empty search restores the grouped tree.

### Definitions

- Groups: **Abstract** and **Concrete**, with counts.
- A definition row shows its local ID, field/event counts, and a validation dot.
- Abstract rows show an `abstract` badge.
- The selected row is highlighted; the detail pane follows selection.
- `+ Definition` adds a row at the top of the current group with an inline name
  input. Enter creates; Esc cancels.
- F2 or double-click renames. Renaming a definition ID updates composition
  references in the current bundle; references in other files are not rewritten
  and appear as validation errors there.
- Delete uses a small confirmation popover, with a usage count from the current
  bundle.

### Enums

- A flat list below definitions.
- `+ Enum` adds an inline name.
- Selecting an enum opens its value table in the center pane.
- Renaming an enum updates field references in the current bundle; references in
  other files are validation errors, not silent rewrites.

### Builtin

- `basic3d` appears as a pinned, read-only bundle at the bottom of the sidebar.
- Expanding it shows its definitions and fields.
- Its definitions are available to the composition picker but cannot be edited,
  renamed, or deleted.
- A "Compose from builtin" action on a definition opens the picker filtered to
  `basic3d`.

## Definition detail

The center pane is the definition workspace.

### Header

- Local ID input with the qualified ID shown as a badge (`gameA:button`).
- **Concrete / Abstract** segmented control. Switching to abstract explains:
  "Abstract definitions are hidden from the palette, cannot be scene roots, and
  have no engine class." Switching to concrete restores instantiability.
- Documentation field (collapsed by default).
- Delete in an overflow menu.

### Composition chips

- One chip per composed definition, with its qualified ID and a remove control.
- `+` opens the composition picker:
  - searchable;
  - grouped abstract/concrete and builtin/project;
  - already-composed rows disabled;
  - rows that would create a cycle disabled with a reason;
  - hovering a row previews contributed fields and events;
  - selecting adds the chip and updates the effective view immediately.
- Removing a chip is immediate; the effective view and validation update.
- Composition is data-only; the UI never implies behavior or engine-class
  inheritance.

### Tabs

- **Fields** — own and inherited fields.
- **Events** — own and inherited events.
- **Effective** — flattened fields and events with origin badges.

The tab choice is per document, not per definition, so switching definitions
keeps the author's view mode.

### Palette preview

A compact card shows the qualified ID, concrete/abstract badge, and effective
field count. It is a preview only; placement belongs to the scene editor.

## Field table

Columns: name, type, default, origin, actions. Required state is shown by the
absence of a default.

### Own fields

- Editable inline.
- Click a cell to edit; Enter commits; Esc cancels.
- Name is a local key. Duplicate names are blocked with an inline error.
- Type is a pill with an icon and text. Clicking opens the type picker.
- Default is a type-aware editor (see below).
- Required is implicit: a field without a default is required. The UI shows a
  `required` badge and offers "Add default" instead of a separate required
  checkbox.
- Delete is a row action with undo.
- Move up/down is available from the row menu. Field order is the JSON object
  order and is preserved in the inspector.

### Inherited fields

- Shown below own fields under an `inherited` divider, grouped by origin.
- Name and type are locked.
- The default is editable only when the override is legal (same type). The row
  shows an `override` badge when the composed default is replaced.
- A click selects the field and shows its origin and composition path in the
  inspector.
- A collision between two origins with the same field name is an inline error on
  both rows.

### Add field

- `+ Field` appends an inline row at the bottom.
- Name is focused. Type defaults to `string`.
- Enter adds the field and keeps the row open for the next field; Esc exits.
- A field can be added with a type and default in one flow; no modal.

### Type picker

M1 types:

- scalars: `string`, `int`, `float`, `bool`;
- value types: `enum`, `color`, `vec2`, `vec3`;
- references: `entityRef`, `assetRef`.

Later types:

- `array<T>`, `flags`, `nullable` are preserved but not selectable in M1. If an
  opened schema uses one, the editor shows a read-only type pill and a raw JSON
  default editor; it never drops the field.

The picker shows the type name, a one-line description, and a short example.
Selecting a type replaces the default editor and preserves a compatible default
when possible. Selecting an enum prompts for one of the bundle's enums; if none
exist, the picker offers a **New enum** inline action.

## Field inspector

The right inspector edits the selected field in full. The inline table is for
speed; the inspector is for completeness.

- Name, type, and origin.
- Default editor with type-specific controls:
  - `bool`: switch;
  - `int`/`float`: number input with validation;
  - `string`: text input;
  - `enum`: select from the bundle's enums;
  - `color`: swatch plus hex/rgba input;
  - `vec2`/`vec3`: compact numeric inputs;
  - `entityRef`: no default; entity pickers arrive with the scene editor;
  - `assetRef`: no default or a workspace path; the asset picker arrives with M2.
- Later types (`array<T>`, `flags`, `nullable`) show a read-only type pill and a raw
  JSON default editor in M1.
- Documentation.
- Delete field.
- "Referenced by" within the current bundle, when cheap to compute.
- No editor-hint controls in the MVP; they are a later schema feature.

When nothing is selected, the inspector shows a short keyboard cheat sheet and
the selected definition's documentation summary.

## Effective view

The effective view is the teaching surface for composition.

- Flattened field list with:
  - field name and type;
  - effective default;
  - origin badge (own or composed definition);
  - override marker when a default is replaced;
  - collision/error state.
- Flattened event list with origin badges and payload signatures.
- A one-line reminder: "This is the flat definition the runtime and inspector
  will see."
- Clicking a row selects the owning definition/field.
- The view updates live while composition chips change.

The effective view is read-only. Edits happen in the owning definition.

## Enums

Selecting an enum opens an enum detail in the center pane:

- Name.
- Ordered value table: value name, remove, move up/down.
- `+ Value` adds inline.
- Renaming a value updates defaults and field references in the current bundle.
- Deleting a value used as a default produces a validation error rather than a
  silent fallback.
- Enum values are strings; no colors or engine values in the MVP.

## Events

The Events tab uses the same table mechanics as fields:

- Event name, payload summary, origin, actions.
- `+ Event` adds an inline row.
- Payload fields reuse the field table and inspector.
- Payload fields are values only; the UI blocks `entityRef` payload fields
  without a host-scoped marker.
- Inherited events are read-only; duplicate names are inline errors.
- Event declarations are authoring data; no runtime binding controls in M1.

## Validation

Validation is live, not a separate "validate" step.

- Error dots appear on the definition, field, event, or enum row.
- The bottom bar shows error/warning counts and the first message.
- Clicking the bar opens a validation drawer above the status bar.
- Each issue has a severity, a plain-language message, and a jump action.
- The editor focuses the offending control, not just the pane.
- Errors do not block Save. The shell save path is never refused because the
  document is incomplete.
- Warnings are non-blocking: unused definition, empty definition, abstract with
  no fields, enum value unused, event with no payload.

Initial rules:

- schema `id`, `namespace`, and `version` shape;
- definition IDs qualified and unique;
- composition targets exist, are acyclic, and are flattened once;
- duplicate field/event names across origins;
- default type compatibility and override rules;
- enum references and value defaults;
- event payload field rules;
- duplicate event names;
- abstract definitions remain non-instantiable; composition never contributes
  engine classes or instantiability.

## Keyboard and accessibility

| Key | Action |
|---|---|
| `/` | Focus search |
| `N` | New definition |
| `F` | Add field |
| `E` | Add event |
| `Shift+E` | Add enum |
| `Enter` | Edit selected cell / confirm |
| `Esc` | Cancel inline edit / clear search |
| `↑` / `↓` | Move selection in the sidebar or table |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `?` | Shortcut cheat sheet |
| `Ctrl/Cmd+Shift+P` | Exo command palette (shell) |

- Do not bind browser-reserved shortcuts or shell shortcuts.
- Single-key shortcuts are suppressed while a text input, select, or contenteditable
  has focus.
- Every action is reachable by keyboard; focus rings are never removed.
- Type is conveyed by icon and text, not color alone.
- Text contrast meets 4.5:1; the surface works at 200% zoom.
- Reduced motion is respected; no layout animation is required to understand a
  change.
- The cheat sheet is reachable from the `?` button and the empty inspector.

## MVP scope

Included:

- Exo plugin scaffold, project hub panel, and the `tenon.schema` new-file template.
- Open, edit, save, reload, and validate a schema bundle.
- Bundle header: `id`, `namespace`, `version`.
- Definitions: create, rename, delete, abstract/concrete, documentation.
- Composition: add/remove chips, cycle blocking, effective view.
- Fields: add, rename, delete, type, default, required state, move up/down.
- Field types: `string`, `int`, `float`, `bool`, `enum`, `color`, `vec2`,
  `vec3`, `assetRef`, `entityRef`; `array<T>`, `flags`, and `nullable` are
  preserved but deferred.
- Enums: create, rename, delete, values, order.
- Events: create, rename, delete, typed payload fields.
- Builtin `basic3d` read-only.
- Validation with jump-to-issue.
- Undo/redo, dirty, conflict, read-only workspace, theme.
- Keyboard flow, search, cheat sheet.
- Unknown JSON is preserved on save or reported as an explicit unsupported-field error.

Not in M1:

- Scene/level editing, 3D viewport, entity placement.
- Project import map, remote schemas, cross-bundle composition.
- Generator editor.
- Runtime events or bindings.
- Build/bake/playtest.
- Cross-file refactors or rename propagation.
- Per-definition custom UI.
- Field constraints and editor hints beyond defaults and documentation.

## Proposed decisions

These are the choices to confirm before implementation:

1. **Project hub placement.** A primary activity-bar panel titled **Tenon**,
   with the New Schema action as its first action. Recommended over a secondary
   panel or a file-only command.
2. **Creation behavior.** New Schema uses the minimal template with default
   namespace and version. The hub path opens the bundle; the shell template path
   leaves it in the explorer to open. The header is the first edit after opening.
   Recommended for speed and for respecting Exo's focused-frame creation rule.
3. **Layout.** Three panes (sidebar, definition, inspector) with the inspector
   collapsing on narrow frames. Recommended over a two-pane table-only layout
   because field metadata is too rich for inline-only editing.
4. **Field order.** Preserve JSON object order and offer move up/down; defer
   drag-and-drop. Recommended for MVP.
5. **Effective view.** A third tab beside Fields and Events, plus origin badges
   in the normal tables. Recommended because composition is the concept that
   needs teaching.
6. **Project scope.** M1 lists schemas in the project hub but does not edit
   `project.json` imports; import status arrives with M2. Recommended to keep the
   first MVP focused.

## MVP acceptance walkthrough

The UI concept is settled when this walkthrough needs no hand-edited JSON:

1. Create a schema with **New Schema** from the command palette, then open it
   from the explorer.
2. Set the bundle identity.
3. Create an abstract definition and two fields.
4. Create an enum with two values.
5. Create a concrete definition, compose the abstract one, and add an enum
   field.
6. Inspect the effective view and confirm origin badges.
7. Create a cycle, see the exact error, and remove the composition.
8. Declare an event with a typed payload.
9. Save, close, reopen, and confirm the same definitions and validation.

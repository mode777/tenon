# Technical choices

## Stack

- **Language/runtime:** TypeScript 5.9, browser ES modules, Node.js 22 in CI.
- **UI:** React 19 with `react-dom`, Vite 8, Vitest 5, jsdom, and Testing Library.
- **3D:** three.js 0.187 with `@react-three/fiber` 9 and `@react-three/drei` 10.
- **Plugin SDK:** vendored `@exo/plugin-sdk` 1.10.0 in `../sdk/`; the plugin depends on the
  exact same version. The SDK is copied from upstream and must stay unmodified.
- **Host:** Exo editor shell. The plugin manifest declares `engines.exo: ">=0.11.0"`.
- **Data:** JSON authoring documents; no database. Workspace reads, listings, file creation,
  and saves go through the Exo SDK and shell.
- **Hosting:** static GitHub Pages from `../plugin/dist`, deployed by
  `../.github/workflows/deploy.yml` on every push to `main`.
- **Package manager:** npm workspaces for `sdk` and `plugin`.

## Commands

- **Install:** `npm install`
- **Dev server:** `npm run dev` — Vite on `http://localhost:5175`
- **Test all:** `npm test` — runs the plugin Vitest suite (16 files, 117 tests at the time
  of this baseline)
- **Test one:** from `plugin/`, `npx vitest run <test-file>`
- **Typecheck:** `npm run typecheck` — `tsc --noEmit`
- **Build:** `npm run build` — typecheck then Vite production build in `plugin/dist`
- **Lint:** no lint or formatter script. The static gate is `npm run typecheck`; tests and
  build complete the ship gate.
- **Deploy:** push to `main`; CI runs tests and build, then deploys Pages.

## Browser support

Tenon is a plugin inside Exo and inherits the Exo shell's browser matrix; it has no separate
browser-verification matrix. As of the Exo v1 matrix, desktop Chromium (Chrome/Edge) is the
supported plugin-host target, Firefox plugin-host support is unverified, Safari is unverified,
and mobile is out of scope. The scene editor additionally requires WebGL for three.js. Do not
claim a browser combination that the Exo host does not support.

Evidence: Exo shell `docs/browser-support.md`
(<https://github.com/mode777/exo-editor/blob/main/docs/browser-support.md>).

## Conventions

- **One plugin identity.** All formats share one manifest, consent surface, schema
  resolution, validation, and UI code. (`../AGENTS.md`, TD-26)
- **One format editor per format.** Adding a definition changes schema data only and adds no
  page, glob, or editor code. (`../AGENTS.md`)
- **Shell ownership.** Exo owns the workspace, tabs, dirty state, saves, consent, and theme.
  The plugin owns its document surfaces and reports dirty honestly. (`../AGENTS.md`)
- **Open-document writes only.** The editor answers `onSaveRequest` with its open document.
  New files come from shell-owned dialogs. No background writes or cross-file refactors.
- **Reserved shell files.** Never read, write, or list `exo.json` or `.exo/**`.
- **Vendored SDK.** Keep `sdk/` byte-compatible with upstream so it can be diffed and
  updated. `plugin/dist/` and `node_modules/` are generated and not committed.
- **Docs are design authority.** `docs/technical-decisions.md` (`TD-NN`), `docs/roadmap.md`
  (`M#`), and the UI concepts define intended behavior. Keep repeated rules in sync across
  those files and `README.md`.
- **Per-document state.** Each open document is its own frame with its own buffer,
  selection, undo/redo, and validation. Frames do not share mutable state.
- **Validation is live.** Errors are visible but never block Save; incomplete authoring data
  can be saved. (`../docs/technical-decisions.md` TD-16)
- **Ship gate.** Run `npm test`, `npm run typecheck`, and `npm run build` before shipping.
  (`../AGENTS.md`)

## Boundaries

- **Always:** use the Exo plugin SDK for handshakes, envelopes, reads, saves, commands, and
  theme changes; keep authoring data engine-agnostic; update docs when behavior changes.
- **Ask first:** add a milestone feature, change the data model or format, add a permission
  or editor glob, perform a cross-file refactor, or take a destructive action.
- **Never:** hand-write `postMessage` frames; write `exo.json` or `.exo/**`; write a workspace
  file other than the open document through the shell save handler; commit secrets,
  `node_modules/`, or generated build output.

## Evidence

- `../package.json` and `../plugin/package.json` — scripts and dependency versions.
- `../plugin/public/exo-manifest.json` — host range, permissions, and contributions.
- `../.github/workflows/deploy.yml` — CI and Pages deployment.
- `../AGENTS.md` — conventions and ship gate.

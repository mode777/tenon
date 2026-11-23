---
name: Create Exo Plugin
description: Scaffold, build, test and deploy an Exo editor plugin as a static site on GitHub Pages, using the vendored Exo plugin SDK, exo-manifest.json and the sandboxed iframe protocol. Use when the user wants to create, customize, host or troubleshoot their own plugin for the Exo editor shell.
---

# Create an Exo editor plugin and host it on GitHub Pages

## Install (for humans)

This is a single-file skill. Install it by copying the file from
<https://github.com/mode777/exo-editor/blob/main/.agents/skills/create-exo-plugin/SKILL.md>
into a skills directory:

```bash
RAW=https://raw.githubusercontent.com/mode777/exo-editor/main/.agents/skills/create-exo-plugin/SKILL.md

# OpenCode (global)
mkdir -p ~/.config/opencode/skills/create-exo-plugin && curl -fsSL "$RAW" -o ~/.config/opencode/skills/create-exo-plugin/SKILL.md

# Claude Code and other .agents-compatible assistants (global)
mkdir -p ~/.claude/skills/create-exo-plugin && curl -fsSL "$RAW" -o ~/.claude/skills/create-exo-plugin/SKILL.md
```

Inside the `exo-editor` repository itself this skill is already discoverable.

## What you are building

The Exo editor is a serverless, static-hosted shell at
<https://mode777.github.io/exo-editor/>. A plugin is an **untrusted static site**
that the shell loads in a sandboxed iframe and talks to over a versioned
`postMessage` protocol. The shell owns the workbench, the workspace, consent and
the write path; the plugin owns its editor surface and reports dirty state.

A plugin repo produces four things:

- `plugin.html` - the controller page. Registers file editors, then the shell
  removes it.
- `editor.html` - the handler page mounted per matching open file. Reads bytes on
  request, reports dirty, answers save requests.
- `exo-manifest.json` - identity, permissions and editor globs; what the user
  consents to.
- `src/*.ts` - editor code built on `@exo/plugin-sdk`, which owns every
  envelope, handshake and origin check.

Hosting on GitHub Pages makes the plugin **cross-origin** to the shell
(`mode777.github.io` vs `<owner>.github.io`), which is the easy mode: the frame
gets `sandbox="allow-scripts allow-same-origin"` and may use its own storage.
(Only plugins served from the shell's own origin run opaque with no storage;
that cannot happen on a third-party Pages site.)

## Non-negotiable rules

1. **No `postMessage` outside the SDK.** Never hand-write an envelope, a
   handshake, or a reply. Use `connectBrowserPlugin()` for both pages.
2. **Never touch `exo.json` or `/.exo/**`.** They are shell-only; the session
   denies such reads.
3. **Never touch the parent DOM** and never expect a `FileSystemHandle`,
   `File` or `Blob` from the shell. Bytes arrive only through
   `editor.readFile()`.
4. **Keep every page inside the plugin root** (the directory of
   `runtime.entry`). Parent traversal is rejected after normalization.
5. **Report dirty honestly** via `editor.setDirty()`. The shell never infers it.
6. **Content leaves the editor only through the save handler** returned from
   `editor.onSaveRequest()`. A plugin never authors the write itself.
7. **Manifest fields are exactly the documented set.** One unknown field
   rejects the whole manifest and no code loads.
8. **Keep the vendored SDK directory unmodified** so it can be diffed and
   updated against upstream.
9. **Follow the shell theme.** Import `@exo/plugin-sdk/theme.css`, call
   `followTheme()` from `@exo/plugin-sdk/theme`, and use `--exo-*` tokens.
   Support `dark` and `light`; map `high-contrast` for your editor library.

If this skill and the upstream contracts disagree, the contracts win:
<https://github.com/mode777/exo-editor/tree/main/docs/contracts>.

## Step 1 - Collect decisions from the user

Ask before scaffolding:

- Plugin `id` (reverse-domain, e.g. `com.youname.markdown`), display name and
  description.
- Which files it edits: the glob (e.g. `**/*.md`). Glob syntax is `*` within a
  segment and `**` across segments; no braces, no negation.
- Read-only or read-write (`workspace:write` implies read; ask only for what is
  used - extra permissions re-prompt every user's consent).
- Hidden handler (default, headless transform) or a visible editor surface
  (`rendering: "frame"` - the iframe is displayed in the document area, while
  tabs, breadcrumbs, Save and notices stay shell-owned).
- GitHub repository name (it becomes the Pages child path) and whether the site
  is a project page (`https://<owner>.github.io/<repo>/`) or a user-site root
  (`https://<owner>.github.io/`).

## Step 2 - Scaffold the repo from the upstream template

The SDK is not on npm in v1; it is vendored as TypeScript source. Clone upstream
once and copy two packages into a standalone npm-workspaces repo:

```bash
git clone --depth 1 https://github.com/mode777/exo-editor /tmp/exo-editor
# (no git? curl -L https://github.com/mode777/exo-editor/archive/refs/heads/main.tar.gz | tar xz -C /tmp)

mkdir my-exo-plugin && cd my-exo-plugin && git init
cp -r /tmp/exo-editor/packages/plugin-sdk sdk
cp -r /tmp/exo-editor/packages/plugin-template plugin
```

Resulting layout:

```text
my-exo-plugin/
├── .github/workflows/deploy.yml   # added in step 7
├── .gitignore                     # node_modules/ and plugin/dist/
├── package.json                   # workspaces wiring
├── sdk/                           # vendored @exo/plugin-sdk - keep unmodified
│   ├── package.json
│   └── src/                       # includes theme.ts and theme.css
└── plugin/                        # your plugin (from @exo/plugin-template)
    ├── package.json
    ├── vite.config.ts
    ├── plugin.html                # controller page
    ├── editor.html                # editor page
    ├── public/exo-manifest.json
    └── src/{controller,editor}.ts
```

Root `package.json`:

```json
{
  "name": "my-exo-plugin",
  "private": true,
  "workspaces": ["sdk", "plugin"]
}
```

In `plugin/`:

- Remove the diagnostic fixture unless you want to keep the mismatch page:
  `negative/protocol-mismatch.html`, `public/exo-manifest-mismatch.json`,
  `src/mismatch.ts`, their entries in `vite.config.ts`
  `build.rollupOptions.input`, and their references in
  `src/template.test.ts` (the `sources` list and the two mismatch tests).
- Set the Vite build `base` to the Pages path: `'/<repo>/'` for a project page,
  `'/'` for a user-site root. Development keeps `'/'`.
- Optionally rename `plugin/package.json` `name` to your plugin; keep the
  `"@exo/plugin-sdk"` dependency exactly as upstream ships it (it must match
  `sdk/package.json` version for workspace resolution).

`npm install` once, and commit the generated root `package-lock.json`.

## Step 3 - Author the manifest

Edit `plugin/public/exo-manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "com.youname.markdown",
  "name": "My Markdown Editor",
  "version": "0.1.0",
  "description": "Edits Markdown files in the Exo shell.",
  "publisher": { "name": "You" },
  "engines": { "exo": ">=0.1.0" },
  "runtime": { "entry": "plugin.html" },
  "permissions": ["workspace:read", "workspace:write"],
  "contributes": {
    "fileEditors": [
      {
        "glob": "**/*.md",
        "entry": "editor.html",
        "label": "Markdown",
        "priority": 10,
        "rendering": "frame"
      }
    ]
  }
}
```

Notes:

- `engines.exo` is the shell range; use `>=0.1.0` unless told otherwise. A range
  that excludes the shell version fails as `incompatible-engine`.
- `permissions`: `workspace:read` unless the editor saves; `workspace:write`
  implies read; add `events:subscribe` only if you consume events. A file editor
  requires at least `workspace:read`.
- `priority`: higher wins when several plugins match the same file; declaration
  order breaks ties.
- `rendering`: omit for the default `"hidden"`; `"frame"` displays the sandboxed
  handler in the document area. Switching to `"frame"` later widens consent and
  re-prompts every user.
- Validate against <https://github.com/mode777/exo-editor/blob/main/schema/exo.schema.json>.

## Step 4 - Write the controller

`plugin/src/controller.ts` connects in register mode, registers only globs the
manifest declares, and completes:

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'register') throw new Error('Expected register mode')

connection.registration.register({
  glob: '**/*.md',
  entry: 'editor.html',
  label: 'Markdown',
})
const ack = await connection.registration.complete()
console.log('registered', ack.accepted, ack.rejected)
```

The shell removes the controller frame after the acknowledgement. Registration
rejects globs the manifest does not declare.

## Step 5 - Write the editor

`plugin/src/editor.ts` skeleton with every handler wired:

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

async function main() {
  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') throw new Error('Expected editor mode')
  const editor = connection.editor

  let buffer = ''
  let dirty = false

  const setDirty = (value: boolean) => {
    dirty = value
    editor.setDirty(value)
  }

  async function load() {
    const content = await editor.readFile(editor.file.path, 'utf8')
    buffer = content.text
    setDirty(false)
  }

  // Content leaves the editor only through this handler.
  editor.onSaveRequest(() => ({ text: buffer }))

  editor.onSaveResult((result) => {
    if (result.ok) setDirty(false) // a conflict keeps the tab dirty
  })

  // Never silently replace a dirty buffer; the shell owns its own notice.
  editor.onFileChanged((change) => {
    if (change.kind !== 'deleted' && !dirty) void load()
  })

  editor.onDispose(() => {
    // Cancel timers, workers and fetches. The SDK sends dispose-ack itself.
  })

  editor.onError((error) => {
    // shell/error without replyTo: surface it, do not close the editor.
  })

  await load()
}

main().catch((error) => {
  // Show an actionable boot error. ExoProtocolError carries a stable code;
  // never retry with a different protocol version.
  document.body.textContent = String(error)
})
```

Building a real UI:

- With `rendering: "frame"`, put your editor UI (textarea, CodeMirror, Monaco,
  ...) in `editor.html`'s body. The shell shows the iframe in the document area;
  a tab switch hides it without disposal. Do not expect a shell DOM node.
- A visible-frame editor may call `editor.requestSave()` (SDK 1.1.0+) for its
  own Ctrl/Cmd+S; it is an id-less intent and the shell Save action remains the
  fallback on shells that ignore it.
- With the default hidden rendering, mirror state into `document.title` and a
  `<pre>` for debugging (the template's `#observation` pattern), and inspect the
  frame's console in DevTools.
- Save payloads are `{ text }` or `{ bytes: Uint8Array }`. Size and request
  caps arrive in `shell/init` (`editor.limits`); never hard-code them.
- Events (optional, needs `events:subscribe`): `await editor.subscribe('theme/changed')`
  then `editor.onEvent('theme/changed', cb)`. Initial state is already in
  `shell/init`; events carry changes.

### Style the visible surface

A visible frame does not inherit the shell CSS. Import the SDK token sheet, apply
the shell theme once, and let it follow changes:

```ts
import '@exo/plugin-sdk/theme.css'
import { followTheme } from '@exo/plugin-sdk/theme'

const stopTheme = await followTheme(editor, {
  onTheme: (theme) => {
    // Only when your editor library has its own theme model:
    // Monaco: dark -> vs-dark, light -> vs, high-contrast -> hc-black.
  },
})

editor.onDispose(() => {
  stopTheme()
})
```

- `followTheme` applies `shell/init.theme` immediately, calls `onTheme` for it,
  and with `events:subscribe` keeps applying later `theme/changed` values. Without
  the permission it still applies the initial theme and returns a no-op cleanup.
- `applyTheme(theme)` is the lower-level helper if you already subscribe.
- Style with the semantic tokens instead of fixed colors:

```css
html,
body {
  height: 100%;
  margin: 0;
  background: var(--exo-bg);
  color: var(--exo-fg);
  font-family: var(--exo-font-ui);
  font-size: var(--exo-font-size);
}

textarea,
input {
  border: 1px solid var(--exo-input-border);
  border-radius: var(--exo-radius);
  background: var(--exo-input-bg);
  color: var(--exo-input-fg);
}

:focus-visible {
  outline: 2px solid var(--exo-focus);
  outline-offset: 2px;
}

::selection {
  background: var(--exo-selection-bg);
  color: var(--exo-selection-fg);
}
```

- Use `--exo-surface`, `--exo-border`, `--exo-muted-fg`, `--exo-link`,
  `--exo-danger`, `--exo-warning` and `--exo-success` for the surrounding page.
  The full token contract is
  <https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-styling.md>.
- Keep `color-scheme` from the sheet so native controls and scrollbars match.
  Add `accent-color: var(--exo-accent)` and
  `scrollbar-color: var(--exo-border) var(--exo-bg)`.
- Do not recreate shell chrome inside the frame, and do not remove focus rings.
  Check 4.5:1 text contrast, reduced motion and 200% zoom.
- A plugin that already renders `vscode-workbench` components may import its
  public `vscode-workbench/styles/tokens.css`; the helper sets the same
  `data-theme` attribute. For a standalone plugin, the SDK sheet is smaller and
  covers high contrast.

## Step 6 - Local test against the deployed shell

Do not clone or run the shell; the deployed shell is the test surface.

```bash
npm run dev --workspace plugin   # serves http://localhost:5175/ with CORS
```

1. Open <https://mode777.github.io/exo-editor/> in Chrome or Edge and open a
   local folder as the workspace.
2. Add the plugin through the shell's Plugins settings surface (or put this in
   the workspace root `exo.json`):
   `"manifest": "http://localhost:5175/exo-manifest.json"`. The deployed
   shell's CSP permits `http://localhost:*` frames for exactly this.
3. Approve consent; the dialog shows the exact origin, permissions and globs.
4. Create a matching file and open it: the editor reads on request, reports
   dirty, saves, reacts to an external change, and disposes when the tab closes.

## Step 7 - Ship to GitHub Pages

`.github/workflows/deploy.yml`:

```yaml
name: Deploy plugin to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build --workspace plugin
      - uses: actions/upload-pages-artifact@v3
        with:
          path: plugin/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then:

1. Push to `main`, and set the repo's **Settings → Pages → Source: GitHub
   Actions** (the artifact deployment skips Jekyll processing entirely).
2. The manifest URL is `https://<owner>.github.io/<repo>/exo-manifest.json`
   (user-site root: `https://<owner>.github.io/exo-manifest.json`). Verify the
   Vite `base` from step 2 matches, or assets 404.
3. GitHub Pages already sends `Access-Control-Allow-Origin: *` and serves
   `.json` as `application/json`, so the cross-origin manifest fetch works
   without any server configuration.

## Step 8 - Verify the deployed plugin

- [ ] The workflow is green and `curl -sI` on the manifest URL returns 200 with
      `content-type: application/json` and `access-control-allow-origin: *`.
- [ ] In the deployed shell, point the workspace at the Pages manifest URL and
      approve consent (cross-origin: no storage warning should appear).
- [ ] Opening a matching file mounts one handler; no bytes move before the
      plugin asks.
- [ ] Dirty reaches the tab; Save writes the exact text/bytes; a conflicting
      external write leaves the buffer and disk intact and the tab dirty.
- [ ] An external change is visible and never silently replaces a dirty buffer.
- [ ] Toggling the shell theme updates the visible page without reopening the
      file: background, text, inputs, focus ring, selection and scrollbars follow
      in both dark and light, and the editor library's own theme follows.
- [ ] Closing the tab disposes the frame; a late save does not recreate the
      file.
- [ ] Disabling the plugin falls back to the shell text surface.

## Troubleshooting

| Symptom                      | Likely cause                             | Fix                                                                      |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `cors` during manifest fetch | Missing CORS header or redirect          | Stay on the Pages origin; no redirects to other origins                  |
| `unsupported-origin`         | Entry page outside the manifest origin   | Serve all pages from the Pages origin                                    |
| `unsupported-version`        | Protocol major mismatch                  | Never pin a protocol number; use the vendored SDK as-is                  |
| `incompatible-engine`        | `engines.exo` excludes the shell         | Use `>=0.1.0`                                                            |
| `permission-denied` on read  | Missing permission, or reserved path     | Fix the manifest; never request `exo.json` or `/.exo/**`                 |
| `not-found` / `not-a-file`   | Wrong path                               | Resolve relative to `editor.file.path` or use an absolute workspace path |
| `too-large`                  | File/payload over the advertised cap     | Check `editor.limits`; show a no-editor state                            |
| `timeout` in the plugin log  | Controller never sent ready or completed | Check the frame console and the SDK boot path                            |
| `protocol-violation`         | Hand-written protocol code               | Remove it; use the SDK                                                   |
| Manifest rejected, no frame  | Unknown field or invalid page            | Validate against the schema; keep fields exact                           |
| Plugin stays dark in light   | No `events:subscribe`, or fixed colors   | Import `theme.css`, call `followTheme`, use `--exo-*` tokens             |
| Theme CSS is missing         | Import skipped or file not vendored      | Import `@exo/plugin-sdk/theme.css`; copy the whole SDK package           |

## Maintenance

- Update the vendored SDK by re-copying `packages/plugin-sdk` from upstream
  (same commands as step 2) and bumping the `"@exo/plugin-sdk"` version in
  `plugin/package.json` to match `sdk/package.json`. Keep `theme.ts` and
  `theme.css` in the copy. Diff before pushing.
- Authority, in order: the contracts
  (<https://github.com/mode777/exo-editor/tree/main/docs/contracts>), then the
  author guide (<https://github.com/mode777/exo-editor/tree/main/docs/guide>),
  then the template
  (<https://github.com/mode777/exo-editor/tree/main/packages/plugin-template>).
  Release and deprecation policy:
  <https://github.com/mode777/exo-editor/blob/main/docs/releases.md>.

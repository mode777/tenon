# @exo/plugin-sdk

Typed client for the Exo v1 plugin protocol. It owns the plugin side of the
envelope, handshake, registration, file-handler and event flows so a plugin does
not hand-roll security-relevant message plumbing.

The package is private to this repository for v1 (D12). The core is DOM-free and
is consumed as TypeScript source by the template and the shell conformance
tests. `@exo/plugin-sdk/browser` is the only entry point that reads the URL
fragment and `window.parent`.

## Install and import

```ts
import { connectPlugin, ExoProtocolError, PROTOCOL_VERSION } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { FakePluginTransport } from '@exo/plugin-sdk/testing'
```

The package has no runtime dependencies.

## Controller entry

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
console.log(ack.accepted, ack.rejected)
```

`connectBrowserPlugin` reads `exo-host`, `exo-mode` and `exo-session` from the
fragment, rejects a top-level page and refuses to send anything without those
values. It never posts to `*`.

## Editor entry

```ts
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const connection = await connectBrowserPlugin()
if (connection.mode !== 'editor') throw new Error('Expected editor mode')
const editor = connection.editor
let buffer = ''

editor.onSaveRequest(() => ({ text: buffer }))
editor.requestSave() // id-less intent; outcome arrives through onSaveResult
editor.onFileChanged((change) => console.log(change.kind, change.path))
editor.onDispose((reason) => console.log('disposed', reason))

const content = await editor.readFile(editor.file.path, 'utf8')
buffer = content.text
editor.setDirty(true)
```

The SDK sends `plugin/dispose-ack` automatically, rejects pending reads on
disposal and answers `shell/request-save` only when a save handler is registered.
A handler that throws or is missing leaves the shell's five-second timeout as the
outcome; no save-cancel message is invented.

## Theming

`@exo/plugin-sdk/theme` is a DOM-only helper and `theme.css` is an optional
semantic token sheet. The DOM-free core never loads either.

```ts
import '@exo/plugin-sdk/theme.css'
import { followTheme } from '@exo/plugin-sdk/theme'

const cleanup = await followTheme(editor, {
  onTheme: (theme) => {
    // Map dark/light/high-contrast to your editor library's own theme.
  },
})
```

`followTheme` applies `shell/init.theme`, subscribes to `theme/changed` when the
manifest has `events:subscribe`, and returns a listener cleanup. Without the
permission it only applies the initial theme. `applyTheme(theme)` is the lower
level primitive for a plugin with its own subscription. The token contract and
the full palette are in
[`docs/contracts/plugin-styling.md`](../../docs/contracts/plugin-styling.md).

## Injected transport

Tests and non-browser hosts supply a `PluginTransport`:

```ts
import { connectPlugin, type PluginTransport } from '@exo/plugin-sdk'

declare const transport: PluginTransport
const connection = await connectPlugin({ transport })
```

`FakePluginTransport` from `@exo/plugin-sdk/testing` records posts and injects
messages with explicit origin and source, which is how the SDK's gate and the
shell conformance tests are exercised.

## Compatibility policy

- The package MAJOR equals the protocol major it speaks (`1.x` speaks protocol
  `1`). `PROTOCOL_VERSION` and `SDK_VERSION` are exported constants; plugins do
  not hard-code the number.
- Additive optional fields and new client helpers are minor releases. Removing or
  reinterpreting a wire field requires a new SDK and protocol major.
- A deprecated export remains functional for the rest of the current major and is
  removed only at the next major.
- The manifest `schemaVersion`, `engines.exo` range and shell version are
  independent. The SDK does not parse, validate or rewrite a manifest.
- An unsupported protocol major raises `ExoProtocolError` with `code:
'unsupported-version'`, `expected` and `received` before any registration or
  file message is sent.

See [`docs/contracts/plugin-sdk.md`](../../docs/contracts/plugin-sdk.md) for the
normative contract.

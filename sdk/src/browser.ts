import { connectPlugin, type ConnectOptions, type PluginConnection } from './handshake'
import { ExoProtocolError, type PluginMode } from './protocol'
import type { PluginTransport, TransportListener } from './transport'

export interface BrowserTransportOptions {
  /** Injectable for tests; defaults to the global window. */
  window?: Window
}

export interface ParsedFragment {
  hostOrigin: string
  mode: PluginMode
  sessionId: string
}

function parseExoHost(value: string | null): string {
  if (!value) {
    throw new ExoProtocolError('bootstrap', 'The plugin URL has no exo-host fragment parameter.')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ExoProtocolError('bootstrap', 'The exo-host fragment parameter is not a URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ExoProtocolError('bootstrap', 'The exo-host origin must be http or https.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ExoProtocolError(
      'bootstrap',
      'The exo-host origin must not carry credentials or a query.',
    )
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new ExoProtocolError('bootstrap', 'The exo-host value must be an origin, not a path.')
  }
  if (url.origin === 'null') {
    throw new ExoProtocolError('bootstrap', 'The exo-host origin is not a valid web origin.')
  }
  return url.origin
}

/** Parse the fragment the shell puts on every plugin frame URL. */
export function parseExoFragment(hash: string): ParsedFragment {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const hostOrigin = parseExoHost(params.get('exo-host'))
  const mode = params.get('exo-mode')
  if (mode !== 'register' && mode !== 'editor' && mode !== 'view') {
    throw new ExoProtocolError(
      'bootstrap',
      'The plugin URL needs exo-mode=register, exo-mode=editor or exo-mode=view.',
    )
  }
  const sessionId = params.get('exo-session')
  if (!sessionId) {
    throw new ExoProtocolError('bootstrap', 'The plugin URL has no exo-session fragment parameter.')
  }
  if (sessionId.length > 256) {
    throw new ExoProtocolError('bootstrap', 'The exo-session value is too long.')
  }
  return { hostOrigin, mode, sessionId }
}

export function createBrowserTransport(options: BrowserTransportOptions = {}): PluginTransport {
  const win = options.window ?? window
  if (!win.parent || win.parent === win) {
    throw new ExoProtocolError(
      'bootstrap',
      'The plugin must be embedded in the Exo shell; a top-level page has no shell parent.',
    )
  }
  const { hostOrigin, mode, sessionId } = parseExoFragment(win.location.hash)
  const parent = win.parent

  return {
    hostOrigin,
    mode,
    sessionId,
    parent,
    post(message) {
      // The shell is the receiver, and its origin is always nameable. `*` is
      // never used, even from an opaque same-origin sandboxed frame.
      parent.postMessage(message, hostOrigin)
    },
    receive(listener: TransportListener) {
      const onMessage = (event: MessageEvent) => {
        listener(event.data, { origin: event.origin, source: event.source })
      }
      win.addEventListener('message', onMessage)
      return () => win.removeEventListener('message', onMessage)
    },
  }
}

/** Browser entry point: read the fragment, connect, and return the typed client. */
export function connectBrowserPlugin(
  options: Omit<ConnectOptions, 'transport'> = {},
): Promise<PluginConnection> {
  return connectPlugin({ ...options, transport: createBrowserTransport() })
}

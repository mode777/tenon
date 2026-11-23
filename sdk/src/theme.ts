import type { PluginPermission, ShellEvent, ThemeChangedPayload, ThemeName } from './protocol'

/** The listener shape shared by editor and view clients for `theme/changed`. */
export type ThemeChangedListener = (event: ShellEvent<ThemeChangedPayload>) => void

/**
 * The subset of a frame client that `followTheme` needs. Both `EditorClient` and
 * `ViewClient` satisfy it.
 */
export interface ThemeClient {
  readonly initialization: {
    readonly theme: ThemeName
    readonly permissions: readonly PluginPermission[]
  }
  subscribe(topic: 'theme/changed'): Promise<unknown>
  onEvent(topic: 'theme/changed', listener: ThemeChangedListener): () => void
}

export interface ThemeOptions {
  /** Defaults to the global document. */
  document?: Document
}

export interface FollowThemeOptions extends ThemeOptions {
  /** Receives the initial theme and every later change. */
  onTheme?: (theme: ThemeName) => void
}

/**
 * Write the shell theme name to `data-theme` on the document root. The optional
 * token stylesheet uses that attribute for its palette and `color-scheme`; no
 * inline style is written, so a strict CSP needs no `unsafe-inline`.
 */
export function applyTheme(theme: ThemeName, options: ThemeOptions = {}): void {
  const target = options.document ?? document
  target.documentElement.dataset.theme = theme
}

/**
 * Apply the initialization theme and, when the manifest has `events:subscribe`,
 * follow later `theme/changed` deliveries. Resolves with a listener cleanup.
 *
 * Without the permission it sends no message and resolves with a no-op cleanup.
 * A failed subscription rejects after the initial theme has been applied.
 */
export async function followTheme(
  client: ThemeClient,
  options: FollowThemeOptions = {},
): Promise<() => void> {
  const apply = (theme: ThemeName): void => {
    applyTheme(theme, options)
    options.onTheme?.(theme)
  }

  apply(client.initialization.theme)
  if (!client.initialization.permissions.includes('events:subscribe')) {
    return () => undefined
  }

  await client.subscribe('theme/changed')
  return client.onEvent('theme/changed', (event) => {
    apply(event.payload.theme)
  })
}

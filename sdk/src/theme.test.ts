// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellEvent, ThemeChangedPayload, ThemeName } from './protocol'
import { applyTheme, followTheme, type ThemeChangedListener, type ThemeClient } from './theme'

function fakeClient(
  theme: ThemeName,
  permissions: ThemeClient['initialization']['permissions'] = [],
  subscribeImpl: () => Promise<unknown> = async () => ({ topic: 'theme/changed', seq: 0 }),
) {
  const listeners = new Set<ThemeChangedListener>()
  const subscribe = vi.fn(subscribeImpl)
  const onEvent = vi.fn((_topic: 'theme/changed', listener: ThemeChangedListener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  const client: ThemeClient = {
    initialization: { theme, permissions },
    subscribe,
    onEvent,
  }
  const emit = (next: ThemeName): void => {
    const event: ShellEvent<ThemeChangedPayload> = {
      topic: 'theme/changed',
      seq: 1,
      payload: { theme: next },
    }
    for (const listener of [...listeners]) listener(event)
  }
  return { client, emit, subscribe, onEvent, listeners }
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
})

describe('applyTheme', () => {
  it('writes the exact theme and no inline style', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.hasAttribute('style')).toBe(false)

    applyTheme('high-contrast')
    expect(document.documentElement.dataset.theme).toBe('high-contrast')
  })

  it('can target a separate document', () => {
    const other = document.implementation.createHTMLDocument('other')
    applyTheme('dark', { document: other })
    expect(other.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('followTheme', () => {
  it('applies the initial theme without subscribing when permission is absent', async () => {
    const theme = fakeClient('dark')
    const seen: ThemeName[] = []

    const cleanup = await followTheme(theme.client, { onTheme: (next) => seen.push(next) })

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(seen).toEqual(['dark'])
    expect(theme.subscribe).not.toHaveBeenCalled()
    cleanup()
  })

  it('subscribes, follows changes and stops after cleanup', async () => {
    const theme = fakeClient('dark', ['events:subscribe'])
    const seen: ThemeName[] = []

    const cleanup = await followTheme(theme.client, { onTheme: (next) => seen.push(next) })
    expect(theme.subscribe).toHaveBeenCalledWith('theme/changed')

    theme.emit('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    theme.emit('high-contrast')
    expect(document.documentElement.dataset.theme).toBe('high-contrast')
    expect(seen).toEqual(['dark', 'light', 'high-contrast'])

    cleanup()
    theme.emit('dark')
    expect(document.documentElement.dataset.theme).toBe('high-contrast')
    expect(seen).toEqual(['dark', 'light', 'high-contrast'])
  })

  it('applies the initial theme before a failed subscription rejects', async () => {
    const theme = fakeClient('light', ['events:subscribe'], async () => {
      throw new Error('subscription failed')
    })
    const seen: ThemeName[] = []

    await expect(followTheme(theme.client, { onTheme: (next) => seen.push(next) })).rejects.toThrow(
      'subscription failed',
    )
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(seen).toEqual(['light'])
    expect(theme.onEvent).not.toHaveBeenCalled()
  })
})
